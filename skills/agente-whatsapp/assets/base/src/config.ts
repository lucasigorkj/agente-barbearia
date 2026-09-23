import "dotenv/config";

/**
 * Camada de troca de cliente.
 *
 * Tudo que muda de um cliente para outro mora aqui e vem do .env.
 * Para atender outro negocio do mesmo nicho: editar .env + src/data/catalogo.json.
 * Nada de codigo.
 */

function req(nome: string): string {
  const v = process.env[nome];
  if (!v || !v.trim()) {
    throw new Error(
      `Variavel de ambiente obrigatoria ausente: ${nome}. ` +
      `Copie .env.example para .env e preencha.`
    );
  }
  return v.trim();
}

function opt(nome: string, padrao: string): string {
  const v = process.env[nome];
  return v && v.trim() ? v.trim() : padrao;
}

function bool(nome: string, padrao: boolean): boolean {
  const v = process.env[nome]?.trim().toLowerCase();
  if (!v) return padrao;
  return v === "true" || v === "1" || v === "sim";
}

function num(nome: string, padrao: number): number {
  const v = process.env[nome];
  if (!v || !v.trim()) return padrao;
  const n = Number(v);
  return Number.isFinite(n) ? n : padrao;
}

export const config = {
  porta: num("PORT", 3000),

  // --- identidade do negocio (white-label) ---
  empresaNome: opt("EMPRESA_NOME", "Minha Empresa"),
  empresaCidade: opt("EMPRESA_CIDADE", ""),
  atendenteNome: opt("ATENDENTE_NOME", "Alex"),
  /**
   * Endereco e horario entram no prompt SO se preenchidos.
   *
   * Default vazio de proposito: um horario inventado manda o cliente na porta
   * fechada. Sem eles o agente ainda agenda, mas propoe periodo ("sabado de
   * manha") e deixa a confirmacao exata com o humano.
   */
  empresaEndereco: opt("EMPRESA_ENDERECO", ""),
  empresaHorario: opt("EMPRESA_HORARIO", ""),
  /** Fuso do negocio. Container de nuvem roda em UTC -- sem isso o agente erra o dia. */
  timezone: opt("TIMEZONE", "America/Sao_Paulo"),

  // --- Gemini ---
  geminiApiKey: req("GEMINI_API_KEY"),
  // O Google aposenta model id (gemini-2.0-flash foi desligado em 01/06/2026).
  // `npm run check` avisa antes de o cliente descobrir com um 404.
  geminiModel: opt("GEMINI_MODEL", "gemini-3.5-flash-lite"),
  /** Criatividade da redacao. Abaixo de 0.5 o agente fica respondendo igual. */
  temperatura: num("TEMPERATURA", 0.7),
  /** Teto fisico de verborragia. O prompt pede 2 frases; isto garante. */
  maxOutputTokens: num("MAX_OUTPUT_TOKENS", 400),
  /** Ultimo recurso quando o turno nao produz texto util. Nunca deixe o cliente no vacuo. */
  fraseFallback: opt("FRASE_FALLBACK", "Deixa eu confirmar isso aqui e ja te falo 👍"),

  // --- UAZAPI ---
  // Opcionais na leitura, obrigatorias no uso: `npm run repl` conversa com o
  // agente sem WhatsApp nenhum, e exigir credencial de envio ali seria atrito
  // a toa. Quem precisa de verdade chama assertUazapi() -- ver abaixo.
  uazapiUrl: opt("UAZAPI_URL", "").replace(/\/+$/, ""),
  uazapiToken: opt("UAZAPI_TOKEN", ""),
  /**
   * Nao e usado no envio -- a instancia ja esta implicita no par URL + token.
   * Serve como filtro opcional contra payload.instanceName, util quando um
   * webhook GLOBAL aponta varias instancias para o mesmo endpoint.
   * Vazio = aceita qualquer instancia.
   */
  uazapiInstance: opt("UAZAPI_INSTANCE", ""),
  /**
   * Segredo do webhook. Preenchido, so aceita POST /webhook?secret=<valor> --
   * cole a URL com o segredo no painel da UAZAPI. Sem isso, qualquer um que
   * descubra a URL forja mensagem e faz o agente responder para numero arbitrario.
   * Vazio = webhook aberto (serve para teste; o boot avisa).
   */
  webhookSecret: opt("WEBHOOK_SECRET", ""),

  // --- entrega do lead ---
  /**
   * WhatsApp de quem recebe o lead pronto (ex: 5513999998888).
   * Vazio = nao notifica ninguem.
   */
  humanoWhatsapp: opt("HUMANO_WHATSAPP", ""),
  /**
   * POST do lead em JSON. Aponta para n8n, Make, Zapier, Trello ou o CRM que o
   * negocio ja usa -- o encaixe e nao substituir a ferramenta dele. Vazio = desligado.
   */
  leadWebhookUrl: opt("LEAD_WEBHOOK_URL", ""),

  // --- handoff ---
  /** Silencia o agente depois de registrar o lead: o humano assumiu. */
  pausarAposLead: bool("PAUSAR_APOS_LEAD", true),
  /** Por quanto tempo, em minutos. */
  pausaAposLeadMin: num("PAUSA_APOS_LEAD_MIN", 120),
  /**
   * Quando um humano digita manualmente no WhatsApp do negocio, o agente cala por
   * este tempo. E o sinal mais confiavel de "humano assumiu".
   */
  pausaHumanoMin: num("PAUSA_HUMANO_MIN", 60),

  // --- comportamento de conversa ---
  /** Janela de agrupamento: junta mensagens picadas antes de responder uma vez. */
  debounceMs: num("DEBOUNCE_MS", 6000),

  // --- humanizacao do envio ---
  /** Marcar como lida + "digitando..." + espera antes de enviar. */
  humanizar: bool("HUMANIZAR", true),
  /** Piso do "digitando", mesmo em resposta curta. */
  digitandoBaseMs: num("DIGITANDO_BASE_MS", 800),
  /** Acrescimo por caractere da resposta. */
  digitandoPorCharMs: num("DIGITANDO_POR_CHAR_MS", 25),
  /** Teto: acima disso o cliente acha que travou. */
  digitandoMaxMs: num("DIGITANDO_MAX_MS", 5000),
  /** Descarta conversas ociosas para o Map nao crescer sem limite. */
  sessaoTtlMs: num("SESSAO_TTL_MS", 2 * 60 * 60 * 1000),
  /** Mensagens de historico mantidas por conversa (limita memoria e custo). */
  maxHistorico: num("MAX_HISTORICO", 24),
  /** Teto de rodadas de tool por turno, trava anti-loop. */
  maxToolIteracoes: num("MAX_TOOL_ITERACOES", 5),
};

/**
 * Exige as credenciais de envio. Chamado no boot do servidor (falha rapido) e
 * antes de cada envio. O REPL nao chama, por isso roda so com a key do Gemini.
 */
export function assertUazapi(): void {
  if (!config.uazapiUrl || !config.uazapiToken) {
    throw new Error(
      "UAZAPI_URL e UAZAPI_TOKEN sao obrigatorias para enviar no WhatsApp. " +
      "Preencha o .env (ou use `npm run repl` para testar sem WhatsApp)."
    );
  }
}
