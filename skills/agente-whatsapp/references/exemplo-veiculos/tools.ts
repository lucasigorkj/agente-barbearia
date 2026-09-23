import type { FunctionDeclaration } from "@google/genai";
import { config } from "./config";
import { notificarLead } from "./notificar";
import { pausar } from "./pausa";
import {
  booleano,
  guardarLead,
  leadAnterior,
  moeda,
  numero,
  preferir,
  ranquear,
  type Campo,
} from "./catalogo";
import type { Handler } from "./tool-runner";
import catalogoRaw from "./data/catalogo.json";

/**
 * A CAMADA DO NEGOCIO.
 *
 * Este arquivo, o prompt.ts e o data/catalogo.json sao os unicos tres que mudam
 * de um nicho para outro. Todo o resto do src/ atravessa sem tocar.
 */

export interface Veiculo {
  tipo: "carro" | "moto";
  marca: string;
  modelo: string;
  versao: string;
  ano: number;
  km: number;
  cambio: string;
  preco: number;
  disponivel: boolean;
  destaque: boolean;
}

const TODOS = catalogoRaw as Veiculo[];

/** So o que esta a venda chega ao modelo. */
const ESTOQUE = TODOS.filter((v) => v.disponivel);

/**
 * Que categorias existem no patio agora.
 *
 * O prompt usa isso para nao abrir com "moto ou carro?" numa loja que so tem
 * carro -- pergunta que promete o que a loja nao tem e frustra na primeira
 * resposta. Deriva do catalogo para a troca de cliente continuar sendo so
 * .env + catalogo.json.
 */
export function categoriasDisponiveis(): string[] {
  const tipos = new Set(ESTOQUE.map((v) => v.tipo));
  return (["carro", "moto"] as const).filter((t) => tipos.has(t));
}

/**
 * A pergunta que o `npm run check` usa para testar function calling.
 *
 * Sai do proprio catalogo: pergunta fixa vira mentira assim que o catalogo muda.
 */
export function exemploDeBusca(): string {
  const v = ESTOQUE[0];
  return v ? `Quanto custa o ${v.modelo}?` : "Quanto custa?";
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

/**
 * Os campos que participam da busca, em ordem de especificidade.
 *
 * Token que casa com o modelo pesa mais que token que casa com a marca: quem
 * diz "honda xre" quer a XRE, e "honda" sozinho nao pode ganhar da moto certa.
 * Marca sozinha ainda passa, porque "voces tem Honda?" precisa devolver as
 * Hondas em vez de um "nao temos" -- e com varias da marca o empate vira pergunta.
 */
function camposDe(v: Veiculo): Campo[] {
  return [
    { valor: v.modelo, peso: 6, pesoExato: 10, colado: true },
    { valor: v.marca, peso: 5 },
    { valor: v.versao, peso: 3 },
    { valor: String(v.ano), peso: 2 },
  ];
}

// Igual ao peso de "marca contem": qualquer mencao de marca sozinha passa
// raspando, e e de proposito. Mexeu nos pesos acima, confira este numero.
const LIMIAR = 5;

/** Ficha completa -- so depois que o cliente escolheu um. */
function ficha(v: Veiculo) {
  return {
    veiculo: `${v.marca} ${v.modelo} ${v.versao}`.trim(),
    tipo: v.tipo,
    ano: v.ano,
    km: `${numero(v.km)} km`,
    cambio: v.cambio,
    preco: moeda(v.preco),
  };
}

/** Nome + preco, sem ano/km. */
function resumo(v: Veiculo) {
  return { veiculo: `${v.marca} ${v.modelo}`, preco: moeda(v.preco) };
}

function sugestoes(): string[] {
  return ESTOQUE.slice()
    .sort((a, b) => Number(b.destaque) - Number(a.destaque))
    .slice(0, 4)
    .map((v) => `${v.marca} ${v.modelo}`);
}

function buscarVeiculo(args: Record<string, unknown>) {
  const termo = typeof args.termo === "string" ? args.termo : "";
  if (!termo.trim()) {
    return { encontrado: false, motivo: "termo vazio", sugestoes: sugestoes() };
  }

  const { melhor, empatados } = ranquear(ESTOQUE, termo, camposDe, LIMIAR);

  if (!melhor) {
    return {
      encontrado: false,
      // Instrucao explicita: sem isso o modelo tende a preencher a lacuna sozinho.
      instrucao:
        "Nao ha esse veiculo no estoque. Diga que nao tem no momento e ofereca as sugestoes. Nao invente preco.",
      sugestoes: sugestoes(),
    };
  }

  // Empate tecnico ("honda") -> devolve as opcoes em vez de escolher por conta.
  if (empatados.length > 1) {
    return {
      encontrado: true,
      ambiguo: true,
      instrucao: "Mais de um veiculo bate. Pergunte qual deles o cliente quer.",
      opcoes: empatados.map(ficha),
    };
  }

  return { encontrado: true, ...ficha(melhor) };
}

function listarVeiculos(args: Record<string, unknown>) {
  const tipo =
    args.tipo === "carro" || args.tipo === "moto" ? (args.tipo as "carro" | "moto") : undefined;
  const precoMax =
    typeof args.precoMax === "number" && args.precoMax > 0 ? args.precoMax : undefined;

  const filtrados = ESTOQUE.filter(
    (v) => (!tipo || v.tipo === tipo) && (!precoMax || v.preco <= precoMax)
  ).sort((a, b) => Number(b.destaque) - Number(a.destaque) || a.preco - b.preco);

  if (filtrados.length === 0) {
    return {
      total: 0,
      veiculos: [],
      instrucao: precoMax
        ? "Nada nessa faixa de preco. Diga isso e pergunte se ele consegue esticar um pouco."
        : "Nada disponivel nessa categoria agora.",
    };
  }

  // Devolve poucos de proposito: o agente cita no maximo 2, e `total` deixa ele
  // dizer "tenho 8" sem precisar recitar os 8.
  const amostra = filtrados.slice(0, 3);

  return {
    total: filtrados.length,
    mostrando: amostra.length,
    veiculos: amostra.map(resumo),
    instrucao:
      filtrados.length > 2
        ? `Ha ${filtrados.length} veiculos. Cite no maximo 2 e faca uma pergunta que estreite (faixa de preco, uso). Nao liste todos.`
        : "Pode citar os dois.",
  };
}

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------

/**
 * `type` e nao `interface` de proposito: um type alias de objeto e atribuivel a
 * Record<string, unknown>, o que deixa este Lead entrar direto no store generico
 * e no webhook, sem cast nenhum. Interface nao e.
 */
export type Lead = {
  nome: string;
  veiculo: string;
  formaPagamento: string;
  entrada: string;
  temTroca: boolean;
  /** Modelo/ano/km do veiculo de troca, com as palavras do cliente. */
  veiculoTroca: string;
  /** Dia e periodo combinados, com as palavras do cliente. */
  visita: string;
};

/** O texto que chega no WhatsApp de quem vai atender. */
function formatarParaHumano(lead: Lead, telefoneCliente: string): string {
  const linhas = [
    "*Lead qualificado*",
    "",
    `Cliente: ${lead.nome}`,
    `WhatsApp: ${telefoneCliente}`,
    `Veiculo: ${lead.veiculo}`,
    `Pagamento: ${lead.formaPagamento}`,
    `Entrada: ${lead.entrada}`,
    lead.temTroca ? `Troca: ${lead.veiculoTroca}` : "Troca: nao tem",
    `Visita: ${lead.visita}`,
    "",
    "Pode assumir a conversa.",
  ];
  return linhas.join("\n");
}

function registrarLead(args: Record<string, unknown>, chatid: string) {
  const anterior = leadAnterior<Lead>(chatid);
  const temTroca = booleano(args.temTroca, anterior?.temTroca);

  const lead: Lead = {
    nome: preferir(String(args.nome ?? ""), anterior?.nome, "nao informado"),
    veiculo: preferir(String(args.veiculo ?? ""), anterior?.veiculo, "nao informado"),
    formaPagamento: preferir(
      String(args.formaPagamento ?? ""),
      anterior?.formaPagamento,
      "nao informado"
    ),
    entrada: preferir(String(args.entrada ?? ""), anterior?.entrada, "nao informado"),
    temTroca,
    // Sem troca o campo nao faz sentido; com troca e sem detalhe, quem vai
    // atender precisa enxergar que ficou faltando em vez de ver string vazia.
    veiculoTroca: temTroca
      ? preferir(String(args.veiculoTroca ?? "").trim(), anterior?.veiculoTroca, "nao detalhado")
      : "-",
    visita: preferir(String(args.visita ?? ""), anterior?.visita, "nao agendada"),
  };

  guardarLead(chatid, lead);

  // Este console.log e o "CRM" da demo -- aparece nos logs do servidor.
  const titulo = anterior ? "LEAD ATUALIZADO" : "LEAD QUALIFICADO";
  console.log(
    `\n===== ${titulo} =====\n` +
      JSON.stringify({ ...lead, registradoEm: new Date().toISOString() }, null, 2) +
      "\n============================\n"
  );

  const telefone = chatid.split("@")[0] ?? chatid;
  notificarLead(lead, formatarParaHumano(lead, telefone), chatid);

  // Humano assumiu -- o agente sai da frente. Bot que continua falando por cima
  // do vendedor e a objecao numero 1 do lojista.
  if (config.pausarAposLead) {
    pausar(chatid, config.pausaAposLeadMin * 60_000, "lead registrado, humano assumiu");
  }

  if (anterior) {
    return {
      ok: true,
      jaRegistrado: true,
      instrucao:
        "Esse lead JA estava registrado e foi atualizado. NAO registre de novo. " +
        "So responda o cliente normalmente.",
    };
  }

  return {
    ok: true,
    instrucao:
      "Lead registrado. Avise que o consultor assume a conversa em instantes. Nao pergunte mais nada.",
  };
}

// ---------------------------------------------------------------------------
// Declaracoes para o Gemini
// ---------------------------------------------------------------------------

export const declaracoes: FunctionDeclaration[] = [
  {
    name: "buscarVeiculo",
    description:
      "Busca um veiculo no estoque por marca, modelo ou ano. Use sempre que o cliente citar um veiculo especifico. Unica fonte de preco valida.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        termo: {
          type: "string",
          description: "O que o cliente falou. Ex: 'XRE 300', 'harley fat bob', 'compass'.",
        },
      },
      required: ["termo"],
    },
  },
  {
    name: "listarVeiculos",
    description:
      "Mostra opcoes do estoque com o total disponivel. Use quando o cliente nao souber o que quer, pedir opcoes, ou depois que ele estreitar (tipo/faixa de preco). Retorna poucos itens de proposito: cite no maximo 2 na sua mensagem.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          enum: ["carro", "moto"],
          description: "Filtro opcional. Omita para trazer os dois.",
        },
        precoMax: {
          type: "number",
          description:
            "Teto de preco em reais, sem pontuacao. Ex: cliente falou 'ate 40 mil' -> 40000. Use assim que ele der uma faixa.",
        },
      },
    },
  },
  {
    name: "registrarLead",
    description:
      "Registra o lead qualificado e passa para o consultor humano. Chame quando tiver veiculo, forma de pagamento, entrada e situacao da troca, e ja tiver proposto a visita.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome do cliente." },
        veiculo: { type: "string", description: "Veiculo de interesse." },
        formaPagamento: {
          type: "string",
          description: "Ex: 'a vista', 'financiado', 'consorcio'.",
        },
        entrada: { type: "string", description: "Valor de entrada como o cliente falou." },
        temTroca: { type: "boolean", description: "Se tem veiculo na troca." },
        veiculoTroca: {
          type: "string",
          description:
            "Modelo, ano e km do veiculo de troca, com as palavras do cliente. Ex: 'Fazer 250 2019, uns 30 mil km'. Omita se nao houver troca.",
        },
        visita: {
          type: "string",
          description:
            "Dia da semana + DATA + periodo que o CLIENTE confirmou. " +
            "SEMPRE com a data concreta, no formato 'sexta-feira 28/08, meio-dia'. " +
            "Converta 'amanha'/'sexta' usando a lista de proximos dias do seu contexto -- " +
            "quem vai atender precisa do dia, nao da palavra. " +
            "Omita se ele recusou, nao respondeu ou respondeu outra coisa. NUNCA preencha com o " +
            "periodo que voce sugeriu sem ele ter aceitado.",
        },
      },
      required: ["nome", "veiculo", "formaPagamento", "entrada", "temTroca"],
    },
  },
];

export const handlers: Record<string, Handler> = {
  buscarVeiculo,
  listarVeiculos,
  registrarLead,
};
