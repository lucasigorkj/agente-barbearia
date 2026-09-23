---
name: agente-whatsapp
description: Constrói do zero um agente de pré-atendimento no WhatsApp que responde, qualifica o cliente e entrega o lead pronto para um humano — em qualquer nicho (barbearia, clínica, revenda, imobiliária, academia, estúdio). Use sempre que pedirem agente, bot, atendente ou automação de WhatsApp, quiserem qualificar lead automaticamente ou responder cliente fora do horário, e também quando descreverem só a dor ("perco cliente que chama de madrugada", "minha equipe não dá conta de responder no WhatsApp"). Use também para adaptar um agente existente a outro nicho.
---

# Agente de pré-atendimento no WhatsApp

Extraído de um agente que roda em produção, com cliente real. O que ele faz: atende no WhatsApp,
consulta um catálogo real, qualifica, agenda e **sai da frente** quando um humano assume.

**O que isto entrega:** uma demo funcional — roda de verdade e você abre na frente do cliente.
**O que isto não entrega:** produção. Três coisas ficam faltando, e estão escritas em
`references/demo-vs-producao.md`. Diga isso ao usuário no final. É honesto e vende melhor.

Node 20 + TypeScript + Express + Gemini (function calling) + UAZAPI. Três dependências, sem banco.

---

## Passo 1 — Leia o briefing antes de perguntar qualquer coisa

Extraia do que o usuário já escreveu: **nicho, nome do negócio, cidade, nome do atendente, o que
o negócio vende**.

> **Nunca pergunte o que já foi respondido.** Se ele disse "uma barbearia", o nicho está
> decidido. Perguntar de novo queima confiança na primeira interação.

O que faltar de identidade **não vira pergunta** — vira default no `.env`, e você avisa qual usou
no final. Nome, cidade, endereço, horário e para onde o lead vai são `.env` puro, zero código.

---

## Passo 2 — Quatro perguntas, num painel só

Use **uma única** chamada de AskUserQuestion com as quatro. São as quatro que mudam o código;
todo o resto tem default.

> **Escreva em linguagem de dono de negócio, nunca de arquitetura.** Quem responde não sabe o
> que é uma tool e não precisa saber. "Forma do catálogo" está errado; "de onde vem o preço"
> está certo — e decidem a mesma coisa.

**Adapte o vocabulário ao nicho**: "serviço" numa barbearia, "veículo" numa revenda, "imóvel"
numa imobiliária. As opções abaixo são o esqueleto, não o texto literal.

### Pergunta 1 — "O que o agente precisa conseguir antes de te passar a conversa?"

| Opção | Consequência |
|---|---|
| Marcar o horário | agendamento é o evento de conversão; o prompt conduz até o cliente aceitar um dia |
| Saber o que a pessoa quer e quanto pode pagar | qualifica e entrega; sem agendamento |
| Passar um orçamento | o agente responde valor e entrega o lead |

Decide os campos e o gatilho de `registrarLead`, e a seção "Seu objetivo" do prompt.

### Pergunta 2 — "Como o agente fala com o cliente?"

| Opção | Consequência |
|---|---|
| Descontraído, como alguém digitando do celular | tom A — o default, é o que converte no WhatsApp |
| Educado e um pouco mais formal | tom B |
| Curto e direto, sem conversa | tom C |

Os três tons estão escritos em `references/system-prompt.md`. **Troque também os few-shots** —
o modelo copia os exemplos, não a descrição.

### Pergunta 3 — "De onde vem o preço?"

| Opção | Consequência |
|---|---|
| Uma lista de serviços com preço fixo | `buscarX` + `listarX` + JSON simples |
| Um catálogo grande, com variações | as mesmas tools, com mais peso no ranqueamento |
| Não tem preço fixo, depende de avaliação | sem tool de preço; o prompt proíbe falar valor |

### Pergunta 4 — "O que você precisa saber do cliente?" *(múltipla escolha)*

Nome · o que ele quer · dia e horário · forma de pagamento · orçamento · se já é cliente ·
o que for do nicho.

Vira o tipo `Lead` e o formatador que chega no WhatsApp de quem atende.

---

## Passo 3 — Plan mode antes de escrever

Entre em plan mode e apresente o plano. Se plan mode não estiver disponível, escreva o plano em
texto e peça confirmação — **não comece a escrever arquivo sem isso**.

O plano tem que dizer, em uma linha cada:

- o que o agente vai conseguir fazer, e o que ele não vai fazer
- os 11 arquivos copiados e os 3 escritos
- quantos itens o catálogo vai ter, e que você precisa deles (ou vai inventar exemplos)
- **a fronteira**: o agente **propõe** o horário e o humano confirma. Agenda real, banco e CRM
  são o passo de produção, não este.

Essa última linha não é ressalva burocrática: é o que impede o usuário de prometer ao cliente
dele algo que a demo não faz.

---

## Passo 4 — Construa

### 4.1 Copie a base, sem alterar

Os 11 arquivos de `assets/base/` vão para o projeto **como estão**. É onde moram sete cicatrizes
de produção (`references/cicatrizes.md`). Alterar qualquer um deles é reintroduzir um bug que já
custou caro.

```
package.json  tsconfig.json  .gitignore  .env.example
src/index.ts  src/agent.ts  src/whatsapp.ts  src/pausa.ts  src/notificar.ts
src/config.ts  src/datas.ts  src/catalogo.ts  src/tool-runner.ts
src/check.ts  src/repl.ts
```

Ajuste só o campo `name` do `package.json`.

### 4.2 Escreva os três arquivos do negócio

Nesta ordem — o prompt depende das tools:

1. **`src/data/catalogo.json`** — peça os dados reais ao usuário. Se ele não tiver na mão,
   escreva 6 a 10 itens plausíveis e **diga em voz alta que são exemplos** para ele trocar.
2. **`src/tools.ts`** — siga `references/camada-vertical.md`.
3. **`src/prompt.ts`** — siga `references/system-prompt.md`, no tom escolhido.

Gabarito rodando, para os três: `references/exemplo-veiculos/`.

### 4.3 Escreva o `.env`

Copie `.env.example` para `.env` e preencha nome, cidade e atendente com o que veio do briefing.
Deixe `GEMINI_API_KEY` vazia e diga onde pegar: https://aistudio.google.com/apikey

Deixe `EMPRESA_ENDERECO` e `EMPRESA_HORARIO` **vazios** se o usuário não informou. Vazio é melhor
que errado — o código já troca isso por uma proibição explícita no prompt, e horário inventado
manda o cliente na porta fechada.

---

## Passo 5 — Entregue

```bash
npm install
npm run check      # valida key, model id e function calling
npm run repl       # conversa no terminal, sem WhatsApp
```

Mande rodar o `repl` **antes** de qualquer coisa com WhatsApp: cerca de 90% do ajuste de tom sai
ali, e cada volta custa dez vezes menos que testar pelo WhatsApp.

Para ligar no WhatsApp de verdade: instância na UAZAPI, `UAZAPI_URL` e `UAZAPI_TOKEN` no `.env`,
e uma URL pública. Dois caminhos:

- **Deploy (recomendado):** subir o repo no GitHub, importar na Railway, colar as variáveis do
  `.env` em *Variables* e gerar domínio em *Settings > Networking*. `/health` deve responder
  `{"ok": true}`.
- **Local:** `npm run dev` e expor com `cloudflared tunnel --url http://localhost:3000`.

Nos dois, gere um `WEBHOOK_SECRET` e aponte o webhook da instância (evento `messages`) para
`https://<url-publica>/webhook?secret=<valor>`. Sem o segredo, a URL é uma porta aberta.

E feche dizendo o que falta para produção, com as três de `references/demo-vs-producao.md`.

---

## Regras que não podem regredir

Se algo abaixo sumir, o agente parece funcionar e não funciona:

1. **Responda sempre no `chatid`.** Nunca em `sender` — vem como `@lid`, não é telefone, e
   responder nele não chega em ninguém sem dar erro nenhum.
2. **Agrupe mensagens picadas** com janela que reinicia a cada mensagem nova.
3. **Cheque duas vezes depois do modelo**: humano assumiu? cliente complementou? Se sim, desfaz
   o turno e não envia.
4. **Pause quando um humano digitar** (`fromMe && !wasSentByApi`). É a objeção número 1 de
   qualquer dono de negócio.
5. **Formate dinheiro no código, nunca no modelo.** `32900` volta do modelo como `R$ 32,900.00`.
6. **O preço nunca entra no system prompt.** Só chega pelo retorno da tool.
7. **Toda tool devolve um campo `instrucao`** dizendo o que fazer com o resultado.
8. **Registre o lead uma vez só**, com dedupe no código — não confie só no prompt.

---

## Mapa das referências

| Arquivo | Quando ler |
|---|---|
| `references/arquitetura.md` | as duas camadas e o caminho da mensagem ponta a ponta |
| `references/system-prompt.md` | escrevendo `prompt.ts` — esqueleto, slots e os três tons |
| `references/camada-vertical.md` | escrevendo `tools.ts` e o catálogo |
| `references/cicatrizes.md` | antes de mexer em qualquer arquivo de `assets/base/` |
| `references/demo-vs-producao.md` | no fechamento, e quando perguntarem sobre produção |
| `references/exemplo-veiculos/` | gabarito rodando dos três arquivos do negócio |
