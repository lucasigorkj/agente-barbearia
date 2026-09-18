import { config } from "./config";
import { enviarTexto } from "./whatsapp";

/**
 * Entrega do lead pronto. Dois destinos, ambos opcionais e independentes.
 *
 * 1. WhatsApp de quem vai atender -- o lead mastigado chega no celular da
 *    pessoa, sem ninguem precisar abrir painel nenhum.
 * 2. Webhook generico -- POST do lead em JSON para n8n, Make, Zapier, Trello ou
 *    o CRM que o negocio ja usa. E o ponto de encaixe: o cliente NAO troca de
 *    ferramenta, so passa a receber o lead qualificado dentro da que ele ja tem.
 *
 * Tudo aqui e best-effort: falhar em notificar nao pode derrubar o atendimento,
 * porque o lead ja esta registrado no log de qualquer forma.
 *
 * Generico de proposito: quem monta o texto da mensagem e tools.ts, que conhece
 * os campos do lead deste nicho. Aqui so entrega.
 */

async function avisarHumano(mensagem: string): Promise<void> {
  if (!config.humanoWhatsapp) return;
  await enviarTexto(config.humanoWhatsapp, mensagem);
}

async function dispararWebhook(lead: Record<string, unknown>, chatid: string): Promise<void> {
  if (!config.leadWebhookUrl) return;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(config.leadWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...lead,
        telefone: chatid.split("@")[0],
        empresa: config.empresaNome,
        registradoEm: new Date().toISOString(),
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) console.warn(`[notificar] webhook ${res.status} (ignorado)`);
    else console.log("[notificar] webhook entregue");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Dispara as notificacoes sem bloquear a resposta ao cliente.
 *
 * O cliente nao pode esperar o Trello responder para receber "ja passei pra
 * equipe" -- por isso isto e fire-and-forget, com cada destino isolado do
 * outro: webhook fora do ar nao impede o WhatsApp de tocar.
 */
export function notificarLead(
  lead: Record<string, unknown>,
  mensagem: string,
  chatid: string
): void {
  void avisarHumano(mensagem).catch((e) =>
    console.warn("[notificar] whatsapp falhou (ignorado):", e instanceof Error ? e.message : e)
  );
  void dispararWebhook(lead, chatid).catch((e) =>
    console.warn("[notificar] webhook falhou (ignorado):", e instanceof Error ? e.message : e)
  );
}
