# Cicatrizes

Sete coisas que quebraram em produção, com cliente real do outro lado. Todas já estão
resolvidas em `assets/base/` — este arquivo existe para você **não desfazer** nenhuma delas.

O padrão que une todas: **nenhuma é sobre o modelo.** Todas são sobre o que está em volta dele.

---

## 1. Responder no campo errado — e não dar erro nenhum

**Sintoma:** você responde, o log diz que enviou, a API devolve 200. A mensagem não chega em
ninguém.

**Causa:** o payload do WhatsApp traz dois identificadores. `sender` vem como
`138401042923712@lid` — um id interno, **não é telefone**. Responder para o `@lid` não entrega
para pessoa nenhuma, e nada falha.

**Correção:** o alvo da resposta é sempre `chatid`.

```ts
const chatid = msg.chatid?.trim();   // certo
// msg.sender                        // ERRADO: @lid, não é telefone
```

**Por que é traiçoeiro:** é o único bug da lista que passa em todos os testes. Não há exceção,
não há status de erro, não há log vermelho. Custou um dia inteiro.

---

## 2. Cliente escreve picado

**Sintoma:** o agente responde três vezes seguidas e cada resposta ignora a mensagem seguinte.
Parece robô em dois segundos.

**Causa:** ninguém escreve parágrafo no WhatsApp. A pessoa manda `oi`, depois `tem o Onix`,
depois `2020`. São três webhooks.

**Correção:** buffer por conversa com janela de 6 segundos, e **cada mensagem nova reinicia a
janela**. No fim, junta tudo com `\n` e responde uma vez.

**Não mexa:** o reinício da janela (`clearTimeout` + novo `setTimeout`) é o que faz o mecanismo
funcionar. Sem ele, quem digita devagar é cortado no meio.

---

## 3. Resposta que nasce velha

**Sintoma:** o agente pergunta "você quer moto ou carro?" — e o cliente já tinha respondido
"moto" enquanto o modelo pensava.

**Causa:** a resposta estava **certa quando foi gerada** e ficou errada quando chegou. Entre a
chamada ao modelo e o envio passam alguns segundos, e o mundo muda nesse intervalo.

**Correção:** duas checagens **depois** de o modelo responder, antes de enviar:

```ts
// 1. Um humano assumiu enquanto pensávamos? Engole a resposta.
if (estaPausado(chatid)) { desfazerTurno(chatid, marcador); return; }

// 2. O cliente complementou? Devolve tudo ao buffer e responde uma vez só.
const novo = buffers.get(chatid);
if (novo) {
  desfazerTurno(chatid, marcador);
  novo.partes.unshift(texto);
  novo.ids.unshift(...ids);
  return;
}
```

`desfazerTurno()` apaga do histórico a fala do cliente, as tools e a resposta — tudo de uma vez,
via `historico.length = marcador`. Sem isso o modelo ficaria com um turno fantasma na memória.

---

## 4. `thoughtSignature` do Gemini 3.x

**Sintoma:** `400: "Function call is missing a thought_signature"` na segunda rodada de tools.

**Causa:** os modelos Gemini 3.x anexam uma assinatura opaca (base64) nas parts de `functionCall`
e **exigem esse mesmo campo de volta** na requisição seguinte. Remontar as parts a partir de
`resposta.functionCalls` descarta a assinatura.

**Correção:** devolver `resposta.candidates[0].content` **inteiro, como veio**, em vez de
reconstruir. Com fallback para modelos antigos que não trazem `candidates`.

---

## 5. `functionResponse` órfão derruba a conversa inteira

**Sintoma:** conversas longas começam a falhar. Curtas funcionam.

**Causa:** truncar o histórico com `slice(-24)` pode cortar no meio de uma rodada de tools,
deixando um `functionResponse` sem o `functionCall` que o originou. A API rejeita o par quebrado.

**Correção:** o corte **avança** até encontrar uma fala real do cliente. E "role user" não basta
como critério — resultado de tool também entra como `user`:

```ts
const falaDoCliente = (c) => c?.role === "user" && !c.parts?.some((p) => p.functionResponse);
```

---

## 6. O `presence` do WhatsApp quer `number`, não `chatId`

**Sintoma:** `400 "Invalid number"` no "digitando...".

**Causa:** o SDK público da UAZAPI documenta `chatId` em `/message/presence`. Está errado.
Verificado contra a API real: o campo é `number`.

**Bônus:** se a instância estiver com presença `unavailable`, o "digitando" simplesmente não
aparece para o cliente — o WhatsApp não mostra composing de contato que consta offline. Daí o
`ficarOnline()` no boot.

---

## 7. Container em UTC erra o dia da semana

**Sintoma:** o agente propõe visita em dia que já passou, ou oferece "sábado" numa terça.

**Causa:** o servidor da nuvem roda em UTC. `new Date()` sem timezone explícito dá outro dia.

**Correção:** `TIMEZONE` no `.env` + `Intl.DateTimeFormat` + **a lista dos próximos 7 dias
pré-calculada** dentro do prompt. Calcular data é exatamente o tipo de coisa que o código faz
certo e o modelo faz quase certo.

E o bloco tem que ser reconstruído **a cada turno**: montado uma vez no boot, um processo que
roda por dias acha que ainda é o dia do deploy.

---

## Bônus: o model id morre sem avisar

`gemini-2.0-flash` foi desligado em 01/06/2026. Um model id morto só aparece como 404 na
primeira mensagem de cliente real — o pior momento possível para descobrir.

Por isso existe `npm run check`: valida a key, confirma que o model id existe **nesta** key e
testa function calling de verdade, antes de você apontar o webhook.
