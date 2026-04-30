export const INSTAGRAM_FALLBACK_USERNAME_PREFIX = "ig_";

type AccountUsernameRecord = {
  id: string;
  owner_id?: string | null;
  instagram_user_id?: string | null;
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

type StoredRuntimeMessageRecord = {
  account_id: string;
  raw_payload: unknown;
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

function normalizeInstagramIdentifier(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function buildExpectedFallbackInstagramUsername(
  account: Pick<
    AccountUsernameRecord,
    "instagram_user_id" | "instagram_account_id" | "instagram_app_user_id"
  >,
) {
  const fallbackId =
    normalizeInstagramIdentifier(account.instagram_user_id) ??
    normalizeInstagramIdentifier(account.instagram_account_id) ??
    normalizeInstagramIdentifier(account.instagram_app_user_id);

  return fallbackId ? buildFallbackInstagramUsername(fallbackId) : null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function coerceMessagingUserRef(value: unknown): MessagingUserRef | undefined {
  if (!isObjectRecord(value)) {
    return undefined;
  }

  return {
    id:
      typeof value.id === "string"
        ? value.id
        : typeof value.id === "number"
          ? String(value.id)
          : null,
    username: typeof value.username === "string" ? value.username : null,
  };
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

export function resolveInstagramUsernameCandidateFromStoredPayload(
  account: Pick<
    AccountUsernameRecord,
    "instagram_account_id" | "instagram_app_user_id"
  >,
  payload: unknown,
) {
  if (!isObjectRecord(payload)) {
    return null;
  }

  const candidate = resolveInstagramUsernameCandidateFromMessagingEvent(account, {
    sender: coerceMessagingUserRef(payload.sender),
    recipient: coerceMessagingUserRef(payload.recipient),
  });

  if (!candidate) {
    return null;
  }

  return {
    username: candidate.username,
    source: `inbox:${candidate.source}`,
  };
}

export async function syncInstagramUsername(options: {
  admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
  account: AccountUsernameRecord;
  candidateUsername?: string | null;
  ownerId?: string;
  source: string;
}) {
  const currentUsername = normalizeInstagramUsername(options.account.username);
  const nextUsername = normalizeInstagramUsername(options.candidateUsername);
  const expectedFallbackUsername = buildExpectedFallbackInstagramUsername(options.account);

  if (
    !expectedFallbackUsername ||
    currentUsername !== expectedFallbackUsername ||
    !isRealInstagramUsername(nextUsername)
  ) {
    return false;
  }

  const fallbackUsername = currentUsername;
  const realUsername = nextUsername;
  const ownerId = options.ownerId ?? options.account.owner_id;

  if (fallbackUsername === realUsername) {
    return false;
  }

  if (!ownerId) {
    return false;
  }

  const updateResult = await options.admin
    .from("instagram_accounts")
    .update({
      username: realUsername,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", options.account.id)
    .eq("owner_id", ownerId)
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

export async function syncInstagramUsernamesFromStoredRuntimeMetadata(options: {
  admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
  ownerId: string;
  accounts: AccountUsernameRecord[];
}) {
  const pendingAccounts = options.accounts.filter((account) => {
    const currentUsername = normalizeInstagramUsername(account.username);
    const expectedFallbackUsername = buildExpectedFallbackInstagramUsername(account);
    return Boolean(expectedFallbackUsername && currentUsername === expectedFallbackUsername);
  });

  if (pendingAccounts.length === 0) {
    return 0;
  }

  const pendingAccountIds = pendingAccounts.map((account) => account.id);
  const messagesResult = await options.admin
    .from("instagram_messages")
    .select("account_id, raw_payload")
    .eq("owner_id", options.ownerId)
    .in("account_id", pendingAccountIds)
    .not("raw_payload", "is", null)
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(pendingAccounts.length * 25, 50), 500));
  const messages = (messagesResult.data as StoredRuntimeMessageRecord[] | null) ?? [];

  if (messagesResult.error) {
    console.warn("[instagram-username] stored runtime metadata scan failed", {
      ownerId: options.ownerId,
      accountIds: pendingAccountIds,
      error: messagesResult.error.message,
    });
    return 0;
  }

  const accountById = new Map(pendingAccounts.map((account) => [account.id, account]));
  const attemptedAccountIds = new Set<string>();
  let updatedAccounts = 0;

  for (const message of messages) {
    const account = accountById.get(message.account_id);

    if (!account || attemptedAccountIds.has(account.id)) {
      continue;
    }

    const candidate = resolveInstagramUsernameCandidateFromStoredPayload(
      account,
      message.raw_payload,
    );

    if (!candidate) {
      continue;
    }

    attemptedAccountIds.add(account.id);

    if (
      await syncInstagramUsername({
        admin: options.admin,
        account,
        candidateUsername: candidate.username,
        ownerId: options.ownerId,
        source: candidate.source,
      })
    ) {
      updatedAccounts += 1;
    }
  }

  return updatedAccounts;
}
