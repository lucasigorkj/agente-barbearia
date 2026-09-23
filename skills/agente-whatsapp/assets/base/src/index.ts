import { timingSafeEqual } from "node:crypto";
import express from "express";
import { assertUazapi, config } from "./config";
import {
  desfazerTurno,
  limparSessoesOciosas,
  marcarHistorico,
  responder,
  totalSessoes,
} from "./agent";
import { ficarOnline, responderComoHumano } from "./whatsapp";
import { estaPausado, limparPausasVencidas, pausar } from "./pausa";

const app = express();
app.use(express.json({ limit: "2mb" }));

// ---------------------------------------------------------------------------
// Payload UAZAPI (campos que importam -- amostras reais do evento "messages")
// ---------------------------------------------------------------------------

interface UazapiMessage {
  fromMe?: boolean;
  isGroup?: boolean;
  wasSentByApi?: boolean;
  type?: string;
  text?: string;
  /**
   * Telefone do outro lado da conversa, nos dois sentidos -- e o alvo da resposta.
   *
   * ATENCAO: nao use `sender`. Nas amostras reais ele vem como "@lid"
   * (ex: "138401042923712@lid"), um id interno do WhatsApp, nao um telefone.
   * Responder para o lid nao chega em ninguem.
   */
  chatid?: string;
  senderName?: string;
  /** Usado para marcar como lida. No payload real vem sem o prefixo do owner. */
  messageid?: string;
}

interface UazapiWebhook {
  EventType?: string;
  instanceName?: string;
  message?: UazapiMessage;
}

// ---------------------------------------------------------------------------
// Agrupamento + fila por conversa
//
// No WhatsApp a pessoa manda "oi" / "vi aquilo no insta" / "ta quanto?" em 3 mensagens.
// Sem buffer o bot responde 3x e se perde -- e o erro que denuncia robo na hora.
// ---------------------------------------------------------------------------

interface Buffer {
  partes: string[];
  /** ids das mensagens agrupadas -- todas viram "lida" de uma vez. */
  ids: string[];
  timer: NodeJS.Timeout;
  nomeContato?: string;
}

const buffers = new Map<string, Buffer>();
/** Turnos em andamento: impede duas chamadas ao Gemini mexerem no mesmo historico. */
const emAndamento = new Map<string, Promise<void>>();

function agendar(chatid: string, texto: string, id?: string, nomeContato?: string): void {
  const existente = buffers.get(chatid);

  if (existente) {
    existente.partes.push(texto);
    if (id) existente.ids.push(id);
    if (nomeContato) existente.nomeContato = nomeContato;
    clearTimeout(existente.timer); // cada mensagem nova reinicia a janela
    existente.timer = setTimeout(() => descarregar(chatid), config.debounceMs);
    return;
  }

  buffers.set(chatid, {
    partes: [texto],
    ids: id ? [id] : [],
    nomeContato,
    timer: setTimeout(() => descarregar(chatid), config.debounceMs),
  });
}

/** Descarta o que estava na fila. Usado quando um humano assume no meio. */
function cancelarBuffer(chatid: string): void {
  const buf = buffers.get(chatid);
  if (!buf) return;
  clearTimeout(buf.timer);
  buffers.delete(chatid);
}

function descarregar(chatid: string): void {
  const buf = buffers.get(chatid);
  if (!buf) return;
  buffers.delete(chatid);

  const texto = buf.partes.join("\n");
  const ids = buf.ids;

  // Encadeia no turno anterior desta conversa em vez de rodar em paralelo.
  const anterior = emAndamento.get(chatid) ?? Promise.resolve();
  const atual = anterior
    .catch(() => {})
    .then(() => processar(chatid, texto, ids, buf.nomeContato));

  emAndamento.set(chatid, atual);
  void atual.finally(() => {
    if (emAndamento.get(chatid) === atual) emAndamento.delete(chatid);
  });
}

async function processar(
  chatid: string,
  texto: string,
  ids: string[],
  nomeContato?: string
): Promise<void> {
  console.log(`[webhook] <- ${chatid}: ${texto.replace(/\n/g, " | ")}`);
  const marcador = marcarHistorico(chatid);
  try {
    const resposta = await responder(chatid, texto, nomeContato);

    // Um humano pode ter assumido enquanto o Gemini pensava. Nesse caso a
    // resposta pronta atropelaria a fala dele -- engole e sai.
    if (estaPausado(chatid)) {
      desfazerTurno(chatid, marcador);
      console.log(`[webhook] ${chatid}: resposta engolida, humano assumiu no meio`);
      return;
    }

    // O cliente falou de novo enquanto pensavamos? Entao esta resposta ja nasceu
    // velha -- responderia algo que ele acabou de complementar (o classico
    // "voce prefere sabado ou domingo?" logo depois dele ter dito "sabado").
    // Desfaz o turno e devolve o texto ao buffer: o proximo flush responde
    // uma vez so, com tudo.
    const chegouCoisaNova = buffers.get(chatid);
    if (chegouCoisaNova) {
      desfazerTurno(chatid, marcador);
      chegouCoisaNova.partes.unshift(texto);
      chegouCoisaNova.ids.unshift(...ids);
      console.log(`[webhook] ${chatid}: resposta descartada, cliente complementou`);
      return;
    }

    await responderComoHumano(chatid, resposta, ids);
  } catch (e) {
    // Nunca relanca: uma rejeicao solta aqui derruba o processo no Node 20.
    console.error(`[webhook] falha ao atender ${chatid}:`, e);
  }
}

// ---------------------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------------------

// Sobe junto com o processo: e o commit que esta REALMENTE no ar.
// Sem isso, "meu push subiu?" so se responde olhando log de build.
const commit = (process.env.RAILWAY_GIT_COMMIT_SHA ?? "local").slice(0, 7);
const subiuEm = new Date().toISOString();

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    commit,
    subiuEm,
    sessoes: totalSessoes(),
    modelo: config.geminiModel,
  });
});

/**
 * Confere o ?secret= da URL do webhook. Comparacao em tempo constante para nao
 * vazar o segredo por diferenca de latencia. Sem WEBHOOK_SECRET, aceita tudo.
 */
function segredoConfere(recebido: unknown): boolean {
  if (!config.webhookSecret) return true;
  if (typeof recebido !== "string") return false;
  const a = new TextEncoder().encode(recebido);
  const b = new TextEncoder().encode(config.webhookSecret);
  return a.length === b.length && timingSafeEqual(a, b);
}

app.post("/webhook", (req, res) => {
  if (!segredoConfere(req.query.secret)) {
    res.sendStatus(401);
    return;
  }

  // Responde antes de processar: a UAZAPI reenvia o evento se demorarmos.
  res.sendStatus(200);

  try {
    const body = req.body as UazapiWebhook;
    const msg = body?.message;
    if (!msg) return;

    // Filtro opcional de instancia (util com webhook GLOBAL). Vazio = aceita tudo.
    if (config.uazapiInstance && body.instanceName && body.instanceName !== config.uazapiInstance) {
      return;
    }

    if (msg.isGroup === true) return; // grupos nao sao pre-atendimento

    const chatid = msg.chatid?.trim();
    if (!chatid) return;

    // Mensagem saindo do numero do negocio. Se NAO foi a gente que mandou, um humano digitou:
    // alguem assumiu a conversa e o agente tem que sair da frente. Esse e o
    // sinal mais confiavel de handoff -- melhor que qualquer heuristica de texto.
    if (msg.fromMe === true) {
      if (msg.wasSentByApi !== true) {
        pausar(chatid, config.pausaHumanoMin * 60_000, "humano assumiu a conversa");
        cancelarBuffer(chatid);
      }
      return;
    }

    if (msg.type !== "text") return; // audio, imagem, sticker...

    const texto = msg.text?.trim();
    if (!texto) return;

    // Humano ja assumiu: nao responde por cima dele.
    if (estaPausado(chatid)) {
      console.log(`[webhook] ${chatid}: ignorado, conversa com humano`);
      return;
    }

    agendar(chatid, texto, msg.messageid, msg.senderName);
  } catch (e) {
    console.error("[webhook] payload invalido:", e);
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

// O servidor recebe webhook e responde no WhatsApp: sem credencial ele nao serve
// pra nada. Falha aqui, no boot, em vez de no primeiro lead.
assertUazapi();

if (!config.webhookSecret) {
  console.warn(
    "[boot] ATENCAO: WEBHOOK_SECRET vazio -- /webhook aceita POST de qualquer um. " +
      "Preencha e use a URL /webhook?secret=<valor> na UAZAPI."
  );
}

setInterval(limparSessoesOciosas, 15 * 60 * 1000).unref();
setInterval(limparPausasVencidas, 15 * 60 * 1000).unref();

app.listen(config.porta, () => {
  console.log(`[boot] ${config.empresaNome} | ${config.empresaCidade}`);
  console.log(`[boot] modelo: ${config.geminiModel} | agrupamento: ${config.debounceMs}ms`);
  console.log(`[boot] ouvindo na porta ${config.porta}`);
  // Nao bloqueia o boot: se falhar, o atendimento roda igual, so sem "digitando".
  void ficarOnline();
});
