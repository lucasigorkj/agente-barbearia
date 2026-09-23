# Agente de WhatsApp para Barbearia

Um agente de IA que atende seus clientes no WhatsApp 24 horas por dia. Ele tira dúvidas, passa
os preços, combina dia e horário e envia o pedido pronto para o barbeiro confirmar.

▶️ **Assista o passo a passo:** https://www.youtube.com/watch?v=o-MKf8A4EgI

```
cliente> Bora, queria para sábado
agente > Fechou. Prefere só cabelo, barba ou combo?
cliente> Manda o combo
agente > O combo corte e barba sai R$ 75. Sábado você prefere de manhã ou à tarde?
```

Neste repositório tem duas coisas:

- **O agente da barbearia**, pronto para rodar (pasta `src/`)
- **A skill `agente-whatsapp`**, que cria um agente desses para **qualquer nicho** com o Claude
  Code (pasta `skills/`)

---

## Do que você precisa

- [Node.js 20 ou mais novo](https://nodejs.org/)
- Uma chave do Gemini, que é grátis: [Google AI Studio](https://aistudio.google.com/apikey)
- Para ligar no WhatsApp: uma conta na [UAZAPI](https://uazapi.com/) e outra na
  [Railway](https://railway.com/)
- [Claude Code](https://claude.com/claude-code), só se for criar o seu agente com a skill

---

## Opção 1: criar o seu agente com a skill

É o que o vídeo mostra. Serve para qualquer nicho.

**1. Instale a skill**

```bash
git clone https://github.com/gfrabelo/agente-barbearia.git
cp -r agente-barbearia/skills/agente-whatsapp ~/.claude/skills/
```

No Windows (PowerShell):

```powershell
git clone https://github.com/gfrabelo/agente-barbearia.git
Copy-Item -Recurse agente-barbearia\skills\agente-whatsapp "$env:USERPROFILE\.claude\skills\"
```

**2. Peça o agente**

Abra uma pasta vazia, abra o Claude Code no modo **Plan** e digite:

```
quero criar um agente para uma barbearia, use a skill /agente-whatsapp
```

Troque "barbearia" pelo seu nicho.

**3. Responda às perguntas e aprove o plano**

O Claude Code vai perguntar o objetivo do agente, o tom de voz, de onde vem o preço e quais dados
do cliente você quer. Leia o plano, aprove e deixe ele construir.

Depois, siga a partir do **passo 2 da Opção 2**.

---

## Opção 2: rodar este agente da barbearia

**1. Baixe o projeto**

```bash
git clone https://github.com/gfrabelo/agente-barbearia.git
cd agente-barbearia
npm install
```

**2. Coloque sua chave**

Copie o arquivo de exemplo:

```bash
cp .env.example .env
```

Abra o `.env` e preencha:

```env
GEMINI_API_KEY=cole-sua-chave-aqui
EMPRESA_NOME=Barbearia Navalha
EMPRESA_CIDADE=São Paulo
ATENDENTE_NOME=Léo
```

**3. Converse com o agente no terminal**

```bash
npm run repl
```

Pronto: você já está falando com o agente, sem precisar de WhatsApp. Digite `/sair` para encerrar.

Quer mudar os serviços e preços? Edite `src/data/catalogo.json`.
Quer mudar o jeito de falar? Edite `src/prompt.ts`.

---

## Colocar no WhatsApp

**1. Suba o seu projeto para o GitHub**

Crie um repositório e envie o código. O `.env` com a sua chave **não sobe**, fica só no seu
computador.

**2. Conecte o WhatsApp na UAZAPI**

1. Crie uma instância (a grátis serve para teste).
2. Clique em **Conectar** e escaneie o QR Code com o WhatsApp do agente.
3. Anote a **Server URL** e o **Instance Token**.

> Use um número de teste ou o número do negócio, nunca o seu pessoal: o agente responde a
> qualquer pessoa que mandar mensagem.

**3. Publique na Railway**

1. **New Project → Deploy from GitHub repo** → escolha o seu repositório.
2. Em **Variables → Raw Editor**, cole:

   ```env
   GEMINI_API_KEY=sua-chave
   EMPRESA_NOME=Barbearia Navalha
   EMPRESA_CIDADE=São Paulo
   ATENDENTE_NOME=Léo
   TIMEZONE=America/Sao_Paulo
   UAZAPI_URL=sua-server-url
   UAZAPI_TOKEN=seu-instance-token
   HUMANO_WHATSAPP=5511999998888
   WEBHOOK_SECRET=invente-uma-senha-longa
   ```

   `HUMANO_WHATSAPP` é o número que recebe os pedidos (55 + DDD + número).
   `WEBHOOK_SECRET` é uma senha que você inventa; ela impede que outras pessoas usem o seu agente.

3. Em **Settings → Networking**, clique em **Generate Domain**.
4. Abra `https://sua-url.up.railway.app/health` no navegador. Se aparecer `"ok": true`, está no ar.

**4. Ligue o webhook na UAZAPI**

Na sua instância, vá em **Webhook → Criar Webhook** e preencha:

- **URL:** `https://sua-url.up.railway.app/webhook?secret=A-MESMA-SENHA-DO-WEBHOOK_SECRET`
- **Eventos:** `messages`

Habilite e salve.

**5. Teste**

Mande uma mensagem para o número do agente **de outro celular**. Ele responde em alguns segundos.

---

## Bom saber

- **Ele não vê a agenda.** O agente combina um horário com o cliente, e o barbeiro confirma.
- **Quando alguém da equipe responde, o agente fica quieto** naquela conversa. Por isso, se você
  testar mandando mensagem do próprio número do agente, ele não responde.
- **Não tem banco de dados.** Se o servidor reiniciar, as conversas em andamento são esquecidas.
  Para virar um produto de verdade, os próximos passos são: banco de dados, integração com CRM e
  um painel de leads.

## Licença

[MIT](LICENSE). Use, adapte e venda para os seus clientes à vontade.
