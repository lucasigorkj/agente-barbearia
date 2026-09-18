/**
 * Verificacao de setup: `npm run check`
 *
 * Confirma que a GEMINI_API_KEY e valida, que o GEMINI_MODEL configurado existe
 * e que ele responde com function calling. Rode isso ANTES de apontar o webhook.
 *
 * CICATRIZ: o Google aposenta model id. gemini-2.0-flash, por exemplo, foi
 * desligado em 01/06/2026 -- um id morto so aparece como 404 na primeira
 * mensagem de cliente real, que e o pior momento possivel para descobrir.
 */
import { GoogleGenAI } from "@google/genai";
import { config } from "./config";
import { declaracoes, exemploDeBusca } from "./tools";
import { executarTool } from "./tool-runner";

async function main(): Promise<void> {
  console.log(`empresa : ${config.empresaNome} (${config.empresaCidade || "cidade nao configurada"})`);
  console.log(`modelo  : ${config.geminiModel}`);
  console.log(`uazapi  : ${config.uazapiUrl || "(nao configurada -- so precisa para o servidor)"}\n`);

  const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

  // 1. O model id existe?
  console.log("1/3  model id...");
  const modelos: string[] = [];
  for await (const m of await ai.models.list()) {
    if (m.name) modelos.push(m.name.replace(/^models\//, ""));
  }
  if (!modelos.includes(config.geminiModel)) {
    console.error(`     FALHOU: "${config.geminiModel}" nao esta disponivel nesta key.`);
    const flash = modelos.filter((m) => m.includes("flash")).slice(0, 12);
    console.error(`     Modelos flash disponiveis:\n       ${flash.join("\n       ")}`);
    process.exit(1);
  }
  console.log("     ok\n");

  // 2. Ele gera texto?
  console.log("2/3  geracao...");
  const r1 = await ai.models.generateContent({
    model: config.geminiModel,
    contents: "Responda apenas: ok",
    config: { maxOutputTokens: 20 },
  });
  console.log(`     ok -> ${(r1.text ?? "").trim()}\n`);

  // 3. Ele chama as tools? (o agente inteiro depende disso)
  //
  // A pergunta sai do proprio catalogo: uma pergunta fixa vira mentira assim que
  // o catalogo muda, e o check passa a imprimir "nao encontrado" toda vez que roda.
  console.log("3/3  function calling...");
  const pergunta = exemploDeBusca();
  console.log(`     perguntando: "${pergunta}"`);
  const r2 = await ai.models.generateContent({
    model: config.geminiModel,
    contents: pergunta,
    config: {
      tools: [{ functionDeclarations: declaracoes }],
      automaticFunctionCalling: { disable: true },
    },
  });
  const chamada = (r2.functionCalls ?? [])[0];
  if (!chamada) {
    console.error("     FALHOU: o modelo nao chamou nenhuma tool.");
    console.error(`     Respondeu direto: ${(r2.text ?? "").trim()}`);
    console.error("     Troque GEMINI_MODEL por um tier mais forte.");
    process.exit(1);
  }
  const saida = executarTool(chamada.name ?? "", (chamada.args ?? {}) as Record<string, unknown>);
  console.log(`     ok -> ${chamada.name}(${JSON.stringify(chamada.args)})`);
  console.log(`     catalogo respondeu -> ${JSON.stringify(saida)}\n`);

  console.log("Tudo certo. Pode subir.");
}

main().catch((e) => {
  console.error("\nFALHOU:", e instanceof Error ? e.message : e);
  process.exit(1);
});
