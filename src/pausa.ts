import fs from "node:fs";
import path from "node:path";
import { config } from "./config";

/**
 * Silencia o agente numa conversa.
 *
 * O agente e pre-atendimento: existe para entregar o lead mastigado e SAIR DA
 * FRENTE. Duas situacoes exigem que ele pare de responder:
 *
 * 1. Lead registrado -- o humano assumiu. Bot que continua falando atropela
 *    quem esta atendendo, e essa e a objecao numero 1 de qualquer dono de
 *    negocio ("esse bot vai responder por cima da minha equipe").
 * 2. Um humano digitou manualmente no WhatsApp do negocio -- sinal claro de que
 *    alguem entrou na conversa. Vale mesmo antes do lead ficar pronto.
 *
 * Persistido em disco (config.pastaDados): um deploy no meio do dia NAO solta o
 * agente de volta em conversa que o barbeiro ja assumiu. O Map continua sendo a
 * fonte de leitura; o arquivo e so o que sobrevive ao reinicio.
 */

const arquivo = path.join(config.pastaDados, "pausas.json");
const pausados = carregar();

function carregar(): Map<string, number> {
  try {
    const bruto = JSON.parse(fs.readFileSync(arquivo, "utf8")) as Record<string, number>;
    const agora = Date.now();
    const vivas = Object.entries(bruto).filter(
      ([, ate]) => typeof ate === "number" && ate > agora
    );
    console.log(`[pausa] ${vivas.length} pausa(s) restaurada(s) de ${arquivo}`);
    return new Map(vivas);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error(`[pausa] falha ao ler ${arquivo}, comecando vazio:`, e);
    }
    return new Map();
  }
}

/**
 * Escrita atomica (tmp + rename): um crash no meio nunca deixa o arquivo pela
 * metade. Sincrona de proposito -- o arquivo e minusculo e a pausa precisa
 * estar no disco antes do proximo evento do webhook.
 */
function salvar(): void {
  try {
    fs.mkdirSync(config.pastaDados, { recursive: true });
    const tmp = `${arquivo}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(pausados)));
    fs.renameSync(tmp, arquivo);
  } catch (e) {
    // Nao derruba o atendimento: a pausa segue valendo em memoria.
    console.error(`[pausa] falha ao salvar ${arquivo}:`, e);
  }
}

export function pausar(chatid: string, ms: number, motivo: string): void {
  const ate = Date.now() + ms;
  const anterior = pausados.get(chatid) ?? 0;
  // Nunca encurta uma pausa existente: se o humano assumiu, um evento posterior
  // nao pode reduzir esse silencio.
  if (ate > anterior) {
    pausados.set(chatid, ate);
    salvar();
  }
  console.log(`[pausa] ${chatid} silenciado por ${Math.round(ms / 60000)}min (${motivo})`);
}

export function estaPausado(chatid: string): boolean {
  const ate = pausados.get(chatid);
  if (!ate) return false;
  if (Date.now() >= ate) {
    pausados.delete(chatid);
    return false;
  }
  return true;
}

/** Varre pausas vencidas para o Map e o arquivo nao crescerem sem limite. */
export function limparPausasVencidas(): void {
  const agora = Date.now();
  let mudou = false;
  for (const [chatid, ate] of pausados) {
    if (agora >= ate) {
      pausados.delete(chatid);
      mudou = true;
    }
  }
  if (mudou) salvar();
}
