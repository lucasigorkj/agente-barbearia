# Demo contra produção

O que esta skill entrega é uma **demo funcional**: um agente que roda de verdade, atende de
verdade e que você abre no WhatsApp na frente do cliente. É o suficiente para fechar o primeiro
contrato.

Não é o suficiente para cobrar mensalidade. Três coisas precisam ser resolvidas antes — e a
arquitetura já está pronta para receber as três. Nenhuma delas pede reescrita.

---

## 1. O webhook precisa de segredo

**O que acontece hoje:** a base já valida `?secret=` na URL do webhook, **mas só se
`WEBHOOK_SECRET` estiver preenchido**. Vazio, `POST /webhook` aceita qualquer um — o boot avisa.
O filtro por `instanceName` compara uma string que vem do próprio payload — isso não é
autenticação.

**O risco real:** com o segredo vazio, qualquer pessoa que descubra a URL injeta uma mensagem
forjada e faz o seu agente responder para um número arbitrário, gastando a sua API e queimando o
número do WhatsApp.

**O caminho:** preencher `WEBHOOK_SECRET` (é só `.env`) e cadastrar na UAZAPI a URL
`/webhook?secret=<valor>`. Para produção, somar rate limit por número.

---

## 2. O lead só existe no log

**O que acontece hoje:** com `HUMANO_WHATSAPP` e `LEAD_WEBHOOK_URL` vazios — que é o default —
o lead qualificado existe **somente** no stdout do servidor. Tem um `console.log` no código
comentado como *"o CRM da demo"*. Deploy novo, log rotacionado, lead perdido.

**Atenuação imediata, sem código:** preencher as duas variáveis no `.env`. O lead passa a chegar
no WhatsApp de quem atende e num webhook de n8n, Make, Zapier ou no CRM que o cliente já usa.
Isso já resolve a demo — e é o ponto de encaixe do produto: **o cliente não troca de ferramenta,
só passa a receber o lead qualificado dentro da que ele já tem.**

**O caminho de produção:** persistir o lead antes de notificar, com status e histórico.

---

## 3. A pausa mora na memória do processo

**Esta é a pior das três**, e é a que mais custa comercialmente.

O agente cala quando um humano assume a conversa. Isso responde à objeção número 1 de qualquer
dono de negócio: *"esse bot vai responder por cima da minha equipe"*.

Só que `pausados` é um `Map` na memória. Um deploy no meio do dia **solta o agente de volta** em
conversas que uma pessoa já estava atendendo.

> O argumento comercial do produto não sobrevive a um `git push`.

**O caminho:** a pausa é a primeira coisa que vai para o banco. Antes do histórico, antes do
lead.

---

## Duas restrições que ninguém documenta

**Uma réplica, sempre.** `buffers`, `emAndamento`, `sessoes` e `pausados` são estado local do
processo. Duas instâncias quebram, ao mesmo tempo, o agrupamento, a fila por conversa e a pausa.
Não escale horizontalmente antes do banco.

**Se o Gemini cair, o cliente não recebe nada.** Exceção em `generateContent` (429, 500, timeout)
sobe até um catch que só loga. Não há retry e não há mensagem de desculpa. Silêncio absoluto do
lado de quem está esperando.

---

## A mesma arquitetura expande

O ponto que importa: nada acima pede para refazer o agente. A separação entre o que é código e o
que é modelo continua valendo — o que muda é **onde o estado mora**.

| Hoje | Produção | O que muda |
|---|---|---|
| `Map` de pausas | tabela `conversas` | `pausa.ts` vira 3 queries |
| `Map` de sessões | tabela `mensagens` | `agent.ts` lê e escreve em vez de guardar |
| `Map` de leads | tabela `leads` + CRM | `tools.ts` grava antes de notificar |
| `console.log` como CRM | CRM real pelo webhook que já existe | nada — a porta já está aberta |
| `catalogo.json` | tabela de catálogo | `tools.ts` troca o import por uma query |
| segredo opcional | segredo obrigatório + rate limit | um middleware em `index.ts` |
| uma réplica | N réplicas | consequência do banco, não causa |

Ordem recomendada: **pausa → lead → sessão → catálogo**. Cada passo entrega valor sozinho e
nenhum deles obriga o seguinte.

---

## O que dizer para o cliente

Seja honesto sobre onde a demo para. Funciona melhor comercialmente do que fingir que está
pronto, porque a primeira falha em produção custa o contrato inteiro:

> "Isso aqui já atende e já qualifica. Para virar o canal oficial de atendimento, faltam três
> coisas: fechar o endereço que recebe as mensagens, guardar o lead num lugar que sobreviva a um
> deploy, e o mesmo para a pausa quando sua equipe assume. É a mesma arquitetura — é acrescentar
> banco, não refazer."
