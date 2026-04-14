import { isFallbackInstagramUsername } from "@/lib/meta/instagram-username";

export const INSTAGRAM_ACCOUNT_STATUS_OAUTH_CONNECTED = "oauth_connected";
export const INSTAGRAM_ACCOUNT_STATUS_WEBHOOK_READY = "webhook_ready";
export const INSTAGRAM_ACCOUNT_STATUS_MESSAGING_READY = "messaging_ready";

export const INSTAGRAM_WEBHOOK_STATUS_PENDING = "pending";
export const INSTAGRAM_WEBHOOK_STATUS_READY = "ready";
export const INSTAGRAM_WEBHOOK_STATUS_FAILED = "failed";

export const INSTAGRAM_MESSAGING_STATUS_PENDING = "pending";
export const INSTAGRAM_MESSAGING_STATUS_READY = "ready";
export const INSTAGRAM_MESSAGING_STATUS_FAILED = "failed";

export { isFallbackInstagramUsername };

export function isInstagramUsernamePending(username?: string | null) {
  return isFallbackInstagramUsername(username);
}

type AccountReadinessStatus = {
  status?: string | null;
  webhook_status?: string | null;
  messaging_status?: string | null;
  last_webhook_at?: string | null;
  webhook_subscription_error?: string | null;
  last_webhook_check_at?: string | null;
};

export function getInstagramAccountStatusLabel(account: AccountReadinessStatus) {
  if (
    account.messaging_status === INSTAGRAM_MESSAGING_STATUS_READY ||
    account.status === INSTAGRAM_ACCOUNT_STATUS_MESSAGING_READY ||
    (!account.messaging_status && !account.webhook_status && Boolean(account.last_webhook_at))
  ) {
    return "Ready for inbox";
  }

  if (account.webhook_status === INSTAGRAM_WEBHOOK_STATUS_FAILED) {
    return "Connected · webhook failed";
  }

  if (
    account.webhook_status === INSTAGRAM_WEBHOOK_STATUS_PENDING ||
    account.status === INSTAGRAM_ACCOUNT_STATUS_OAUTH_CONNECTED
  ) {
    return "Connected · webhook pending";
  }

  if (
    account.webhook_status === INSTAGRAM_WEBHOOK_STATUS_READY ||
    account.status === INSTAGRAM_ACCOUNT_STATUS_WEBHOOK_READY
  ) {
    return "Connected";
  }

  if (!account.status || account.status === "connected") {
    return "Connected";
  }

  return account.status;
}

export function getInstagramAccountStatusCopy(options: {
  account: AccountReadinessStatus;
  lastWebhookAt?: string | null;
  formatRelativeTime: (value: string | null | undefined) => string;
}) {
  if (
    options.account.messaging_status === INSTAGRAM_MESSAGING_STATUS_READY ||
    options.account.status === INSTAGRAM_ACCOUNT_STATUS_MESSAGING_READY ||
    (!options.account.messaging_status &&
      !options.account.webhook_status &&
      Boolean(options.lastWebhookAt))
  ) {
    if (options.lastWebhookAt) {
      return `Ultimo webhook ${options.formatRelativeTime(options.lastWebhookAt)}.`;
    }

    return "Webhook activado y mensajeria habilitada para el inbox.";
  }

  if (options.account.webhook_status === INSTAGRAM_WEBHOOK_STATUS_FAILED) {
    if (options.account.webhook_subscription_error) {
      return options.account.webhook_subscription_error;
    }

    if (options.account.last_webhook_check_at) {
      return `La activacion del webhook fallo ${options.formatRelativeTime(options.account.last_webhook_check_at)}.`;
    }

    return "La activacion del webhook fallo. La cuenta no esta lista para inbox.";
  }

  if (
    options.account.webhook_status === INSTAGRAM_WEBHOOK_STATUS_PENDING ||
    options.account.status === INSTAGRAM_ACCOUNT_STATUS_OAUTH_CONNECTED
  ) {
    if (options.account.last_webhook_check_at) {
      return `Estamos terminando de activar el webhook. Ultimo chequeo ${options.formatRelativeTime(options.account.last_webhook_check_at)}.`;
    }

    return "Estamos terminando de activar el webhook para dejar la cuenta lista.";
  }

  if (
    options.account.webhook_status === INSTAGRAM_WEBHOOK_STATUS_READY ||
    options.account.status === INSTAGRAM_ACCOUNT_STATUS_WEBHOOK_READY
  ) {
    if (options.lastWebhookAt) {
      return `Webhook activo ${options.formatRelativeTime(options.lastWebhookAt)}.`;
    }

    return "Webhook activado. Falta confirmar mensajeria con trafico real.";
  }

  if (options.lastWebhookAt) {
    return `Webhook ${options.formatRelativeTime(options.lastWebhookAt)}`;
  }

  return "Esperando el primer evento del webhook.";
}
