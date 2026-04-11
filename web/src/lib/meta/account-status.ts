export const INSTAGRAM_ACCOUNT_STATUS_CONNECTED = "connected";

export function getInstagramAccountStatusLabel(status: string | null | undefined) {
  if (status === INSTAGRAM_ACCOUNT_STATUS_CONNECTED || !status) {
    return "Conectada";
  }

  return status;
}

export function getInstagramAccountStatusCopy(options: {
  lastWebhookAt?: string | null;
  webhookSubscribedAt?: string | null;
  formatRelativeTime: (value: string | null | undefined) => string;
}) {
  if (options.lastWebhookAt) {
    return `Webhook ${options.formatRelativeTime(options.lastWebhookAt)}`;
  }

  if (options.webhookSubscribedAt) {
    return `Webhook activado ${options.formatRelativeTime(options.webhookSubscribedAt)}.`;
  }

  return "Webhook activo, esperando el primer evento.";
}
