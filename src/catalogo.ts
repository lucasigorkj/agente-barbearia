/**
 * Utilitarios de catalogo -- a parte da busca que nao depende do negocio.
 *
 * O que muda de um nicho para outro e QUAIS campos existem e quanto cada um
 * pesa. A mecanica (normalizar, pontuar por token, achar empate, formatar
 * dinheiro) e sempre a mesma, entao mora aqui.
 */

// ---------------------------------------------------------------------------
// Formatacao -- feita aqui, NUNCA pelo modelo.
//
// CICATRIZ: modelo que recebe numero cru remonta o valor errado.
// 32900 volta do modelo como "R$ 32,900.00" e o cliente le "trinta e dois
// virgula nove". O preco precisa chegar ao modelo ja escrito.
// ---------------------------------------------------------------------------

const BRL = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

const NUM = new Intl.NumberFormat("pt-BR");

/** 32900 -> "R$ 32.900" */
export function moeda(valor: number): string {
  return BRL.format(valor);
}

/** 84000 -> "84.000" */
export function numero(valor: number): string {
  return NUM.format(valor);
}

/** 45 -> "45 min" | 90 -> "1h30" */
export function duracao(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Match fuzzy
// ---------------------------------------------------------------------------

/** Minusculo, sem acento, sem pontuacao. "Barba & Cabelo!" e "barba cabelo" convergem. */
export function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Um campo do item que participa da busca, com o peso dele.
 *
 * A ORDEM importa: para cada token do cliente, o primeiro campo que casar leva
 * a pontuacao e os demais nao contam. Ponha o mais especifico primeiro.
 */
export interface Campo {
  /** O texto do item nesse campo. Ex: "Corte degrade". */
  valor: string;
  /** Pontos quando o token aparece dentro do campo. */
  peso: number;
  /** Pontos quando o token e exatamente o campo inteiro. Default: peso + 4. */
  pesoExato?: number;
  /** Casa tambem sem espacos: "xre300" encontra "XRE 300". */
  colado?: boolean;
}

/**
 * Pontua o termo do cliente contra um item, campo a campo.
 *
 * Token que casa com o campo mais especifico pesa mais que token que casa com a
 * categoria: quem diz "corte degrade" quer o degrade, e "corte" sozinho nao pode
 * ganhar do servico certo.
 */
export function pontuar(termo: string, campos: Campo[]): number {
  const tokens = normalizar(termo)
    .split(" ")
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return 0;

  const preparados = campos.map((c) => {
    const valor = normalizar(c.valor);
    return {
      valor,
      colado: c.colado ? valor.replace(/\s/g, "") : null,
      peso: c.peso,
      pesoExato: c.pesoExato ?? c.peso + 4,
    };
  });

  let score = 0;
  for (const t of tokens) {
    for (const c of preparados) {
      if (c.valor === t || c.colado === t) {
        score += c.pesoExato;
        break;
      }
      if (c.valor.includes(t) || c.colado?.includes(t)) {
        score += c.peso;
        break;
      }
    }
  }
  return score;
}

/**
 * Ranqueia e separa o melhor dos empatados.
 *
 * Empate tecnico e informacao, nao problema: quando dois itens batem igual, a
 * resposta certa e perguntar qual deles, nao escolher por conta e errar.
 *
 * ATENCAO ao calibrar `limiar`: ele precisa ficar igual ou abaixo do menor peso
 * que voce quer que passe sozinho. Limiar e pesos sao dois numeros que mudam
 * juntos -- mexeu num, confira o outro.
 */
export function ranquear<T>(
  itens: T[],
  termo: string,
  camposDe: (item: T) => Campo[],
  limiar: number
): { melhor: T | undefined; empatados: T[] } {
  const ranked = itens
    .map((item) => ({ item, s: pontuar(termo, camposDe(item)) }))
    .filter((r) => r.s >= limiar)
    .sort((a, b) => b.s - a.s);

  const topo = ranked[0];
  if (!topo) return { melhor: undefined, empatados: [] };

  const empatados = ranked.filter((r) => r.s === topo.s).map((r) => r.item);
  return { melhor: topo.item, empatados };
}

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------

/**
 * Mantem o valor ja registrado quando a nova chamada vem sem o campo.
 *
 * O modelo as vezes chama a tool de registro de novo com menos campos do que da
 * primeira vez. Sem isso, a segunda chamada apaga o que a primeira ja tinha.
 */
export function preferir(novo: string, antigo: string | undefined, vazio: string): string {
  const n = novo.trim();
  if (n && n !== vazio) return n;
  if (antigo && antigo !== vazio) return antigo;
  return vazio;
}

/** Aceita true/false vindo como boolean ou string, com fallback no valor anterior. */
export function booleano(valor: unknown, anterior: boolean | undefined): boolean {
  if (valor === true || valor === "true") return true;
  if (valor === false || valor === "false") return false;
  return anterior ?? false;
}

// ---------------------------------------------------------------------------
// Leads ja registrados, por conversa
//
// CICATRIZ: o modelo as vezes chama a tool de registro mais de uma vez no mesmo
// atendimento -- e duas entradas do mesmo cliente chegam como dois leads para
// quem vai atender. Em vez de confiar so no prompt, a segunda chamada vira
// atualizacao da primeira.
//
// Mora aqui, e nao no tool-runner, porque tools.ts precisa deste store e o
// tool-runner precisa do tools.ts: colocar os dois juntos criaria um ciclo
// de import.
// ---------------------------------------------------------------------------

const leadsRegistrados = new Map<string, Record<string, unknown>>();

export function leadAnterior<T>(chatid: string): T | undefined {
  return leadsRegistrados.get(chatid) as T | undefined;
}

export function guardarLead(chatid: string, lead: Record<string, unknown>): void {
  leadsRegistrados.set(chatid, lead);
}

export function esquecerLead(chatid: string): void {
  leadsRegistrados.delete(chatid);
}
