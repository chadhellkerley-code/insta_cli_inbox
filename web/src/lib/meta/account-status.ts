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
    return "Connected · review required";
  }

  if (
    account.webhook_status === INSTAGRAM_WEBHOOK_STATUS_PENDING ||
    account.status === INSTAGRAM_ACCOUNT_STATUS_OAUTH_CONNECTED
  ) {
    return "Connected · waiting for proof";
  }

  if (
    account.webhook_status === INSTAGRAM_WEBHOOK_STATUS_READY ||
    account.status === INSTAGRAM_ACCOUNT_STATUS_WEBHOOK_READY
  ) {
    return "Connected · webhook proven";
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
      return `Se registro un error de configuracion ${options.formatRelativeTime(options.account.last_webhook_check_at)}. La cuenta sigue conectada, pero sin prueba operativa.`;
    }

    return "La cuenta esta conectada, pero sigue sin prueba operativa para inbox.";
  }

  if (
    options.account.webhook_status === INSTAGRAM_WEBHOOK_STATUS_PENDING ||
    options.account.status === INSTAGRAM_ACCOUNT_STATUS_OAUTH_CONNECTED
  ) {
    return "OAuth completo. Esperando el primer webhook real o una operacion real de mensajeria.";
  }

  if (
    options.account.webhook_status === INSTAGRAM_WEBHOOK_STATUS_READY ||
    options.account.status === INSTAGRAM_ACCOUNT_STATUS_WEBHOOK_READY
  ) {
    if (options.lastWebhookAt) {
      return `Primer webhook real recibido ${options.formatRelativeTime(options.lastWebhookAt)}.`;
    }

    return "Recibimos evidencia de webhook. Falta confirmar mensajeria real.";
  }

  if (options.lastWebhookAt) {
    return `Webhook ${options.formatRelativeTime(options.lastWebhookAt)}`;
  }

  return "Esperando el primer webhook real.";
}
