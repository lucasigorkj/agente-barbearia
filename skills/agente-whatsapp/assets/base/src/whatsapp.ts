import { assertUazapi, config } from "./config";

/**
 * UAZAPI: envio de texto + humanizacao (lida, digitando, pausa).
 *
 * Contratos usados:
 *   POST /send/text         { number, text, linkPreview? }
 *   POST /message/markread  { id: string[] }
 *   POST /message/presence  { chatId, presence: 'composing' | 'paused' }
 *
 * Header de auth em todos: `token: <TOKEN_DA_INSTANCIA>` (minusculo, nao e Bearer).
 *
 * IMPORTANTE: markread e presence sao enfeite. Se a instancia nao suportar, se o
 * corpo estiver diferente ou se der timeout, a RESPOSTA AINDA TEM QUE SAIR --
 * por isso as duas falham em silencio (log de aviso) e nunca propagam erro.
 * O envio de texto, esse sim, propaga: se falhou, ninguem recebeu nada.
 */

/** "5513999998888@s.whatsapp.net" -> "5513999998888" */
function soDigitos(chatid: string): string {
  return chatid.split("@")[0]!.replace(/\D/g, "");
}

async function post(rota: string, corpo: unknown, timeoutMs = 20_000): Promise<Response> {
  assertUazapi();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${config.uazapiUrl}${rota}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: config.uazapiToken },
      body: JSON.stringify(corpo),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

const espere = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Enfeites -- falham em silencio
// ---------------------------------------------------------------------------

/** Dois tiques azuis. Aceita varios ids porque o agrupamento junta mensagens. */
export async function marcarComoLida(ids: string[]): Promise<void> {
  if (!config.humanizar || ids.length === 0) return;
  try {
    const res = await post("/message/markread", { id: ids }, 8_000);
    if (!res.ok) {
      console.warn(`[whatsapp] markread ${res.status} (ignorado)`);
    }
  } catch (e) {
    console.warn("[whatsapp] markread falhou (ignorado):", e instanceof Error ? e.message : e);
  }
}

/**
 * Poe a instancia como "online" (presenca available).
 *
 * Sem isso a conta fica `unavailable` e o "digitando..." tende a nao aparecer para
 * o cliente -- o WhatsApp nao mostra composing de contato que consta offline.
 * Chamado uma vez no boot. Falha em silencio como o resto da humanizacao.
 */
export async function ficarOnline(): Promise<void> {
  if (!config.humanizar) return;
  try {
    const res = await post("/instance/presence", { presence: "available" }, 8_000);
    if (!res.ok) console.warn(`[whatsapp] instance/presence ${res.status} (ignorado)`);
    else console.log("[whatsapp] instancia online");
  } catch (e) {
    console.warn("[whatsapp] instance/presence falhou (ignorado):", e instanceof Error ? e.message : e);
  }
}

async function presenca(chatid: string, presence: "composing" | "paused"): Promise<void> {
  try {
    // Campo e `number`, NAO `chatId`. O SDK publico documenta chatId e esta errado:
    // contra a API real isso devolve 400 "Invalid number". Verificado ao vivo.
    const res = await post("/message/presence", { number: soDigitos(chatid), presence }, 8_000);
    if (!res.ok) console.warn(`[whatsapp] presence ${presence} ${res.status} (ignorado)`);
  } catch (e) {
    console.warn("[whatsapp] presence falhou (ignorado):", e instanceof Error ? e.message : e);
  }
}

/**
 * Quanto tempo "digitando" antes de mandar.
 *
 * Digitacao real (~4 char/s) daria 25s numa resposta de 100 caracteres -- longe
 * demais para quem esta comparando preco em outros 7 lugares. O que soa humano
 * no WhatsApp comercial e alguns segundos, entao: base + por caractere, com teto.
 */
function tempoDigitando(texto: string): number {
  return Math.min(config.digitandoBaseMs + texto.length * config.digitandoPorCharMs, config.digitandoMaxMs);
}

// ---------------------------------------------------------------------------
// Envio
// ---------------------------------------------------------------------------

/** Envio cru, sem humanizacao. Propaga erro de proposito. */
export async function enviarTexto(chatid: string, texto: string): Promise<void> {
  const numero = soDigitos(chatid);
  if (!numero) throw new Error(`chatid invalido: ${chatid}`);

  const res = await post("/send/text", { number: numero, text: texto, linkPreview: false });
  if (!res.ok) {
    const corpo = await res.text().catch(() => "");
    throw new Error(`UAZAPI ${res.status}: ${corpo.slice(0, 300)}`);
  }
  console.log(`[whatsapp] -> ${numero}: ${texto.replace(/\n/g, " | ")}`);
}

/** Marca como lida, mostra "digitando...", espera e envia. */
export async function responderComoHumano(
  chatid: string,
  texto: string,
  idsRecebidos: string[] = []
): Promise<void> {
  if (!config.humanizar) {
    await enviarTexto(chatid, texto);
    return;
  }

  await marcarComoLida(idsRecebidos);
  await presenca(chatid, "composing");

  try {
    await espere(tempoDigitando(texto));
    await enviarTexto(chatid, texto);
  } catch (e) {
    // Enviar falhou: tira o "digitando..." para nao ficar preso na tela do cliente.
    await presenca(chatid, "paused");
    throw e;
  }
}
