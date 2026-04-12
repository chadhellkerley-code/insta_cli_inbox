export const INSTAGRAM_ACCOUNT_STATUS_CONNECTED = "connected";

export function isFallbackInstagramUsername(username?: string | null) {
  return Boolean(username?.startsWith("ig_"));
}

export function isInstagramProfileEnrichmentPending(options: {
  username?: string | null;
  name?: string | null;
  accountType?: string | null;
}) {
  return (
    isFallbackInstagramUsername(options.username) ||
    !options.name ||
    !options.accountType
  );
}

export function getInstagramAccountStatusLabel(status: string | null | undefined) {
  if (status === INSTAGRAM_ACCOUNT_STATUS_CONNECTED || !status) {
    return "Cuenta conectada";
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
