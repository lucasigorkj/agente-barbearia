# Agente de pré-atendimento no WhatsApp

Uma skill para [Claude Code](https://claude.com/claude-code) que constrói, do zero, um agente que
atende no WhatsApp, consulta um catálogo real, qualifica o cliente e **sai da frente** quando um
humano assume.

Extraída de um agente que roda em produção com cliente real — com sete cicatrizes de produção já
resolvidas dentro dela.

## Instalar

A skill mora na pasta `skills/agente-whatsapp` do repositório
[agente-barbearia](https://github.com/gfrabelo/agente-barbearia). Basta copiá-la para a pasta de
skills do Claude Code:

```bash
git clone https://github.com/gfrabelo/agente-barbearia.git
cp -r agente-barbearia/skills/agente-whatsapp ~/.claude/skills/
```

No Windows (PowerShell):

```powershell
git clone https://github.com/gfrabelo/agente-barbearia.git
Copy-Item -Recurse agente-barbearia\skills\agente-whatsapp "$env:USERPROFILE\.claude\skills\"
```

Pronto. A skill fica disponível em qualquer projeto.

## Usar

Abra uma pasta vazia no Claude Code e diga o que você quer:

```
vamos criar um agente de WhatsApp para uma barbearia, usa a skill agente-whatsapp
```

Ela faz quatro perguntas, mostra o plano e constrói. No fim:

```bash
npm install
npm run check      # valida a key do Gemini, o model id e function calling
npm run repl       # conversa no terminal, sem precisar de WhatsApp
```

Você vai precisar de uma [chave do Gemini](https://aistudio.google.com/apikey) (tem tier grátis).
Para ligar no WhatsApp de verdade, de uma instância da UAZAPI.

## O que ela gera

Node 20 + TypeScript + Express + Gemini (function calling) + UAZAPI. **Três dependências de
produção**, sem banco, sem framework de agente, sem RAG.

Onze arquivos são copiados prontos. Três são escritos para o seu nicho:

```
src/prompt.ts            o system prompt
src/tools.ts             catálogo, busca e registro do lead
src/data/catalogo.json   o dado do cliente
```

É isso que faz o segundo cliente custar uma fração do primeiro.

## O limite, dito com todas as letras

Isto entrega uma **demo funcional** — roda de verdade e você abre na frente do cliente. É o
suficiente para fechar o primeiro contrato.

Não é o suficiente para cobrar mensalidade. Faltam três coisas: fechar o endereço que recebe as
mensagens, guardar o lead num lugar que sobreviva a um deploy, e o mesmo para a pausa quando um
humano assume. A primeira já vem pronta na base (`WEBHOOK_SECRET`), só precisa ser ligada. As três estão descritas, com o caminho de cada uma, em
[`references/demo-vs-producao.md`](references/demo-vs-producao.md).

É a mesma arquitetura — é acrescentar, não refazer.

## O que tem dentro

| Arquivo | O que é |
|---|---|
| [`SKILL.md`](SKILL.md) | o fluxo: entrevista, plano, build |
| [`references/arquitetura.md`](references/arquitetura.md) | as duas camadas e o caminho da mensagem |
| [`references/cicatrizes.md`](references/cicatrizes.md) | sete bugs de produção e por que a correção é essa |
| [`references/system-prompt.md`](references/system-prompt.md) | o esqueleto do prompt, com os slots e três tons |
| [`references/camada-vertical.md`](references/camada-vertical.md) | como escrever os três arquivos do negócio |
| [`references/exemplo-veiculos/`](references/exemplo-veiculos/) | gabarito rodando, de uma revenda real |
| [`assets/base/`](assets/base/) | os onze arquivos que atravessam sem tocar |
