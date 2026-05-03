import {
  collectInstagramAccountIdentifiers,
  normalizeInstagramIdentifier,
  syncInstagramAccountIdentifiers,
} from "@/lib/meta/account-identifiers";
import { fetchInstagramLoginAccountIdentity } from "@/lib/meta/client";
import { ensureInstagramAccessToken } from "@/lib/meta/token-lifecycle";
import { createAdminClient } from "@/lib/supabase/admin";

const INBOX_CLEANUP_STALE_LOCK_MS = 10 * 60 * 1000;

export type InstagramInboxCleanupRunMode = "preview" | "apply";

export type InstagramInboxCleanupAction = {
  conversationId: string;
  currentAccountId: string;
  currentAccountUsername: string | null;
  targetAccountId: string | null;
  targetAccountUsername: string | null;
  contactIgsid: string;
  messageCount: number;
  duplicateMessageCount: number;
  action: "reassign" | "merge" | "skip_ambiguous";
  reason: string;
};

type CleanupAccount = {
  id: string;
  owner_id: string;
  instagram_user_id: string | null;
  instagram_account_id: string;
  instagram_app_user_id: string | null;
  username: string | null;
  account_type: string | null;
  access_token: string;
  token_expires_at: string | null;
  token_lifecycle: string | null;
};

type CleanupConversation = {
  id: string;
  owner_id: string;
  account_id: string;
  contact_igsid: string;
  contact_username: string | null;
  contact_name: string | null;
  labels: string[] | null;
  notes: string | null;
  last_message_text: string | null;
  last_message_type: string | null;
  last_message_at: string | null;
  unread_count: number | null;
  created_at: string | null;
  updated_at: string | null;
};

type CleanupMessage = {
  id: string;
  owner_id: string;
  account_id: string;
  conversation_id: string;
  meta_message_id: string | null;
  direction: string;
  message_type: string;
  text_content: string | null;
  media_url: string | null;
  sender_igsid: string | null;
  recipient_igsid: string | null;
  raw_payload: Record<string, unknown> | null;
  sent_at: string | null;
  created_at: string | null;
};

type AutomationRunRecord = {
  id: string;
  agent_id: string;
  account_id: string;
  conversation_id: string;
};

type AutomationJobRecord = {
  id: string;
  run_id: string;
  account_id: string;
  conversation_id: string;
};

export type InstagramInboxCleanupStats = {
  accountsReviewed: number;
  accountsRevalidated: number;
  identifiersReset: boolean;
  conversationsScanned: number;
  actionableConversations: number;
  conversationsReassigned: number;
  conversationsMerged: number;
  conversationsDeleted: number;
  messagesMoved: number;
  messagesDeduplicated: number;
  skippedAmbiguousConversations: number;
  warnings: string[];
};

export type InstagramInboxCleanupStatus = {
  id: string;
  instagram_inbox_cleanup_started_at: string | null;
  instagram_inbox_cleanup_last_run_at: string | null;
  instagram_inbox_cleanup_last_repair_at: string | null;
  instagram_inbox_cleanup_last_error: string | null;
};

export type InstagramInboxCleanupReport = {
  mode: InstagramInboxCleanupRunMode;
  generatedAt: string;
  stats: InstagramInboxCleanupStats;
  actions: InstagramInboxCleanupAction[];
};

function normalizeOptionalString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function getMessageTimestampMs(message: Pick<CleanupMessage, "sent_at" | "created_at">) {
  const timestamp = new Date(message.sent_at ?? message.created_at ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sortMessages(messages: CleanupMessage[]) {
  return [...messages].sort((left, right) => getMessageTimestampMs(left) - getMessageTimestampMs(right));
}

function getOwnedIdentifierForMessage(message: CleanupMessage) {
  if (message.direction === "out") {
    return normalizeInstagramIdentifier(message.sender_igsid);
  }

  return normalizeInstagramIdentifier(message.recipient_igsid);
}

function getUnderlyingMetaMessageId(message: CleanupMessage) {
  const scopedMessageId = normalizeOptionalString(message.meta_message_id);

  if (scopedMessageId) {
    const separatorIndex = scopedMessageId.indexOf(":");

    if (separatorIndex >= 0 && separatorIndex < scopedMessageId.length - 1) {
      return scopedMessageId.slice(separatorIndex + 1);
    }

    return scopedMessageId;
  }

  const payload = message.raw_payload;

  if (!payload || typeof payload !== "object") {
    return null;
  }

  const messagePayload = payload.message;

  if (messagePayload && typeof messagePayload === "object") {
    const mid = (messagePayload as { mid?: unknown }).mid;

    if (typeof mid === "string" && mid.trim()) {
      return mid.trim();
    }
  }

  const responseMessageId = (payload as { message_id?: unknown }).message_id;

  if (typeof responseMessageId === "string" && responseMessageId.trim()) {
    return responseMessageId.trim();
  }

  return null;
}

function buildScopedMetaMessageId(message: CleanupMessage, accountId: string) {
  const underlyingId = getUnderlyingMetaMessageId(message);

  if (!underlyingId) {
    return normalizeOptionalString(message.meta_message_id);
  }

  return `${accountId}:${underlyingId}`;
}

function buildMessageFingerprint(message: CleanupMessage) {
  const underlyingId = getUnderlyingMetaMessageId(message);

  if (underlyingId) {
    return `meta:${underlyingId}`;
  }

  return [
    "fallback",
    message.direction,
    message.message_type,
    normalizeInstagramIdentifier(message.sender_igsid) ?? "",
    normalizeInstagramIdentifier(message.recipient_igsid) ?? "",
    normalizeOptionalString(message.text_content) ?? "",
    normalizeOptionalString(message.media_url) ?? "",
    message.sent_at ?? message.created_at ?? "",
  ].join("|");
}

function mapMessagePreview(message: Pick<CleanupMessage, "text_content" | "message_type">) {
  if (message.text_content?.trim()) {
    return message.text_content;
  }

  switch (message.message_type) {
    case "audio":
      return "Mensaje de audio";
    case "image":
      return "Imagen";
    case "video":
      return "Video";
    case "file":
      return "Archivo";
    default:
      return "Mensaje";
  }
}

function mergeLabels(source: string[] | null, target: string[] | null) {
  return Array.from(new Set([...(target ?? []), ...(source ?? [])].filter(Boolean)));
}

function buildAutoCleanupErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Instagram inbox cleanup failed.";
}

function didCleanupMutateInbox(stats: InstagramInboxCleanupStats) {
  return (
    stats.conversationsReassigned > 0 ||
    stats.conversationsMerged > 0 ||
    stats.conversationsDeleted > 0 ||
    stats.messagesMoved > 0 ||
    stats.messagesDeduplicated > 0
  );
}

async function ensureCleanupProfileRow(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
) {
  const existing = await admin
    .from("profiles")
    .select(
      "id, instagram_inbox_cleanup_started_at, instagram_inbox_cleanup_last_run_at, instagram_inbox_cleanup_last_repair_at, instagram_inbox_cleanup_last_error",
    )
    .eq("id", userId)
    .maybeSingle();
  const profile = existing.data as InstagramInboxCleanupStatus | null;

  if (existing.error) {
    throw new Error(existing.error.message);
  }

  if (profile) {
    return profile;
  }

  const inserted = await admin
    .from("profiles")
    .upsert(
      {
        id: userId,
      } as never,
      { onConflict: "id" },
    )
    .select(
      "id, instagram_inbox_cleanup_started_at, instagram_inbox_cleanup_last_run_at, instagram_inbox_cleanup_last_repair_at, instagram_inbox_cleanup_last_error",
    )
    .maybeSingle();
  const insertedProfile = inserted.data as InstagramInboxCleanupStatus | null;

  if (inserted.error || !insertedProfile) {
    throw new Error(inserted.error?.message ?? "No pudimos preparar el perfil para autocorreccion.");
  }

  return insertedProfile;
}

async function tryAcquireCleanupRun(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
) {
  const profile = await ensureCleanupProfileRow(admin, userId);
  const now = Date.now();
  const startedAtMs = profile.instagram_inbox_cleanup_started_at
    ? new Date(profile.instagram_inbox_cleanup_started_at).getTime()
    : 0;

  if (startedAtMs && now - startedAtMs < INBOX_CLEANUP_STALE_LOCK_MS) {
    return {
      status: "locked" as const,
      profile,
    };
  }

  const staleLockIso = new Date(now - INBOX_CLEANUP_STALE_LOCK_MS).toISOString();
  const lock = await admin
    .from("profiles")
    .update({
      instagram_inbox_cleanup_started_at: new Date(now).toISOString(),
      instagram_inbox_cleanup_last_error: null,
    } as never)
    .eq("id", userId)
    .or(
      `instagram_inbox_cleanup_started_at.is.null,instagram_inbox_cleanup_started_at.lt.${staleLockIso}`,
    )
    .select(
      "id, instagram_inbox_cleanup_started_at, instagram_inbox_cleanup_last_run_at, instagram_inbox_cleanup_last_repair_at, instagram_inbox_cleanup_last_error",
    )
    .maybeSingle();
  const lockedProfile = lock.data as InstagramInboxCleanupStatus | null;

  if (lock.error) {
    throw new Error(lock.error.message);
  }

  if (!lockedProfile) {
    return {
      status: "locked" as const,
      profile,
    };
  }

  return {
    status: "acquired" as const,
    profile: lockedProfile,
  };
}

async function finalizeCleanupRun(
  admin: ReturnType<typeof createAdminClient>,
  options: {
    userId: string;
    previousProfile: InstagramInboxCleanupStatus;
    stats?: InstagramInboxCleanupStats;
    error?: unknown;
  },
) {
  const nowIso = new Date().toISOString();
  const didRepair = options.stats ? didCleanupMutateInbox(options.stats) : false;
  const update = await admin
    .from("profiles")
    .update({
      instagram_inbox_cleanup_started_at: null,
      instagram_inbox_cleanup_last_run_at: nowIso,
      instagram_inbox_cleanup_last_repair_at: didRepair
        ? nowIso
        : options.previousProfile.instagram_inbox_cleanup_last_repair_at,
      instagram_inbox_cleanup_last_error: options.error
        ? buildAutoCleanupErrorMessage(options.error)
        : null,
    } as never)
    .eq("id", options.userId);

  if (update.error) {
    throw new Error(update.error.message);
  }
}

async function safeFinalizeCleanupRun(
  admin: ReturnType<typeof createAdminClient>,
  options: {
    userId: string;
    previousProfile: InstagramInboxCleanupStatus;
    stats?: InstagramInboxCleanupStats;
    error?: unknown;
  },
) {
  try {
    await finalizeCleanupRun(admin, options);
  } catch (finalizeError) {
    console.error("[instagram-inbox-cleanup] state update failed", {
      userId: options.userId,
      error: buildAutoCleanupErrorMessage(finalizeError),
    });
  }
}

async function refreshConversationSummary(
  admin: ReturnType<typeof createAdminClient>,
  conversation: Pick<CleanupConversation, "id" | "account_id">,
) {
  const messagesResult = await admin
    .from("instagram_messages")
    .select(
      "id, owner_id, account_id, conversation_id, meta_message_id, direction, message_type, text_content, media_url, sender_igsid, recipient_igsid, raw_payload, sent_at, created_at",
    )
    .eq("conversation_id", conversation.id);
  const messages = (messagesResult.data as CleanupMessage[] | null) ?? [];

  if (messagesResult.error) {
    throw new Error(messagesResult.error.message);
  }

  if (messages.length === 0) {
    const deletion = await admin
      .from("instagram_conversations")
      .delete()
      .eq("id", conversation.id);

    if (deletion.error) {
      throw new Error(deletion.error.message);
    }

    return {
      deleted: true as const,
      conversation: null,
    };
  }

  const sortedMessages = sortMessages(messages);
  const lastMessage = sortedMessages[sortedMessages.length - 1];
  const unreadCount = sortedMessages.filter((message) => message.direction === "in").length;
  const updatePayload = {
    account_id: conversation.account_id,
    last_message_text: mapMessagePreview(lastMessage),
    last_message_type: lastMessage.message_type,
    last_message_at: lastMessage.sent_at ?? lastMessage.created_at ?? new Date().toISOString(),
    unread_count: unreadCount,
    updated_at: new Date().toISOString(),
  };
  const update = await admin
    .from("instagram_conversations")
    .update(updatePayload as never)
    .eq("id", conversation.id)
    .select(
      "id, owner_id, account_id, contact_igsid, contact_username, contact_name, labels, notes, last_message_text, last_message_type, last_message_at, unread_count, created_at, updated_at",
    )
    .maybeSingle();
  const updatedConversation = update.data as CleanupConversation | null;

  if (update.error || !updatedConversation) {
    throw new Error(update.error?.message ?? "No pudimos recalcular la conversacion.");
  }

  return {
    deleted: false as const,
    conversation: updatedConversation,
  };
}

async function migrateAutomationReferences(
  admin: ReturnType<typeof createAdminClient>,
  options: {
    sourceConversationId: string;
    targetConversationId: string;
    targetAccountId: string;
  },
) {
  const [sourceRunsResult, targetRunsResult, sourceJobsResult] = await Promise.all([
    admin
      .from("automation_runs")
      .select("id, agent_id, account_id, conversation_id")
      .eq("conversation_id", options.sourceConversationId),
    admin
      .from("automation_runs")
      .select("id, agent_id, account_id, conversation_id")
      .eq("conversation_id", options.targetConversationId),
    admin
      .from("automation_jobs")
      .select("id, run_id, account_id, conversation_id")
      .eq("conversation_id", options.sourceConversationId),
  ]);
  const sourceRuns = (sourceRunsResult.data as AutomationRunRecord[] | null) ?? [];
  const targetRuns = (targetRunsResult.data as AutomationRunRecord[] | null) ?? [];
  const sourceJobs = (sourceJobsResult.data as AutomationJobRecord[] | null) ?? [];

  if (sourceRunsResult.error) {
    throw new Error(sourceRunsResult.error.message);
  }

  if (targetRunsResult.error) {
    throw new Error(targetRunsResult.error.message);
  }

  if (sourceJobsResult.error) {
    throw new Error(sourceJobsResult.error.message);
  }

  const targetRunByAgentId = new Map(targetRuns.map((run) => [run.agent_id, run]));

  for (const sourceRun of sourceRuns) {
    const nowIso = new Date().toISOString();
    const conflictingTargetRun = targetRunByAgentId.get(sourceRun.agent_id);

    if (conflictingTargetRun) {
      const jobIds = sourceJobs
        .filter((job) => job.run_id === sourceRun.id)
        .map((job) => job.id);

      if (jobIds.length > 0) {
        const jobsUpdate = await admin
          .from("automation_jobs")
          .update({
            run_id: conflictingTargetRun.id,
            account_id: options.targetAccountId,
            conversation_id: options.targetConversationId,
            updated_at: nowIso,
          } as never)
          .in("id", jobIds);

        if (jobsUpdate.error) {
          throw new Error(jobsUpdate.error.message);
        }
      }

      const runDeletion = await admin
        .from("automation_runs")
        .delete()
        .eq("id", sourceRun.id);

      if (runDeletion.error) {
        throw new Error(runDeletion.error.message);
      }

      continue;
    }

    const runUpdate = await admin
      .from("automation_runs")
      .update({
        account_id: options.targetAccountId,
        conversation_id: options.targetConversationId,
        updated_at: nowIso,
      } as never)
      .eq("id", sourceRun.id);

    if (runUpdate.error) {
      throw new Error(runUpdate.error.message);
    }
  }

  if (sourceJobs.length > 0) {
    const nowIso = new Date().toISOString();
    const jobsUpdate = await admin
      .from("automation_jobs")
      .update({
        account_id: options.targetAccountId,
        conversation_id: options.targetConversationId,
        updated_at: nowIso,
      } as never)
      .eq("conversation_id", options.sourceConversationId);

    if (jobsUpdate.error) {
      throw new Error(jobsUpdate.error.message);
    }
  }
}

async function revalidateAccounts(
  admin: ReturnType<typeof createAdminClient>,
  accounts: CleanupAccount[],
  warnings: string[],
) {
  let accountsRevalidated = 0;

  for (const account of accounts) {
    try {
      const managedToken = await ensureInstagramAccessToken({
        accessToken: account.access_token,
        expiresAt: account.token_expires_at,
        lifecycle: account.token_lifecycle,
        onTokenUpdate: async (nextToken) => {
          const tokenUpdate = await admin
            .from("instagram_accounts")
            .update({
              access_token: nextToken.accessToken,
              expires_in: nextToken.expiresIn,
              expires_at: nextToken.expiresAt,
              token_obtained_at: nextToken.obtainedAt,
              token_expires_at: nextToken.expiresAt,
              token_lifecycle: nextToken.lifecycle,
              last_token_refresh_at: nextToken.obtainedAt,
              updated_at: nextToken.obtainedAt,
            } as never)
            .eq("id", account.id);

          if (tokenUpdate.error) {
            throw new Error(tokenUpdate.error.message);
          }

          account.access_token = nextToken.accessToken;
          account.token_expires_at = nextToken.expiresAt;
          account.token_lifecycle = nextToken.lifecycle;
        },
      });
      const remoteIdentity = await fetchInstagramLoginAccountIdentity({
        accessToken: managedToken.accessToken,
      });
      const resolvedInstagramAccountId =
        remoteIdentity.instagramAccountId ?? account.instagram_account_id;
      const resolvedInstagramAppUserId =
        remoteIdentity.appScopedUserId ??
        account.instagram_app_user_id ??
        account.instagram_user_id;
      const resolvedUsername =
        normalizeOptionalString(remoteIdentity.username) ?? account.username;
      const resolvedAccountType =
        normalizeOptionalString(remoteIdentity.accountType) ?? account.account_type;
      const needsUpdate =
        resolvedInstagramAccountId !== account.instagram_account_id ||
        resolvedInstagramAppUserId !== account.instagram_app_user_id ||
        resolvedUsername !== account.username ||
        resolvedAccountType !== account.account_type;

      if (needsUpdate) {
        const update = await admin
          .from("instagram_accounts")
          .update({
            instagram_account_id: resolvedInstagramAccountId,
            instagram_app_user_id: resolvedInstagramAppUserId,
            username: resolvedUsername ?? account.username,
            account_type: resolvedAccountType,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", account.id);

        if (update.error) {
          throw new Error(update.error.message);
        }

        account.instagram_account_id = resolvedInstagramAccountId;
        account.instagram_app_user_id = resolvedInstagramAppUserId;
        account.username = resolvedUsername;
        account.account_type = resolvedAccountType;
      }

      accountsRevalidated += 1;
    } catch (error) {
      warnings.push(
        `No pudimos revalidar ${account.username ? `@${account.username}` : account.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return accountsRevalidated;
}

async function resetCanonicalIdentifiers(
  admin: ReturnType<typeof createAdminClient>,
  accounts: CleanupAccount[],
) {
  for (const account of accounts) {
    await syncInstagramAccountIdentifiers({
      admin,
      accountId: account.id,
      identifiers: collectInstagramAccountIdentifiers(account).map((identifier) => ({
        identifier: identifier.identifier,
        identifierType: identifier.identifierType,
      })),
    });
  }
}

export async function cleanupMisroutedInstagramInboxData(options: {
  userId: string;
  mode?: InstagramInboxCleanupRunMode;
  revalidateBeforeRepair?: boolean;
}): Promise<InstagramInboxCleanupReport> {
  const admin = createAdminClient();
  const warnings: string[] = [];
  const mode = options.mode ?? "preview";
  const shouldApply = mode === "apply";
  const shouldRevalidateBeforeRepair = shouldApply && options.revalidateBeforeRepair !== false;
  const accountsResult = await admin
    .from("instagram_accounts")
    .select(
      "id, owner_id, instagram_user_id, instagram_account_id, instagram_app_user_id, username, account_type, access_token, token_expires_at, token_lifecycle",
    )
    .eq("owner_id", options.userId);
  const accounts = (accountsResult.data as CleanupAccount[] | null) ?? [];

  if (accountsResult.error) {
    throw new Error(accountsResult.error.message);
  }

  const actions: InstagramInboxCleanupAction[] = [];
  const stats: InstagramInboxCleanupStats = {
    accountsReviewed: accounts.length,
    accountsRevalidated: 0,
    identifiersReset: false,
    conversationsScanned: 0,
    actionableConversations: 0,
    conversationsReassigned: 0,
    conversationsMerged: 0,
    conversationsDeleted: 0,
    messagesMoved: 0,
    messagesDeduplicated: 0,
    skippedAmbiguousConversations: 0,
    warnings,
  };

  if (accounts.length === 0) {
    return {
      mode,
      generatedAt: new Date().toISOString(),
      stats,
      actions,
    };
  }

  if (shouldRevalidateBeforeRepair) {
    stats.accountsRevalidated = await revalidateAccounts(admin, accounts, warnings);
    await resetCanonicalIdentifiers(admin, accounts);
    stats.identifiersReset = true;
  }

  const accountUsernameById = new Map(
    accounts.map((account) => [account.id, normalizeOptionalString(account.username)]),
  );

  const ownedIdentifierToAccountId = new Map<string, string>();
  const ambiguousOwnedIdentifiers = new Set<string>();

  for (const account of accounts) {
    for (const identifier of collectInstagramAccountIdentifiers(account)) {
      const existing = ownedIdentifierToAccountId.get(identifier.identifier);

      if (existing && existing !== account.id) {
        ambiguousOwnedIdentifiers.add(identifier.identifier);
        ownedIdentifierToAccountId.delete(identifier.identifier);
        continue;
      }

      if (!ambiguousOwnedIdentifiers.has(identifier.identifier)) {
        ownedIdentifierToAccountId.set(identifier.identifier, account.id);
      }
    }
  }

  const conversationsResult = await admin
    .from("instagram_conversations")
    .select(
      "id, owner_id, account_id, contact_igsid, contact_username, contact_name, labels, notes, last_message_text, last_message_type, last_message_at, unread_count, created_at, updated_at",
    )
    .eq("owner_id", options.userId);
  const messagesResult = await admin
    .from("instagram_messages")
    .select(
      "id, owner_id, account_id, conversation_id, meta_message_id, direction, message_type, text_content, media_url, sender_igsid, recipient_igsid, raw_payload, sent_at, created_at",
    )
    .eq("owner_id", options.userId);
  const conversations = (conversationsResult.data as CleanupConversation[] | null) ?? [];
  const messages = (messagesResult.data as CleanupMessage[] | null) ?? [];

  if (conversationsResult.error) {
    throw new Error(conversationsResult.error.message);
  }

  if (messagesResult.error) {
    throw new Error(messagesResult.error.message);
  }

  stats.conversationsScanned = conversations.length;

  const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]));
  const conversationsByKey = new Map(
    conversations.map((conversation) => [
      `${conversation.account_id}:${conversation.contact_igsid}`,
      conversation,
    ]),
  );
  const messagesByConversation = new Map<string, CleanupMessage[]>();

  for (const message of messages) {
    const bucket = messagesByConversation.get(message.conversation_id) ?? [];
    bucket.push(message);
    messagesByConversation.set(message.conversation_id, bucket);
  }

  for (const [conversationId, conversationMessages] of messagesByConversation.entries()) {
    messagesByConversation.set(conversationId, sortMessages(conversationMessages));
  }

  for (const conversation of conversations) {
    const currentConversation = conversationsById.get(conversation.id);

    if (!currentConversation) {
      continue;
    }

    const conversationMessages = messagesByConversation.get(currentConversation.id) ?? [];
    const resolvedTargetAccountIds = Array.from(
      new Set(
        conversationMessages
          .map((message) => {
            const ownedIdentifier = getOwnedIdentifierForMessage(message);

            if (!ownedIdentifier || ambiguousOwnedIdentifiers.has(ownedIdentifier)) {
              return null;
            }

            return ownedIdentifierToAccountId.get(ownedIdentifier) ?? null;
          })
          .filter(Boolean) as string[],
      ),
    );

    if (resolvedTargetAccountIds.length === 0) {
      continue;
    }

    if (resolvedTargetAccountIds.length > 1) {
      stats.skippedAmbiguousConversations += 1;
      const reason =
        "Se omitio porque los mensajes apuntan a mas de una cuenta candidata.";
      warnings.push(`Conversacion ${currentConversation.id}: ${reason}`);
      actions.push({
        conversationId: currentConversation.id,
        currentAccountId: currentConversation.account_id,
        currentAccountUsername:
          accountUsernameById.get(currentConversation.account_id) ?? null,
        targetAccountId: null,
        targetAccountUsername: null,
        contactIgsid: currentConversation.contact_igsid,
        messageCount: conversationMessages.length,
        duplicateMessageCount: 0,
        action: "skip_ambiguous",
        reason,
      });
      continue;
    }

    const targetAccountId = resolvedTargetAccountIds[0];

    if (targetAccountId === currentConversation.account_id) {
      continue;
    }

    const targetConversationKey = `${targetAccountId}:${currentConversation.contact_igsid}`;
    const existingTargetConversation = conversationsByKey.get(targetConversationKey);

    if (!existingTargetConversation || existingTargetConversation.id === currentConversation.id) {
      actions.push({
        conversationId: currentConversation.id,
        currentAccountId: currentConversation.account_id,
        currentAccountUsername:
          accountUsernameById.get(currentConversation.account_id) ?? null,
        targetAccountId,
        targetAccountUsername: accountUsernameById.get(targetAccountId) ?? null,
        contactIgsid: currentConversation.contact_igsid,
        messageCount: conversationMessages.length,
        duplicateMessageCount: 0,
        action: "reassign",
        reason: "La conversacion completa debe pasar a otra cuenta canonica.",
      });
      stats.actionableConversations += 1;
      stats.conversationsReassigned += 1;
      stats.messagesMoved += conversationMessages.length;
    }

    if (!existingTargetConversation || existingTargetConversation.id === currentConversation.id) {
      if (!shouldApply) {
        continue;
      }

      const nowIso = new Date().toISOString();

      for (const message of conversationMessages) {
        const nextScopedMetaMessageId = buildScopedMetaMessageId(message, targetAccountId);
        const update = await admin
          .from("instagram_messages")
          .update({
            account_id: targetAccountId,
            meta_message_id: nextScopedMetaMessageId,
          } as never)
          .eq("id", message.id);

        if (update.error) {
          throw new Error(update.error.message);
        }

        message.account_id = targetAccountId;
        message.meta_message_id = nextScopedMetaMessageId;
      }

      const conversationUpdate = await admin
        .from("instagram_conversations")
        .update({
          account_id: targetAccountId,
          updated_at: nowIso,
        } as never)
        .eq("id", currentConversation.id);

      if (conversationUpdate.error) {
        throw new Error(conversationUpdate.error.message);
      }

      const automationRunsUpdate = await admin
        .from("automation_runs")
        .update({
          account_id: targetAccountId,
          updated_at: nowIso,
        } as never)
        .eq("conversation_id", currentConversation.id);

      if (automationRunsUpdate.error) {
        throw new Error(automationRunsUpdate.error.message);
      }

      const automationJobsUpdate = await admin
        .from("automation_jobs")
        .update({
          account_id: targetAccountId,
          updated_at: nowIso,
        } as never)
        .eq("conversation_id", currentConversation.id);

      if (automationJobsUpdate.error) {
        throw new Error(automationJobsUpdate.error.message);
      }

      conversationsByKey.delete(
        `${currentConversation.account_id}:${currentConversation.contact_igsid}`,
      );
      currentConversation.account_id = targetAccountId;
      conversationsByKey.set(targetConversationKey, currentConversation);

      const refreshed = await refreshConversationSummary(admin, currentConversation);

      if (!refreshed.deleted && refreshed.conversation) {
        conversationsById.set(currentConversation.id, refreshed.conversation);
        conversationsByKey.set(targetConversationKey, refreshed.conversation);
      }

      continue;
    }

    const targetConversation = existingTargetConversation;
    const targetMessages = messagesByConversation.get(targetConversation.id) ?? [];
    const targetFingerprints = new Set(
      targetMessages.map((message) => buildMessageFingerprint(message)),
    );
    const projectedTargetFingerprints = new Set(targetFingerprints);
    const targetConversationMessages = [...targetMessages];
    let duplicateMessageCount = 0;
    let movableMessageCount = 0;

    for (const message of conversationMessages) {
      const fingerprint = buildMessageFingerprint(message);

      if (projectedTargetFingerprints.has(fingerprint)) {
        duplicateMessageCount += 1;
        continue;
      }

      projectedTargetFingerprints.add(fingerprint);
      movableMessageCount += 1;
    }

    actions.push({
      conversationId: currentConversation.id,
      currentAccountId: currentConversation.account_id,
      currentAccountUsername:
        accountUsernameById.get(currentConversation.account_id) ?? null,
      targetAccountId,
      targetAccountUsername: accountUsernameById.get(targetAccountId) ?? null,
      contactIgsid: currentConversation.contact_igsid,
      messageCount: conversationMessages.length,
      duplicateMessageCount,
      action: "merge",
      reason: "La conversacion debe fusionarse con un hilo ya existente de la cuenta canonica.",
    });
    stats.actionableConversations += 1;
    stats.conversationsMerged += 1;
    stats.conversationsDeleted += 1;
    stats.messagesMoved += movableMessageCount;
    stats.messagesDeduplicated += duplicateMessageCount;

    if (!shouldApply) {
      continue;
    }

    await migrateAutomationReferences(admin, {
      sourceConversationId: currentConversation.id,
      targetConversationId: targetConversation.id,
      targetAccountId,
    });

    for (const message of conversationMessages) {
      const fingerprint = buildMessageFingerprint(message);

      if (targetFingerprints.has(fingerprint)) {
        const deletion = await admin
          .from("instagram_messages")
          .delete()
          .eq("id", message.id);

        if (deletion.error) {
          throw new Error(deletion.error.message);
        }
        continue;
      }

      const nextScopedMetaMessageId = buildScopedMetaMessageId(message, targetAccountId);
      const update = await admin
        .from("instagram_messages")
        .update({
          account_id: targetAccountId,
          conversation_id: targetConversation.id,
          meta_message_id: nextScopedMetaMessageId,
        } as never)
        .eq("id", message.id);

      if (update.error) {
        throw new Error(update.error.message);
      }

      const movedMessage = {
        ...message,
        account_id: targetAccountId,
        conversation_id: targetConversation.id,
        meta_message_id: nextScopedMetaMessageId,
      } satisfies CleanupMessage;

      targetFingerprints.add(fingerprint);
      targetConversationMessages.push(movedMessage);
    }

    const mergedConversationUpdate = await admin
      .from("instagram_conversations")
      .update({
        labels: mergeLabels(currentConversation.labels, targetConversation.labels),
        notes: targetConversation.notes?.trim()
          ? targetConversation.notes
          : currentConversation.notes,
        contact_username:
          targetConversation.contact_username ?? currentConversation.contact_username,
        contact_name: targetConversation.contact_name ?? currentConversation.contact_name,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", targetConversation.id);

    if (mergedConversationUpdate.error) {
      throw new Error(mergedConversationUpdate.error.message);
    }

    const sourceConversationDeletion = await admin
      .from("instagram_conversations")
      .delete()
      .eq("id", currentConversation.id);

    if (sourceConversationDeletion.error) {
      throw new Error(sourceConversationDeletion.error.message);
    }

    messagesByConversation.set(targetConversation.id, sortMessages(targetConversationMessages));
    messagesByConversation.delete(currentConversation.id);
    conversationsById.delete(currentConversation.id);
    conversationsByKey.delete(
      `${currentConversation.account_id}:${currentConversation.contact_igsid}`,
    );
    const refreshedTargetConversation = await refreshConversationSummary(admin, {
      id: targetConversation.id,
      account_id: targetAccountId,
    });

    if (!refreshedTargetConversation.deleted && refreshedTargetConversation.conversation) {
      conversationsById.set(targetConversation.id, refreshedTargetConversation.conversation);
      conversationsByKey.set(
        `${refreshedTargetConversation.conversation.account_id}:${refreshedTargetConversation.conversation.contact_igsid}`,
        refreshedTargetConversation.conversation,
      );
    }
  }

  return {
    mode,
    generatedAt: new Date().toISOString(),
    stats,
    actions,
  };
}

export async function getInstagramInboxCleanupStatus(
  userId: string,
): Promise<InstagramInboxCleanupStatus> {
  const admin = createAdminClient();
  return ensureCleanupProfileRow(admin, userId);
}

export async function runInstagramInboxCleanup(options: {
  userId: string;
  mode: InstagramInboxCleanupRunMode;
}) {
  if (options.mode === "preview") {
    return cleanupMisroutedInstagramInboxData({
      userId: options.userId,
      mode: "preview",
      revalidateBeforeRepair: false,
    });
  }

  const admin = createAdminClient();
  const acquisition = await tryAcquireCleanupRun(admin, options.userId);

  if (acquisition.status !== "acquired") {
    throw new Error(
      acquisition.status === "locked"
        ? "Ya hay una limpieza de inbox en progreso para este usuario."
        : "No pudimos adquirir el lock de limpieza del inbox.",
    );
  }

  let report: InstagramInboxCleanupReport | null = null;

  try {
    report = await cleanupMisroutedInstagramInboxData({
      userId: options.userId,
      mode: "apply",
      revalidateBeforeRepair: true,
    });

    await safeFinalizeCleanupRun(admin, {
      userId: options.userId,
      previousProfile: acquisition.profile,
      stats: report.stats,
    });

    return report;
  } catch (error) {
    await safeFinalizeCleanupRun(admin, {
      userId: options.userId,
      previousProfile: acquisition.profile,
      stats: report?.stats,
      error,
    });
    throw error;
  }
}
