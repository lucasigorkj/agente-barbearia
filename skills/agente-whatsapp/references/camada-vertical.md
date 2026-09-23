# A camada vertical: os três arquivos que você escreve

Todo o resto de `src/` é copiado de `assets/base/` sem tocar. Estes três são do negócio.
Use `exemplo-veiculos/` como gabarito — é código que roda com cliente real.

```
src/prompt.ts            → references/system-prompt.md
src/tools.ts             → este arquivo
src/data/catalogo.json   → este arquivo
```

---

## 1. `src/data/catalogo.json`

Um array. Campos livres, exceto dois que o resto do código espera:

| Campo | Obrigatório | Para quê |
|---|---|---|
| `disponivel: boolean` | sim | filtrado na carga — só o que está ativo chega ao modelo |
| `destaque: boolean` | sim | ordena as sugestões e a listagem |
| `preco: number` | quando houver preço | **número cru**, sem "R$" e sem ponto. `moeda()` formata |

Todo o resto é do nicho. Barbearia: `servico`, `duracaoMin`, `profissional`. Clínica: `exame`,
`preparo`, `convenio`. Imobiliária: `bairro`, `quartos`, `aluguel`.

```json
[
  { "servico": "Corte degradê", "categoria": "cabelo", "duracaoMin": 45,
    "preco": 60, "disponivel": true, "destaque": true }
]
```

**Preço sempre número cru.** Guardar `"R$ 60,00"` no JSON tira a formatação do código e devolve
para o modelo — que é exatamente o erro que a arquitetura existe para evitar.

**O catálogo congela na carga do módulo.** Editar o JSON exige redeploy. Para uma demo isso é
correto (menos peça para quebrar ao vivo); em produção é o que vira banco.

---

## 2. `src/tools.ts`

Exporta quatro coisas. As três primeiras são obrigatórias — o base importa cada uma delas:

```ts
export const declaracoes: FunctionDeclaration[]        // agent.ts e check.ts
export const handlers: Record<string, Handler>         // tool-runner.ts
export function exemploDeBusca(): string               // check.ts
export function categoriasDisponiveis(): string[]      // prompt.ts (opcional)
```

### Quantas tools?

**Três, quase sempre.** Uma busca, uma listagem, um registro.

| Resposta sobre "de onde vem o preço" | As tools |
|---|---|
| Lista curta com preço fixo (até ~20) | `buscarX`, `listarX`, `registrarLead` |
| Catálogo grande com variações | as mesmas três, com mais peso no ranqueamento |
| Não tem preço fixo, depende de avaliação | **só** `listarX` e `registrarLead` — e o prompt proíbe falar valor |

Não crie uma tool por pergunta que o cliente pode fazer. Tool é acesso a dado, não intenção.

### A busca

Use `ranquear()` de `catalogo.ts`. Você só declara quais campos entram e quanto pesam, **em
ordem de especificidade** — para cada token do cliente, o primeiro campo que casar leva a
pontuação:

```ts
function camposDe(s: Servico): Campo[] {
  return [
    { valor: s.servico,    peso: 6, pesoExato: 10, colado: true },
    { valor: s.categoria,  peso: 5 },
    { valor: s.profissional, peso: 3 },
  ];
}

const LIMIAR = 5;  // igual ao menor peso que deve passar sozinho
```

`LIMIAR` e os pesos são **dois números que mudam juntos**. Mexeu num, confira o outro.

Três retornos possíveis, e os três importam:

```ts
{ encontrado: false, instrucao, sugestoes }            // não tem
{ encontrado: true, ambiguo: true, instrucao, opcoes } // empate → pergunte qual
{ encontrado: true, ...ficha }                         // achou
```

**O empate não é problema, é informação.** Quando dois itens batem igual, a resposta certa é
perguntar qual deles — não escolher por conta e errar.

### O campo `instrucao`

Toda tool devolve, junto com os dados, uma frase em linguagem natural dizendo o que fazer com
eles. É guardrail no momento da decisão, não no meio de cem linhas de prompt:

```ts
instrucao: "Nao ha esse item. Diga que nao tem no momento e ofereca as sugestoes. Nao invente preco."
instrucao: "Ha 8 itens. Cite no maximo 2 e faca uma pergunta que estreite. Nao liste todos."
instrucao: "Esse lead JA estava registrado e foi atualizado. NAO registre de novo."
```

### A listagem

Corte em 3 itens e devolva o `total` separado. É o que deixa o agente dizer "tenho 8" sem
recitar os 8. E devolva **só nome e preço** — detalhe fica para quando o cliente escolher um.

### O registro do lead

A ordem dos efeitos colaterais importa:

```ts
function registrarLead(args, chatid) {
  const anterior = leadAnterior<Lead>(chatid);   // 1. já registrou nesta conversa?
  const lead: Lead = { /* preferir(novo, anterior, vazio) em cada campo */ };
  guardarLead(chatid, lead);                     // 2. dedupe
  console.log(...);                              // 3. o "CRM" da demo
  notificarLead(lead, formatarParaHumano(lead, telefone), chatid);  // 4. fire-and-forget
  if (config.pausarAposLead) pausar(...);        // 5. sai da frente
  return { ok: true, instrucao };                // 6. instrução de volta
}
```

**`preferir()` em todo campo.** O modelo às vezes chama de novo com menos campos do que da
primeira vez; sem isso, a segunda chamada apaga o que a primeira já tinha.

**`Lead` como `type`, não `interface`.** Um type alias de objeto é atribuível a
`Record<string, unknown>`, o que deixa o lead entrar direto no store genérico e no webhook sem
cast nenhum. Interface não é.

**Campo sem resposta vira texto, não string vazia:** `"nao informado"`, `"nao agendada"`,
`"-"`. Quem recebe o lead precisa enxergar o que faltou.

### `exemploDeBusca()`

Devolve uma pergunta tirada do **próprio catálogo**, para o `npm run check` testar function
calling:

```ts
export function exemploDeBusca(): string {
  const item = DISPONIVEIS[0];
  return item ? `Quanto custa ${item.servico}?` : "Quanto custa?";
}
```

Pergunta fixa vira mentira assim que o catálogo muda — e aí o check imprime "não encontrado"
toda vez que roda, treinando você a ignorar a saída dele.

---

## 3. `src/prompt.ts`

Exporta `buildSystemPrompt(): string`. Ver `references/system-prompt.md` para o esqueleto e os
três tons.

Importa `blocoDeDatas()` e `blocoDoLocal()` de `datas.ts` — os dois são genéricos e já estão
prontos. Não reescreva nenhum dos dois.

---

## Checklist antes de rodar

- [ ] `preco` é número cru no JSON, e só `moeda()` formata
- [ ] `declaracoes`, `handlers` e `exemploDeBusca` exportados
- [ ] `LIMIAR` coerente com os pesos
- [ ] toda tool devolve `instrucao`
- [ ] listagem cortada em 3, com `total` à parte
- [ ] `preferir()` em cada campo do lead
- [ ] `Lead` declarado como `type`
- [ ] os few-shots do prompt estão no mesmo tom da seção "Como você escreve"
- [ ] `.env` preenchido com nome, cidade e atendente
