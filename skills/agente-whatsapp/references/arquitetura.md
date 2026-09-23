# Arquitetura

## A regra que decide tudo

> **O código decide o que é verificável. O modelo decide o que é conversa.**

Toda vez que você não souber onde uma coisa mora, pergunte: **isso tem resposta certa?**
Se tem, é código. Se depende de julgamento, é modelo.

| Código (if/else) | Modelo (Gemini) |
|---|---|
| Preço, catálogo, disponibilidade | O texto de toda mensagem enviada |
| Que dia é hoje, e os próximos 7 | Entender que "sexta que vem" é dia 20 |
| Se um humano já assumiu a conversa | O ritmo da qualificação |
| Se a mensagem veio de grupo | Qual ferramenta chamar, e com quais argumentos |
| Formatação de dinheiro e de data | Julgar se o cliente aceitou ou só desconversou |
| Agrupar mensagens picadas | Extrair nome e valores do texto livre |
| Descartar resposta que nasceu velha | — |

Não existe template de resposta em lugar nenhum deste projeto. **Toda** frase que o cliente lê
foi escrita pelo modelo. E **nenhum** dado que o cliente lê foi inventado pelo modelo.

### O exemplo que prova a régua

Mandar `32900` para o modelo e pedir que ele fale o preço devolve **"R$ 32,900.00"** — formato
americano. O cliente lê "trinta e dois vírgula nove".

Por isso `moeda()` roda em `catalogo.ts`, no código, **antes** de o número entrar na resposta da
tool. O modelo só repassa uma string que já está certa.

É micro. É também exatamente o que separa um agente de vídeo de um agente que se entrega para
alguém que depende dele para vender.

---

## A terceira camada: instrução de volta pela tool

Um padrão que vale a pena copiar. A tool não devolve só dados — devolve um campo `instrucao` em
linguagem natural que reforça a regra **no exato momento em que ela importa**:

```ts
return {
  encontrado: false,
  instrucao: "Nao ha esse item. Diga que nao tem no momento e ofereca as sugestoes. Nao invente preco.",
  sugestoes: sugestoes(),
};
```

Sem essa linha, o modelo tende a preencher a lacuna sozinho — inventa um preço plausível.
Regra no system prompt é uma instrução entre outras cem; regra no retorno da função chega no
instante da decisão. **Use as duas.**

---

## O caminho de uma mensagem, do webhook até a resposta

```
POST /webhook
  │
  ├─ res.sendStatus(200) ANTES de processar   ← a UAZAPI reenvia se demorar
  │
  ├─ FILTROS (síncronos, baratos, nesta ordem)
  │    grupo?                    → sai
  │    chatid ausente?           → sai
  │    fromMe && !wasSentByApi?  → PAUSA 60min (humano assumiu) e sai
  │    fromMe?                   → sai (foi a gente)
  │    type !== "text"?          → sai (áudio, imagem, sticker)
  │    conversa pausada?         → sai
  │
  ├─ AGRUPAMENTO  (debounce de 6s por conversa)
  │    cada mensagem nova reinicia a janela
  │    "oi" + "tem o Onix" + "2020" viram UM turno
  │
  ├─ FILA  (encadeia no turno anterior da MESMA conversa)
  │    dois turnos nunca mexem no mesmo histórico ao mesmo tempo
  │
  ├─ TURNO
  │    marcarHistorico()                 ← guarda o ponto de desfazer
  │    buildSystemPrompt()               ← reconstruído AGORA (carrega a data)
  │    loop de até 5 rodadas de tool
  │       └─ Gemini → functionCalls? → executarTool() → devolve → Gemini
  │
  ├─ ANTI-RESPOSTA-VELHA  (duas checagens, DEPOIS do modelo)
  │    humano assumiu enquanto pensávamos?  → desfazTurno, engole a resposta
  │    cliente mandou mais coisa?           → desfazTurno, devolve ao buffer
  │
  └─ SAÍDA
       marcar como lida → "digitando..." → espera proporcional → envia
```

**Por que os filtros vêm antes do buffer:** cada um deles é uma chamada ao Gemini que você não paga
e uma resposta errada que o cliente não recebe.

**Por que as checagens de "resposta velha" vêm depois do modelo:** porque o mundo muda enquanto ele
pensa. A resposta estava certa quando foi gerada e ficou errada quando chegou.

---

## Os arquivos

Onze atravessam sem tocar. Três são do negócio.

| Arquivo | Papel |
|---|---|
| `index.ts` | Webhook, filtros, agrupamento, fila, anti-resposta-velha |
| `agent.ts` | Loop de tools, histórico, poda, limpeza da saída |
| `whatsapp.ts` | Cliente UAZAPI: enviar, marcar lida, "digitando" |
| `pausa.ts` | Handoff — silencia o agente numa conversa |
| `notificar.ts` | Entrega do lead: WhatsApp + webhook |
| `config.ts` | A camada de troca de cliente (tudo vem do `.env`) |
| `datas.ts` | O bloco de data do prompt e o bloco de endereço |
| `catalogo.ts` | Busca fuzzy, formatação, store de leads |
| `tool-runner.ts` | Despacho das tools com rede de proteção |
| `check.ts` | Valida key, model id e function calling antes do deploy |
| `repl.ts` | Conversa no terminal, sem WhatsApp |
| **`prompt.ts`** | **DO NEGÓCIO** — o system prompt |
| **`tools.ts`** | **DO NEGÓCIO** — catálogo, busca, lead |
| **`data/catalogo.json`** | **DO NEGÓCIO** — o dado do cliente |

Três dependências de produção: `@google/genai`, `express`, `dotenv`. Sem framework de agente,
sem banco vetorial, sem RAG.

**Sobre RAG:** se o catálogo tem 8 ou 40 itens, busca vetorial é overengineering. RAG resolve
problema de volume. Um filtro resolve problema de 8 itens. Só considere quando o catálogo passar
de algumas centenas de itens com texto descritivo longo.
