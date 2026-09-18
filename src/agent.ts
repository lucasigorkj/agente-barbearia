import { GoogleGenAI, type Content } from "@google/genai";
import { config } from "./config";
import { buildSystemPrompt } from "./prompt";
import { declaracoes } from "./tools";
import { esquecerLead } from "./catalogo";
import { executarTool } from "./tool-runner";

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

// ---------------------------------------------------------------------------
// Historico em memoria
//
// Sem banco: Map<chatid, Content[]>. Reinicio do servidor zera as conversas --
// aceitavel para pre-atendimento, onde o lead ja foi logado no fechamento.
// ---------------------------------------------------------------------------

interface Sessao {
  historico: Content[];
  ultimoAcesso: number;
}

const sessoes = new Map<string, Sessao>();

function pegarSessao(chatid: string): Sessao {
  let s = sessoes.get(chatid);
  if (!s) {
    s = { historico: [], ultimoAcesso: Date.now() };
    sessoes.set(chatid, s);
  }
  s.ultimoAcesso = Date.now();
  return s;
}

/**
 * Corta o historico mantendo pares coerentes.
 *
 * CICATRIZ: um Content de functionResponse orfao (sem o functionCall que o
 * originou) faz o Gemini rejeitar a requisicao inteira -- por isso o corte
 * avanca ate a proxima fala do cliente em vez de fatiar no meio de uma rodada
 * de tools. Um slice(-24) ingenuo quebra toda conversa longa.
 */
function podar(historico: Content[]): Content[] {
  if (historico.length <= config.maxHistorico) return historico;

  // Os resultados de tool tambem entram como role "user", entao parar no primeiro
  // "user" nao basta: cair num turno de functionResponse deixaria a resposta sem o
  // functionCall que a originou, e a API rejeita esse par quebrado. So serve como
  // inicio um turno de fala real do cliente.
  const falaDoCliente = (c: Content | undefined): boolean =>
    c?.role === "user" && !c.parts?.some((p) => p.functionResponse);

  let inicio = historico.length - config.maxHistorico;
  while (inicio < historico.length && !falaDoCliente(historico[inicio])) inicio++;
  return inicio >= historico.length ? [] : historico.slice(inicio);
}

/** Descarta conversas ociosas para o Map nao crescer sem limite. */
export function limparSessoesOciosas(): number {
  const limite = Date.now() - config.sessaoTtlMs;
  let n = 0;
  for (const [chatid, s] of sessoes) {
    if (s.ultimoAcesso < limite) {
      sessoes.delete(chatid);
      esquecerLead(chatid); // senao o Map de leads cresce sem limite junto
      n++;
    }
  }
  if (n > 0) console.log(`[agent] ${n} sessao(oes) ociosa(s) descartada(s)`);
  return n;
}

export function totalSessoes(): number {
  return sessoes.size;
}

/** Zera uma conversa. Usado pelo /novo do REPL. */
export function resetarSessao(chatid: string): void {
  sessoes.delete(chatid);
  esquecerLead(chatid);
}

/**
 * Tira a formatacao de documento que o modelo as vezes deixa passar.
 *
 * Linha em branco no meio de uma mensagem de 2 frases faz parecer e-mail, nao
 * WhatsApp -- e o prompt sozinho nao segura isso de forma confiavel. Guardrail
 * mecanico na saida, porque instrucao falha de vez em quando e isto aqui nao.
 */
function limpar(texto: string): string {
  return texto
    .replace(/\r\n/g, "\n")
    .replace(/\n{2,}/g, " ") // paragrafo vira continuacao da frase
    .replace(/^\s*[-*]\s+/gm, "") // marcador de lista que escapou
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Tamanho atual do historico -- marcador para desfazer o turno se ele nascer velho. */
export function marcarHistorico(chatid: string): number {
  return sessoes.get(chatid)?.historico.length ?? 0;
}

/**
 * Descarta tudo que entrou no historico depois do marcador.
 *
 * Usado quando o cliente manda mensagem nova enquanto o agente pensava: a resposta
 * pronta ja esta velha, entao o turno inteiro (fala do cliente, tools e resposta)
 * some e o proximo turno reprocessa com o contexto completo.
 */
export function desfazerTurno(chatid: string, marcador: number): void {
  const s = sessoes.get(chatid);
  if (s && s.historico.length > marcador) s.historico.length = marcador;
}

// ---------------------------------------------------------------------------
// Loop de conversa
// ---------------------------------------------------------------------------

/**
 * Processa um turno e devolve o texto a enviar.
 * `nomeContato` e o pushname do WhatsApp -- ajuda o agente a nao perguntar o nome a toa.
 */
export async function responder(
  chatid: string,
  texto: string,
  nomeContato?: string
): Promise<string> {
  const sessao = pegarSessao(chatid);
  // Reconstruido a cada turno: o prompt carrega a data de hoje. Montado uma vez no
  // boot, um processo que roda dias acha que ainda e o dia do deploy.
  const systemInstruction = buildSystemPrompt();

  // Contexto do nome so na primeira mensagem, para nao poluir todo turno.
  const primeira = sessao.historico.length === 0;
  const entrada =
    primeira && nomeContato?.trim()
      ? `[contato salvo no WhatsApp como "${nomeContato.trim()}"]\n${texto}`
      : texto;

  sessao.historico.push({ role: "user", parts: [{ text: entrada }] });

  for (let i = 0; i < config.maxToolIteracoes; i++) {
    const resposta = await ai.models.generateContent({
      model: config.geminiModel,
      contents: sessao.historico,
      config: {
        systemInstruction,
        tools: [{ functionDeclarations: declaracoes }],
        // O loop de tools e nosso. Sem isso a AFC do SDK executa por fora e
        // o historico local sai dessincronizado do que o modelo realmente viu.
        automaticFunctionCalling: { disable: true },
        temperature: config.temperatura,
        maxOutputTokens: config.maxOutputTokens,
      },
    });

    const chamadas = resposta.functionCalls ?? [];

    // Sem tools: e a resposta final.
    if (chamadas.length === 0) {
      const texto = limpar(resposta.text ?? "");
      if (!texto) break;
      // Mesmo motivo do bloco abaixo: preserva o content original quando existir.
      const turnoFinal = resposta.candidates?.[0]?.content;
      sessao.historico.push(
        turnoFinal?.parts?.length ? turnoFinal : { role: "model", parts: [{ text: texto }] }
      );
      sessao.historico = podar(sessao.historico);
      return texto;
    }

    // CICATRIZ: devolve o turno do modelo EXATAMENTE como veio, sem reconstruir.
    //
    // Os modelos Gemini 3.x anexam um `thoughtSignature` (base64 opaco) nas parts
    // de functionCall e exigem esse mesmo campo de volta na proxima requisicao.
    // Remontar as parts a partir de `resposta.functionCalls` descarta a assinatura
    // e a API responde 400: "Function call is missing a thought_signature".
    // Reaproveitar o content original preserva assinatura e parts de raciocinio.
    const turnoModelo = resposta.candidates?.[0]?.content;
    sessao.historico.push(
      turnoModelo?.parts?.length
        ? turnoModelo
        : {
            // Fallback para modelos que nao devolvem candidates (2.x e anteriores).
            role: "model",
            parts: chamadas.map((c) => ({
              functionCall: { name: c.name ?? "", args: c.args ?? {} },
            })),
          }
    );

    // Executa e devolve os resultados na mesma ordem.
    const resultados = chamadas.map((c) => {
      const nome = c.name ?? "";
      const args = (c.args ?? {}) as Record<string, unknown>;
      console.log(`[agent] tool ${nome}(${JSON.stringify(args)})`);
      const saida = executarTool(nome, args, chatid);
      return { functionResponse: { name: nome, response: saida as Record<string, unknown> } };
    });

    sessao.historico.push({ role: "user", parts: resultados });
  }

  // Estourou o teto de iteracoes ou veio resposta vazia.
  console.warn(`[agent] turno sem resposta util para ${chatid}`);
  sessao.historico = podar(sessao.historico);
  return config.fraseFallback;
}
