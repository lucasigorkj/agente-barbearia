import { config } from "./config";

/**
 * O bloco de data do system prompt.
 *
 * Generico de proposito: nao tem nada do negocio aqui, e todo agente que marca
 * qualquer coisa precisa disso igual.
 *
 * CICATRIZ: o container da nuvem roda em UTC. Sem o timezone explicito o agente
 * propoe "sabado" numa terca e marca visita em dia que ja passou. E sem a lista
 * dos proximos dias pre-calculada, o modelo erra a conta de "sexta que vem" --
 * calcular data e exatamente o tipo de coisa que o codigo faz certo e o modelo
 * faz quase certo.
 *
 * Tem que ser chamado a CADA turno, nao uma vez no boot: um processo que roda
 * dias acha que ainda e o dia do deploy.
 */
export function blocoDeDatas(): string {
  const agora = new Date();
  const fmt = (opcoes: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("pt-BR", { timeZone: config.timezone, ...opcoes }).format(agora);

  const hoje = fmt({ weekday: "long", day: "2-digit", month: "2-digit", year: "numeric" });
  const hora = fmt({ hour: "2-digit", minute: "2-digit" });

  // Os proximos 7 dias com nome e data, para o agente propor dia real e
  // converter "sexta" / "amanha" em data concreta sem precisar calcular.
  const proximosDias = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(agora.getTime() + (i + 1) * 86400000);
    const nome = new Intl.DateTimeFormat("pt-BR", {
      timeZone: config.timezone,
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
    }).format(d);
    return i === 0 ? `amanha = ${nome}` : nome;
  }).join("\n");

  return `## Quando e agora
Hoje e ${hoje}, ${hora}.

Proximos dias:
${proximosDias}

Use isso sempre que falar de data:
- Nunca proponha um dia que ja passou nem "sabado" quando hoje e sabado a noite.
- Ao propor horario, ofereca dias reais e proximos. Se hoje e terca, proponha
  "amanha" ou "quinta", nao "sabado" solto.
- Se ja passou das 18h, nao proponha hoje. Comece de amanha.
- Quando o cliente disser "amanha", "sexta", "depois de amanha", converta para a data
  concreta ao registrar. Quem vai atender precisa saber o dia, nao a palavra.`;
}

/**
 * O bloco de endereco/horario -- condicional de proposito.
 *
 * Campo ausente NAO vira string vazia: vira proibicao explicita. Deixar a lacuna
 * em branco faz o modelo preencher sozinho, e horario inventado manda o cliente
 * na porta fechada.
 */
export function blocoDoLocal(): string {
  const dados = [
    config.empresaEndereco ? `Endereco: ${config.empresaEndereco}` : "",
    config.empresaHorario ? `Horario de funcionamento: ${config.empresaHorario}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return dados
    ? `## Dados do local\n${dados}\nPode informar isso quando perguntarem ou ao combinar o horario.`
    : `## Dados do local\nVoce NAO tem endereco nem horario confirmados. Nunca invente.\nSe perguntarem, diga que a equipe manda a localizacao junto com a confirmacao.`;
}
