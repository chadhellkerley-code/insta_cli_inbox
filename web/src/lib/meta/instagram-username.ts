import { createAdminClient } from "@/lib/supabase/admin";

export const INSTAGRAM_FALLBACK_USERNAME_PREFIX = "ig_";

type AccountUsernameRecord = {
  id: string;
  instagram_account_id: string;
  instagram_app_user_id?: string | null;
  username?: string | null;
};

type MessagingUserRef = {
  id?: string | null;
  username?: string | null;
};

type MessagingEventLike = {
  sender?: MessagingUserRef;
  recipient?: MessagingUserRef;
};

function normalizeInstagramUsername(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/^@+/, "");
  return trimmed || null;
}

export function buildFallbackInstagramUsername(instagramUserId: string) {
  return `${INSTAGRAM_FALLBACK_USERNAME_PREFIX}${instagramUserId}`;
}

export function isFallbackInstagramUsername(username?: string | null) {
  return Boolean(normalizeInstagramUsername(username)?.startsWith(INSTAGRAM_FALLBACK_USERNAME_PREFIX));
}

export function isRealInstagramUsername(username?: string | null) {
  const normalized = normalizeInstagramUsername(username);
  return Boolean(normalized && !isFallbackInstagramUsername(normalized));
}

export function resolveInstagramUsernameCandidateFromMessagingEvent(
  account: Pick<
    AccountUsernameRecord,
    "instagram_account_id" | "instagram_app_user_id"
  >,
  event: MessagingEventLike,
) {
  const accountIds = new Set(
    [account.instagram_account_id, account.instagram_app_user_id]
      .map((value) => value?.trim())
      .filter(Boolean),
  );

  for (const [field, actor] of [
    ["sender", event.sender],
    ["recipient", event.recipient],
  ] as const) {
    const actorId = actor?.id?.trim();
    const actorUsername = normalizeInstagramUsername(actor?.username);

    if (!actorId || !actorUsername || !accountIds.has(actorId)) {
      continue;
    }

    if (!isRealInstagramUsername(actorUsername)) {
      continue;
    }

    return {
      username: actorUsername,
      source: `webhook:${field}`,
    };
  }

  return null;
}

export async function syncInstagramUsername(options: {
  admin: ReturnType<typeof createAdminClient>;
  account: AccountUsernameRecord;
  candidateUsername?: string | null;
  source: string;
}) {
  const fallbackUsername = normalizeInstagramUsername(options.account.username);
  const realUsername = normalizeInstagramUsername(options.candidateUsername);

  if (!fallbackUsername || !realUsername) {
    return false;
  }

  if (
    !isFallbackInstagramUsername(fallbackUsername) ||
    !isRealInstagramUsername(realUsername)
  ) {
    return false;
  }

  if (fallbackUsername === realUsername) {
    return false;
  }

  const updateResult = await options.admin
    .from("instagram_accounts")
    .update({
      username: realUsername,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", options.account.id)
    .eq("username", fallbackUsername)
    .select("id, username")
    .maybeSingle();

  if (updateResult.error) {
    console.warn("[instagram-username] username enrichment skipped", {
      accountId: options.account.id,
      instagramUserId: options.account.instagram_account_id,
      source: options.source,
      candidateUsername: realUsername,
      error: updateResult.error.message,
    });
    return false;
  }

  if (!updateResult.data) {
    return false;
  }

  console.info("[instagram-username] username enriched successfully", {
    accountId: options.account.id,
    instagramUserId: options.account.instagram_account_id,
    source: options.source,
    previousUsername: fallbackUsername,
    username: realUsername,
  });

  options.account.username = realUsername;
  return true;
}
