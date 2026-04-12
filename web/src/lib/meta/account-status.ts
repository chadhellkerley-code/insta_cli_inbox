export const INSTAGRAM_ACCOUNT_STATUS_CONNECTED = "connected";

export function isInstagramProfileEnrichmentPending(options: {
  username?: string | null;
  name?: string | null;
  accountType?: string | null;
}) {
  return (
    Boolean(options.username?.startsWith("ig_")) ||
    !options.name ||
    !options.accountType
  );
}

export function getInstagramAccountStatusLabel(status: string | null | undefined) {
  if (status === INSTAGRAM_ACCOUNT_STATUS_CONNECTED || !status) {
    return "Conectada correctamente";
  }

  return status;
}

export function getInstagramAccountStatusCopy(options: {
  lastWebhookAt?: string | null;
  hasPendingProfileEnrichment?: boolean;
  formatRelativeTime: (value: string | null | undefined) => string;
}) {
  if (options.hasPendingProfileEnrichment) {
    const webhookCopy = options.lastWebhookAt
      ? ` Webhook ${options.formatRelativeTime(options.lastWebhookAt)}.`
      : "";

    return `Metadatos del perfil pendientes de enriquecimiento.${webhookCopy}`;
  }

  if (options.lastWebhookAt) {
    return `Webhook ${options.formatRelativeTime(options.lastWebhookAt)}`;
  }

  return "Esperando el primer evento del webhook.";
}
