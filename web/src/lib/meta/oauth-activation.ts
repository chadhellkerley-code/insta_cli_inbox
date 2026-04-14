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

type AdminClient = ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;

type InstagramOauthActivationTarget = {
  instagram_account_id: string;
  page_id?: string | null;
  access_token?: string;
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
  lastWebhookCheckAt: string | null;
  webhookSubscriptionError: string | null;
};

function buildInstagramLoginReadinessResult(options: {
  pageId?: string | null;
}): InstagramAccountReadinessResult {
  return {
    status: INSTAGRAM_ACCOUNT_STATUS_OAUTH_CONNECTED,
    pageId: options.pageId ?? null,
    webhookSubscribedAt: null,
    webhookStatus: INSTAGRAM_WEBHOOK_STATUS_PENDING,
    messagingStatus: INSTAGRAM_MESSAGING_STATUS_PENDING,
    lastWebhookCheckAt: null,
    webhookSubscriptionError: null,
  };
}

export async function runInstagramPostOauthActivation(
  account: InstagramOauthActivationTarget,
): Promise<InstagramAccountReadinessResult> {
  const oauthConfig = getMetaOauthConfig();

  if (oauthConfig.flow === META_OAUTH_FLOW) {
    return buildInstagramLoginReadinessResult({
      pageId: account.page_id ?? null,
    });
  }

  throw new Error(`Unsupported Meta OAuth flow: ${oauthConfig.flow}`);
}

export async function persistInstagramAccountReadiness(options: {
  admin: AdminClient;
  accountId: string;
  readiness: InstagramAccountReadinessResult;
}) {
  const updatedAt = options.readiness.lastWebhookCheckAt ?? new Date().toISOString();
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
        updated_at: updatedAt,
      } as never,
    )
    .eq("id", options.accountId);

  if (updateResult.error) {
    throw new Error(updateResult.error.message);
  }
}
