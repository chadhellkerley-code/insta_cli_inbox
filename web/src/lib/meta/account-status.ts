export const INSTAGRAM_ACCOUNT_STATUS_CONNECTED = "connected";
export const INSTAGRAM_ACCOUNT_STATUS_WEBHOOK_PENDING = "webhook_pending";

export function resolveInstagramAccountStatus(options: {
  currentStatus?: string | null;
  webhookSubscriptionActive: boolean;
}) {
  if (options.webhookSubscriptionActive) {
    return INSTAGRAM_ACCOUNT_STATUS_CONNECTED;
  }

  if (options.currentStatus === INSTAGRAM_ACCOUNT_STATUS_CONNECTED) {
    return INSTAGRAM_ACCOUNT_STATUS_CONNECTED;
  }

  return INSTAGRAM_ACCOUNT_STATUS_WEBHOOK_PENDING;
}

export function getInstagramAccountStatusLabel(status: string | null | undefined) {
  if (status === INSTAGRAM_ACCOUNT_STATUS_WEBHOOK_PENDING) {
    return "Webhook pendiente";
  }

  return "Conectada";
}

export function getInstagramAccountStatusCopy(options: {
  status: string | null | undefined;
  lastWebhookAt?: string | null;
  formatRelativeTime: (value: string | null | undefined) => string;
}) {
  if (options.status === INSTAGRAM_ACCOUNT_STATUS_WEBHOOK_PENDING) {
    return "Webhook pendiente de activacion. Revisa Webhooks en Meta y vuelve a abrir esta pantalla para reintentar.";
  }

  if (options.lastWebhookAt) {
    return `Webhook ${options.formatRelativeTime(options.lastWebhookAt)}`;
  }

  return "Webhook activo, esperando el primer evento.";
}
