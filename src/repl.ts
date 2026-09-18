/**
 * REPL de terminal: `npm run repl`
 *
 * Conversa com o agente direto, sem WhatsApp e sem UAZAPI. E aqui que se ajusta
 * tom e fluxo -- o loop e instantaneo e nao depende de instancia conectada.
 * Cerca de 90% do ajuste de conversa sai aqui, antes de gastar volta no WhatsApp.
 *
 * Comandos: /novo (zera a conversa), /sair
 */
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { config } from "./config";
import { responder, resetarSessao } from "./agent";

const VERDE = "\x1b[32m";
const CINZA = "\x1b[90m";
const NEGRITO = "\x1b[1m";
const RESET = "\x1b[0m";

/** Simula o pushname do WhatsApp, para testar o caminho do "ja sei seu nome". */
const NOME_CONTATO_TESTE = process.env.REPL_NOME ?? "Ana";

async function main(): Promise<void> {
  let chatid = `repl-${Date.now()}`;

  console.log(`${NEGRITO}${config.empresaNome}${RESET} ${CINZA}| ${config.geminiModel}${RESET}`);
  console.log(`${CINZA}/novo zera a conversa, /sair encerra${RESET}\n`);

  const rl = readline.createInterface({ input: stdin, output: stdout });

  for (;;) {
    let entrada: string;
    try {
      entrada = (await rl.question(`${NEGRITO}cliente>${RESET} `)).trim();
    } catch {
      break; // stdin fechou (Ctrl+D ou entrada vinda de pipe) -- saida limpa
    }

    if (!entrada) continue;
    if (entrada === "/sair") break;
    if (entrada === "/novo") {
      resetarSessao(chatid);
      chatid = `repl-${Date.now()}`;
      console.log(`${CINZA}(conversa zerada)${RESET}\n`);
      continue;
    }

    try {
      const inicio = Date.now();
      const resposta = await responder(chatid, entrada, NOME_CONTATO_TESTE);
      const ms = Date.now() - inicio;
      console.log(`${VERDE}agente >${RESET} ${resposta}  ${CINZA}(${ms}ms)${RESET}\n`);
    } catch (e) {
      console.error(`${CINZA}erro:${RESET}`, e instanceof Error ? e.message : e, "\n");
    }
  }

  rl.close();
}

main().catch((e) => {
  console.error("falhou:", e instanceof Error ? e.message : e);
  process.exit(1);
});
