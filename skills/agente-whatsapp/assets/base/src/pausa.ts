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
 * Estado em memoria, como o resto: reinicio do servidor libera as conversas.
 * Numa demo isso e aceitavel; a pausa mais longa dura horas, nao dias.
 * Em producao isso precisa de banco -- ver referencia demo-vs-producao.
 */

const pausados = new Map<string, number>();

export function pausar(chatid: string, ms: number, motivo: string): void {
  const ate = Date.now() + ms;
  const anterior = pausados.get(chatid) ?? 0;
  // Nunca encurta uma pausa existente: se o humano assumiu, um evento posterior
  // nao pode reduzir esse silencio.
  if (ate > anterior) pausados.set(chatid, ate);
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

/** Varre pausas vencidas para o Map nao crescer sem limite. */
export function limparPausasVencidas(): void {
  const agora = Date.now();
  for (const [chatid, ate] of pausados) if (agora >= ate) pausados.delete(chatid);
}
