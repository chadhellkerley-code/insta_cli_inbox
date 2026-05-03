import {
  collectInstagramAccountIdentifiers,
  normalizeInstagramIdentifier,
  syncInstagramAccountIdentifiers,
} from "@/lib/meta/account-identifiers";
import { fetchInstagramLoginAccountIdentity } from "@/lib/meta/client";
import { ensureInstagramAccessToken } from "@/lib/meta/token-lifecycle";
import { createAdminClient } from "@/lib/supabase/admin";

const AUTO_INBOX_CLEANUP_COOLDOWN_MS = 15 * 60 * 1000;
const AUTO_INBOX_CLEANUP_STALE_LOCK_MS = 10 * 60 * 1000;
const automaticCleanupByUserId = new Map<string, Promise<void>>();

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

type CleanupStats = {
  accountsReviewed: number;
  accountsRevalidated: number;
  identifiersReset: boolean;
  conversationsScanned: number;
  conversationsReassigned: number;
  conversationsMerged: number;
  conversationsDeleted: number;
  messagesMoved: number;
  messagesDeduplicated: number;
  skippedAmbiguousConversations: number;
  warnings: string[];
};

type InboxCleanupProfileState = {
  id: string;
  instagram_inbox_cleanup_started_at: string | null;
  instagram_inbox_cleanup_last_run_at: string | null;
  instagram_inbox_cleanup_last_repair_at: string | null;
  instagram_inbox_cleanup_last_error: string | null;
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

  return "Automatic inbox cleanup failed.";
}

function didCleanupMutateInbox(stats: CleanupStats) {
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
  const profile = existing.data as InboxCleanupProfileState | null;

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
        role: "user",
      } as never,
      { onConflict: "id" },
    )
    .select(
      "id, instagram_inbox_cleanup_started_at, instagram_inbox_cleanup_last_run_at, instagram_inbox_cleanup_last_repair_at, instagram_inbox_cleanup_last_error",
    )
    .maybeSingle();
  const insertedProfile = inserted.data as InboxCleanupProfileState | null;

  if (inserted.error || !insertedProfile) {
    throw new Error(inserted.error?.message ?? "No pudimos preparar el perfil para autocorreccion.");
  }

  return insertedProfile;
}

async function tryAcquireAutomaticCleanup(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
) {
  const profile = await ensureCleanupProfileRow(admin, userId);
  const now = Date.now();
  const lastRunAtMs = profile.instagram_inbox_cleanup_last_run_at
    ? new Date(profile.instagram_inbox_cleanup_last_run_at).getTime()
    : 0;

  if (lastRunAtMs && now - lastRunAtMs < AUTO_INBOX_CLEANUP_COOLDOWN_MS) {
    return {
      status: "cooldown" as const,
      profile,
    };
  }

  const startedAtMs = profile.instagram_inbox_cleanup_started_at
    ? new Date(profile.instagram_inbox_cleanup_started_at).getTime()
    : 0;

  if (startedAtMs && now - startedAtMs < AUTO_INBOX_CLEANUP_STALE_LOCK_MS) {
    return {
      status: "locked" as const,
      profile,
    };
  }

  const staleLockIso = new Date(now - AUTO_INBOX_CLEANUP_STALE_LOCK_MS).toISOString();
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
  const lockedProfile = lock.data as InboxCleanupProfileState | null;

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

async function finalizeAutomaticCleanup(
  admin: ReturnType<typeof createAdminClient>,
  options: {
    userId: string;
    previousProfile: InboxCleanupProfileState;
    stats?: CleanupStats;
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

async function safeFinalizeAutomaticCleanup(
  admin: ReturnType<typeof createAdminClient>,
  options: {
    userId: string;
    previousProfile: InboxCleanupProfileState;
    stats?: CleanupStats;
    error?: unknown;
  },
) {
  try {
    await finalizeAutomaticCleanup(admin, options);
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
}) {
  const admin = createAdminClient();
  const warnings: string[] = [];
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

  const stats: CleanupStats = {
    accountsReviewed: accounts.length,
    accountsRevalidated: 0,
    identifiersReset: false,
    conversationsScanned: 0,
    conversationsReassigned: 0,
    conversationsMerged: 0,
    conversationsDeleted: 0,
    messagesMoved: 0,
    messagesDeduplicated: 0,
    skippedAmbiguousConversations: 0,
    warnings,
  };

  if (accounts.length === 0) {
    return stats;
  }

  stats.accountsRevalidated = await revalidateAccounts(admin, accounts, warnings);
  await resetCanonicalIdentifiers(admin, accounts);
  stats.identifiersReset = true;

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
      warnings.push(
        `Se omitio la conversacion ${currentConversation.id} porque sus mensajes apuntan a mas de una cuenta candidata.`,
      );
      continue;
    }

    const targetAccountId = resolvedTargetAccountIds[0];

    if (targetAccountId === currentConversation.account_id) {
      continue;
    }

    const targetConversationKey = `${targetAccountId}:${currentConversation.contact_igsid}`;
    const existingTargetConversation = conversationsByKey.get(targetConversationKey);

    if (!existingTargetConversation || existingTargetConversation.id === currentConversation.id) {
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
        stats.messagesMoved += 1;
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

      stats.conversationsReassigned += 1;
      continue;
    }

    const targetConversation = existingTargetConversation;
    const targetMessages = messagesByConversation.get(targetConversation.id) ?? [];
    const targetFingerprints = new Set(
      targetMessages.map((message) => buildMessageFingerprint(message)),
    );
    const targetConversationMessages = [...targetMessages];

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

        stats.messagesDeduplicated += 1;
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
      stats.messagesMoved += 1;
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
    stats.conversationsDeleted += 1;

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

    stats.conversationsMerged += 1;
  }

  return stats;
}

export async function ensureAutomaticInstagramInboxCleanup(userId: string) {
  const existing = automaticCleanupByUserId.get(userId);

  if (existing) {
    return existing;
  }

  const cleanupPromise = (async () => {
    let admin: ReturnType<typeof createAdminClient> | null = null;
    let acquiredProfile: InboxCleanupProfileState | null = null;

    try {
      admin = createAdminClient();
      const acquisition = await tryAcquireAutomaticCleanup(admin, userId);

      if (acquisition.status !== "acquired") {
        return;
      }

      acquiredProfile = acquisition.profile;

      const stats = await cleanupMisroutedInstagramInboxData({ userId });

      if (stats.warnings.length > 0) {
        console.warn("[instagram-inbox-cleanup] completed with warnings", {
          userId,
          warnings: stats.warnings,
        });
      }

      await safeFinalizeAutomaticCleanup(admin, {
        userId,
        previousProfile: acquisition.profile,
        stats,
      });

      console.info("[instagram-inbox-cleanup] automatic repair completed", {
        userId,
        stats,
      });
    } catch (error) {
      if (admin && acquiredProfile) {
        await safeFinalizeAutomaticCleanup(admin, {
          userId,
          previousProfile: acquiredProfile,
          error,
        });
      }

      console.error("[instagram-inbox-cleanup] automatic repair failed", {
        userId,
        error: buildAutoCleanupErrorMessage(error),
      });
    }
  })().finally(() => {
    automaticCleanupByUserId.delete(userId);
  });

  automaticCleanupByUserId.set(userId, cleanupPromise);
  return cleanupPromise;
}
