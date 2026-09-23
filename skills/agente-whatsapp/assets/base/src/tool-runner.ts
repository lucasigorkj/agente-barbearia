import { handlers } from "./tools";

/**
 * Despacho das tools.
 *
 * Generico: quais tools existem e o que elas devolvem esta em tools.ts, que e o
 * arquivo do negocio. Aqui fica so a rede de protecao, que vale para qualquer nicho.
 */

export type Handler = (args: Record<string, unknown>, chatid: string) => unknown;

/**
 * Executa a tool que o modelo pediu.
 *
 * Tool que lanca NAO pode derrubar o turno: o cliente ficaria sem resposta por
 * causa de um campo faltando no JSON. Erro vira objeto de erro, e o modelo
 * contorna dentro da conversa.
 *
 * `chatid` so importa para a tool de registro, que precisa saber se ja registrou
 * esta conversa.
 */
export function executarTool(
  nome: string,
  args: Record<string, unknown>,
  chatid = "avulso"
): unknown {
  const fn = handlers[nome];
  if (!fn) return { erro: `Ferramenta desconhecida: ${nome}` };
  try {
    return fn(args, chatid);
  } catch (e) {
    console.error(`[tools] falha em ${nome}:`, e);
    return { erro: "Falha ao consultar os dados. Diga que vai confirmar e siga a conversa." };
  }
}
