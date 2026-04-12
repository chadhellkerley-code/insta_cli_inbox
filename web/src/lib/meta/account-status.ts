export const INSTAGRAM_ACCOUNT_STATUS_CONNECTED = "connected";

export function getInstagramAccountStatusLabel(status: string | null | undefined) {
  if (status === INSTAGRAM_ACCOUNT_STATUS_CONNECTED || !status) {
    return "Conectada";
  }

  return status;
}

export function getInstagramAccountStatusCopy(options: {
  lastWebhookAt?: string | null;
  formatRelativeTime: (value: string | null | undefined) => string;
}) {
  if (options.lastWebhookAt) {
    return `Webhook ${options.formatRelativeTime(options.lastWebhookAt)}`;
  }

  return "Esperando el primer evento del webhook.";
}
