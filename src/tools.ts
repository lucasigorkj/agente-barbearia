import type { FunctionDeclaration } from "@google/genai";
import { config } from "./config";
import { notificarLead } from "./notificar";
import { pausar } from "./pausa";
import {
  duracao,
  guardarLead,
  leadAnterior,
  moeda,
  preferir,
  ranquear,
  type Campo,
} from "./catalogo";
import type { Handler } from "./tool-runner";
import catalogoRaw from "./data/catalogo.json";

/**
 * A CAMADA DO NEGOCIO.
 *
 * Este arquivo, o prompt.ts e o data/catalogo.json sao os unicos tres que mudam
 * de um nicho para outro. Todo o resto do src/ atravessa sem tocar.
 */

export interface Servico {
  servico: string;
  categoria: string;
  /** Palavras que o cliente usa e nao estao no nome: "degrade", "plano", "kids"... */
  busca?: string;
  /** Opcional: sem duracao conhecida, o agente nao fala em tempo. */
  duracaoMin?: number;
  /** null = a casa nao divulga; o barbeiro passa o valor. Nunca inventar. */
  preco: number | null;
  /** Sufixo do preco. Ex: "/mês" nos planos do clube. */
  unidade?: string;
  /** O que o agente precisa saber alem do preco (o que inclui, link, restricao). */
  observacao?: string;
  profissionais: string[];
  disponivel: boolean;
  destaque: boolean;
}

const TODOS = catalogoRaw as Servico[];

/** So o que esta ativo chega ao modelo. */
const SERVICOS = TODOS.filter((s) => s.disponivel);

/** Que categorias existem no catalogo agora (cabelo, barba, combo...). */
export function categoriasDisponiveis(): string[] {
  return [...new Set(SERVICOS.map((s) => s.categoria))];
}

/** Os barbeiros que aparecem em algum servico ativo. */
export function barbeirosDisponiveis(): string[] {
  return [...new Set(SERVICOS.flatMap((s) => s.profissionais))];
}

/**
 * A pergunta que o `npm run check` usa para testar function calling.
 *
 * Sai do proprio catalogo: pergunta fixa vira mentira assim que o catalogo muda.
 */
export function exemploDeBusca(): string {
  const s = SERVICOS[0];
  return s ? `Quanto custa o ${s.servico.toLowerCase()}?` : "Quanto custa?";
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

/**
 * Os campos que participam da busca, em ordem de especificidade.
 *
 * Quem diz "corte degrade" quer o degrade: o nome do servico pesa mais que a
 * categoria. Categoria sozinha ainda passa ("faz barba?"), e com varios servicos
 * na mesma categoria o empate vira pergunta.
 */
function camposDe(s: Servico): Campo[] {
  return [
    { valor: s.servico, peso: 6, pesoExato: 10, colado: true },
    { valor: s.categoria, peso: 5 },
    // Mesmo peso da categoria: sinonimo sozinho passa, mas nao ganha do nome.
    { valor: s.busca ?? "", peso: 5 },
    // pesoExato travado em 3: barbeiro com um servico so casaria "exato" (3+4)
    // e passaria do limiar sozinho, devolvendo um servico que ninguem pediu.
    { valor: s.profissionais.join(" "), peso: 3, pesoExato: 3 },
  ];
}

// Igual ao peso de "categoria contem": categoria sozinha passa raspando, de
// proposito. Barbeiro sozinho (peso 3) nao passa. Mexeu nos pesos, confira aqui.
const LIMIAR = 5;

/** Ficha completa -- so depois que o cliente escolheu um. */
function ficha(s: Servico) {
  return {
    servico: s.servico,
    preco: precoTexto(s),
    ...(s.duracaoMin ? { duracao: duracao(s.duracaoMin) } : {}),
    ...(s.profissionais.length ? { barbeiros: s.profissionais.join(", ") } : {}),
    ...(s.observacao ? { observacao: s.observacao } : {}),
  };
}

/** Nome + preco, sem detalhe. */
function resumo(s: Servico) {
  return {
    servico: s.servico,
    preco: precoTexto(s),
    // Plano vem com a observacao (link de assinatura) ja na lista. Sem isso, nos
    // testes o modelo inventou um link quando o cliente escolheu "o de 120".
    ...(s.categoria === "assinatura" && s.observacao ? { observacao: s.observacao } : {}),
  };
}

/** Preco ja escrito para o modelo -- inclusive quando a casa nao divulga. */
function precoTexto(s: Servico): string {
  if (s.preco === null) return "valor nao divulgado: diga que o barbeiro passa o valor";
  return moeda(s.preco) + (s.unidade ?? "");
}

function porDestaque(a: Servico, b: Servico): number {
  return (
    Number(b.destaque) - Number(a.destaque) ||
    (a.preco ?? Infinity) - (b.preco ?? Infinity)
  );
}

function sugestoes(): string[] {
  return SERVICOS.slice().sort(porDestaque).slice(0, 3).map((s) => s.servico);
}

function buscarServico(args: Record<string, unknown>) {
  const termo = typeof args.termo === "string" ? args.termo : "";
  if (!termo.trim()) {
    return {
      encontrado: false,
      instrucao: "Termo vazio. Pergunte qual servico o cliente quer.",
      sugestoes: sugestoes(),
    };
  }

  const { melhor, empatados } = ranquear(SERVICOS, termo, camposDe, LIMIAR);

  if (!melhor) {
    return {
      encontrado: false,
      instrucao:
        "A barbearia nao faz esse servico. Diga que nao tem e ofereca as sugestoes. Nao invente servico nem preco.",
      sugestoes: sugestoes(),
    };
  }

  // Empate tecnico ("barba" casa com Barba e Pigmentacao) -> pergunta qual.
  if (empatados.length > 1) {
    return {
      encontrado: true,
      ambiguo: true,
      instrucao:
        "Mais de um servico bate. Cite no maximo 2 com o preco e pergunte qual o cliente quer.",
      opcoes: empatados.slice(0, 3).map(resumo),
      total: empatados.length,
    };
  }

  return {
    encontrado: true,
    ...ficha(melhor),
    instrucao:
      "Passe o preco exatamente como veio. Use a observacao se houver (ex: mande o link do clube se ele quiser assinar). Se o cliente ainda nao disse o dia, pergunte que dia fica bom pra ele.",
  };
}

function listarServicos(args: Record<string, unknown>) {
  const categoria =
    typeof args.categoria === "string" && args.categoria.trim()
      ? args.categoria.trim().toLowerCase()
      : undefined;

  // Sem filtro, "o que vcs fazem?" e pergunta de servico: produto fica de fora.
  const filtrados = SERVICOS.filter((s) =>
    categoria ? s.categoria === categoria : s.categoria !== "produto"
  ).sort(porDestaque);

  if (filtrados.length === 0) {
    return {
      total: 0,
      servicos: [],
      instrucao: "Nada nessa categoria. Diga isso e ofereca o corte.",
      categorias: categoriasDisponiveis(),
    };
  }

  // Devolve poucos de proposito: o agente cita no maximo 2, e `total` deixa ele
  // dizer "fazemos 8 servicos" sem recitar os 8.
  const amostra = filtrados.slice(0, 3);

  return {
    total: filtrados.length,
    mostrando: amostra.length,
    servicos: amostra.map(resumo),
    instrucao:
      filtrados.length > 2
        ? `Ha ${filtrados.length} itens. Cite no maximo 2 e faca UMA pergunta que estreite o que ele quer. Nao liste todos.`
        : "Pode citar os dois.",
  };
}

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------

/**
 * `type` e nao `interface` de proposito: um type alias de objeto e atribuivel a
 * Record<string, unknown>, o que deixa este Lead entrar direto no store generico
 * e no webhook, sem cast nenhum. Interface nao e.
 */
export type Lead = {
  nome: string;
  servico: string;
  /** Dia + data + horario/periodo que o cliente aceitou. */
  diaHorario: string;
  barbeiro: string;
  jaCliente: string;
};

/** O texto que chega no WhatsApp de quem vai atender. */
function formatarParaHumano(lead: Lead, telefoneCliente: string): string {
  const linhas = [
    "*Pedido de horário*",
    "",
    `Cliente: ${lead.nome}`,
    `WhatsApp: ${telefoneCliente}`,
    `Serviço: ${lead.servico}`,
    `Quando: ${lead.diaHorario}`,
    `Barbeiro: ${lead.barbeiro}`,
    `Já é cliente: ${lead.jaCliente}`,
    "",
    "Confirme o horário na agenda e assuma a conversa.",
  ];
  return linhas.join("\n");
}

/**
 * O nome oficial da tabela: "degrade" vira "Corte masculino (moderno ou clássico)".
 *
 * Plano so entra quando o cliente falou de plano: sem isso, "corte e barba" avulso
 * casava com "Clube Corte e Barba Ilimitado" e o barbeiro recebia um pedido de
 * assinatura que ninguem fez.
 */
function nomeOficial(falado: string): string {
  // Dois servicos juntos ("corte e barba") nao tem nome oficial: um so perderia o outro.
  if (/\s(e|mais)\s|\+/i.test(falado) && !/clube|plano/i.test(falado)) return falado;
  const falouDePlano = /clube|plano|assinatura|mensal/i.test(falado);
  const base = falouDePlano ? SERVICOS : SERVICOS.filter((s) => s.categoria !== "assinatura");
  const { melhor, empatados } = ranquear(base, falado, camposDe, LIMIAR);
  return melhor && empatados.length === 1 ? melhor.servico : falado;
}

/**
 * Conversas em que o registro ja foi barrado uma vez por falta de dado.
 *
 * O prompt manda perguntar barbeiro e "ja e cliente" antes de registrar, mas nos
 * testes o modelo registrou assim que ouviu o dia -- e as respostas que vieram
 * depois cairam no vazio (o agente ja estava pausado). A primeira tentativa
 * incompleta volta com o que falta; a segunda passa de qualquer jeito, para nao
 * prender o cliente que nao quer responder.
 */
const jaCobrado = new Set<string>();

function faltando(args: Record<string, unknown>): string[] {
  const vazio = (v: unknown) => !String(v ?? "").trim();
  const falta: string[] = [];
  if (vazio(args.diaHorario)) falta.push("dia e horario");
  if (vazio(args.barbeiro)) falta.push("barbeiro de preferencia");
  if (vazio(args.jaCliente)) falta.push("se ja e cliente");
  return falta;
}

function registrarLead(args: Record<string, unknown>, chatid: string) {
  const anterior = leadAnterior<Lead>(chatid);

  if (!anterior && !jaCobrado.has(chatid)) {
    const falta = faltando(args);
    if (falta.length > 0) {
      jaCobrado.add(chatid);
      return {
        ok: false,
        instrucao:
          `NAO registrado ainda. Falta: ${falta.join(", ")}. Pergunte o primeiro que falta ` +
          "(uma pergunta so) e chame registrarLead de novo depois que ele responder. " +
          "Se o cliente ja respondeu isso nesta conversa, chame de novo agora passando o que ele disse.",
      };
    }
  }

  const lead: Lead = {
    nome: preferir(String(args.nome ?? ""), anterior?.nome, "nao informado"),
    servico: preferir(nomeOficial(String(args.servico ?? "")), anterior?.servico, "nao informado"),
    diaHorario: preferir(String(args.diaHorario ?? ""), anterior?.diaHorario, "nao agendado"),
    barbeiro: preferir(String(args.barbeiro ?? ""), anterior?.barbeiro, "sem preferencia"),
    jaCliente: preferir(String(args.jaCliente ?? ""), anterior?.jaCliente, "nao informado"),
  };

  guardarLead(chatid, lead);

  // Este console.log e o "CRM" da demo -- aparece nos logs do servidor.
  const titulo = anterior ? "LEAD ATUALIZADO" : "LEAD QUALIFICADO";
  console.log(
    `\n===== ${titulo} =====\n` +
      JSON.stringify({ ...lead, registradoEm: new Date().toISOString() }, null, 2) +
      "\n============================\n"
  );

  const telefone = chatid.split("@")[0] ?? chatid;
  notificarLead(lead, formatarParaHumano(lead, telefone), chatid);

  // Barbeiro assumiu -- o agente sai da frente.
  if (config.pausarAposLead) {
    pausar(chatid, config.pausaAposLeadMin * 60_000, "lead registrado, humano assumiu");
  }

  if (anterior) {
    return {
      ok: true,
      jaRegistrado: true,
      instrucao:
        "Esse lead JA estava registrado e foi atualizado. NAO registre de novo. " +
        "So responda o cliente normalmente.",
    };
  }

  return {
    ok: true,
    instrucao:
      "Pedido registrado. Avise que o barbeiro confirma o horario com ele em instantes. Nao pergunte mais nada.",
  };
}

// ---------------------------------------------------------------------------
// Declaracoes para o Gemini
// ---------------------------------------------------------------------------

export const declaracoes: FunctionDeclaration[] = [
  {
    name: "buscarServico",
    description:
      "Busca um servico, plano do clube ou produto da barbearia pelo nome ou tipo (corte, degrade, barba, plano, pomada...). Use sempre que o cliente citar um servico ou perguntar preco. Unica fonte de preco valida.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        termo: {
          type: "string",
          description: "O que o cliente falou. Ex: 'degrade', 'barba', 'afro', 'plano mensal', 'pomada'.",
        },
      },
      required: ["termo"],
    },
  },
  {
    name: "listarServicos",
    description:
      "Mostra servicos com o total disponivel. Use quando o cliente nao souber o que quer ou pedir a tabela. Retorna poucos itens de proposito: cite no maximo 2 na sua mensagem.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        categoria: {
          type: "string",
          enum: categoriasDisponiveis(),
          description: "Filtro opcional. Omita para trazer todos.",
        },
      },
    },
  },
  {
    name: "registrarLead",
    description:
      "Registra o pedido de horario e passa para o barbeiro confirmar. Chame quando tiver o servico e ja tiver perguntado dia/horario e barbeiro de preferencia e ouvido a resposta.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome do cliente." },
        servico: { type: "string", description: "Servico que ele quer fazer." },
        diaHorario: {
          type: "string",
          description:
            "Dia da semana + DATA + horario ou periodo que o CLIENTE aceitou. " +
            "SEMPRE com a data concreta, no formato 'sabado DD/MM, 10h' ou 'sexta-feira DD/MM, fim da tarde', com a data real. " +
            "Converta 'amanha'/'sabado' usando a lista de proximos dias do seu contexto. " +
            "Omita se ele nao quis marcar ou nao respondeu. NUNCA preencha com o horario que voce " +
            "sugeriu sem ele ter aceitado.",
        },
        barbeiro: {
          type: "string",
          description:
            "Barbeiro que o cliente prefere. Se ele disse que tanto faz, passe 'tanto faz'. Omita so se ainda nao perguntou.",
        },
        jaCliente: {
          type: "string",
          description: "'sim' se ja cortou aqui antes, 'nao' se e a primeira vez. Omita se nao souber.",
        },
      },
      required: ["nome", "servico"],
    },
  },
];

export const handlers: Record<string, Handler> = {
  buscarServico,
  listarServicos,
  registrarLead,
};
