import {
  INSTAGRAM_ACCOUNT_STATUS_MESSAGING_READY,
  INSTAGRAM_ACCOUNT_STATUS_OAUTH_CONNECTED,
  INSTAGRAM_ACCOUNT_STATUS_WEBHOOK_READY,
  INSTAGRAM_MESSAGING_STATUS_FAILED,
  INSTAGRAM_MESSAGING_STATUS_PENDING,
  INSTAGRAM_MESSAGING_STATUS_READY,
  INSTAGRAM_WEBHOOK_STATUS_FAILED,
  INSTAGRAM_WEBHOOK_STATUS_PENDING,
  INSTAGRAM_WEBHOOK_STATUS_READY,
} from "@/lib/meta/account-status";
import { getMetaOauthConfig, META_OAUTH_FLOW } from "@/lib/meta/config";
import {
  activateInstagramAccountWebhooks,
  InstagramWebhookActivationError,
  type InstagramWebhookActivationResult,
} from "@/lib/meta/client";
import { ensureInstagramAccessToken } from "@/lib/meta/token-lifecycle";

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

type InstagramOauthActivationTarget = {
  instagram_account_id: string;
  page_id?: string | null;
  access_token: string;
  token_expires_at?: string | null;
  scopes?: string[] | null;
};

export type InstagramAccountReadinessResult = {
  status:
    | typeof INSTAGRAM_ACCOUNT_STATUS_OAUTH_CONNECTED
    | typeof INSTAGRAM_ACCOUNT_STATUS_WEBHOOK_READY
    | typeof INSTAGRAM_ACCOUNT_STATUS_MESSAGING_READY;
  pageId: string | null;
  webhookSubscribedAt: string | null;
  webhookStatus:
    | typeof INSTAGRAM_WEBHOOK_STATUS_PENDING
    | typeof INSTAGRAM_WEBHOOK_STATUS_READY
    | typeof INSTAGRAM_WEBHOOK_STATUS_FAILED;
  messagingStatus:
    | typeof INSTAGRAM_MESSAGING_STATUS_PENDING
    | typeof INSTAGRAM_MESSAGING_STATUS_READY
    | typeof INSTAGRAM_MESSAGING_STATUS_FAILED;
  lastWebhookCheckAt: string;
  webhookSubscriptionError: string | null;
};

function normalizeScope(value: string) {
  return value.trim().toLowerCase();
}

function hasMessagingScope(scopes: string[] | null | undefined) {
  return (scopes ?? []).map(normalizeScope).includes("instagram_business_manage_messages");
}

function truncateErrorMessage(message: string) {
  const trimmed = message.trim();

  if (trimmed.length <= 280) {
    return trimmed;
  }

  return `${trimmed.slice(0, 277)}...`;
}

function buildActivationFailureResult(options: {
  checkedAt: string;
  pageId?: string | null;
  error: unknown;
}): InstagramAccountReadinessResult {
  const rawMessage =
    options.error instanceof Error ? options.error.message : String(options.error);

  return {
    status: INSTAGRAM_ACCOUNT_STATUS_OAUTH_CONNECTED,
    pageId: options.pageId ?? null,
    webhookSubscribedAt: null,
    webhookStatus: INSTAGRAM_WEBHOOK_STATUS_FAILED,
    messagingStatus: INSTAGRAM_MESSAGING_STATUS_FAILED,
    lastWebhookCheckAt: options.checkedAt,
    webhookSubscriptionError: truncateErrorMessage(rawMessage),
  };
}

function buildSuccessReadinessResult(options: {
  checkedAt: string;
  activation: InstagramWebhookActivationResult;
  messagingScopeGranted: boolean;
}): InstagramAccountReadinessResult {
  if (options.messagingScopeGranted) {
    return {
      status: INSTAGRAM_ACCOUNT_STATUS_MESSAGING_READY,
      pageId: options.activation.pageId,
      webhookSubscribedAt: options.checkedAt,
      webhookStatus: INSTAGRAM_WEBHOOK_STATUS_READY,
      messagingStatus: INSTAGRAM_MESSAGING_STATUS_READY,
      lastWebhookCheckAt: options.checkedAt,
      webhookSubscriptionError: null,
    };
  }

  return {
    status: INSTAGRAM_ACCOUNT_STATUS_WEBHOOK_READY,
    pageId: options.activation.pageId,
    webhookSubscribedAt: options.checkedAt,
    webhookStatus: INSTAGRAM_WEBHOOK_STATUS_READY,
    messagingStatus: INSTAGRAM_MESSAGING_STATUS_PENDING,
    lastWebhookCheckAt: options.checkedAt,
    webhookSubscriptionError: null,
  };
}

function buildInstagramLoginReadinessResult(options: {
  checkedAt: string;
  pageId?: string | null;
}): InstagramAccountReadinessResult {
  return {
    status: INSTAGRAM_ACCOUNT_STATUS_OAUTH_CONNECTED,
    pageId: options.pageId ?? null,
    webhookSubscribedAt: null,
    webhookStatus: INSTAGRAM_WEBHOOK_STATUS_PENDING,
    messagingStatus: INSTAGRAM_MESSAGING_STATUS_PENDING,
    lastWebhookCheckAt: options.checkedAt,
    webhookSubscriptionError: null,
  };
}

export async function runInstagramPostOauthActivation(
  account: InstagramOauthActivationTarget,
): Promise<InstagramAccountReadinessResult> {
  const checkedAt = new Date().toISOString();
  const oauthConfig = getMetaOauthConfig();

  if (oauthConfig.flow === META_OAUTH_FLOW) {
    return buildInstagramLoginReadinessResult({
      checkedAt,
      pageId: account.page_id ?? null,
    });
  }

  try {
    const managedToken = await ensureInstagramAccessToken({
      accessToken: account.access_token,
      expiresAt: account.token_expires_at ?? null,
    });
    const activation = await activateInstagramAccountWebhooks({
      accessToken: managedToken.accessToken,
      instagramUserId: account.instagram_account_id,
      fallbackPageId: account.page_id ?? null,
    });

    return buildSuccessReadinessResult({
      checkedAt,
      activation,
      messagingScopeGranted: hasMessagingScope(account.scopes),
    });
  } catch (error) {
    return buildActivationFailureResult({
      checkedAt,
      pageId:
        error instanceof InstagramWebhookActivationError
          ? error.pageId
          : account.page_id ?? null,
      error,
    });
  }
}

export async function persistInstagramAccountReadiness(options: {
  admin: AdminClient;
  accountId: string;
  readiness: InstagramAccountReadinessResult;
}) {
  const updateResult = await options.admin
    .from("instagram_accounts")
    .update(
      {
        page_id: options.readiness.pageId,
        status: options.readiness.status,
        webhook_subscribed_at: options.readiness.webhookSubscribedAt,
        webhook_status: options.readiness.webhookStatus,
        messaging_status: options.readiness.messagingStatus,
        last_webhook_check_at: options.readiness.lastWebhookCheckAt,
        webhook_subscription_error: options.readiness.webhookSubscriptionError,
        updated_at: options.readiness.lastWebhookCheckAt,
      } as never,
    )
    .eq("id", options.accountId);

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }
}
