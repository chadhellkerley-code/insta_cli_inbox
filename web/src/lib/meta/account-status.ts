import { isFallbackInstagramUsername } from "@/lib/meta/instagram-username";

export const INSTAGRAM_ACCOUNT_STATUS_CONNECTED = "connected";

export { isFallbackInstagramUsername };

export function isInstagramUsernamePending(username?: string | null) {
  return isFallbackInstagramUsername(username);
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
