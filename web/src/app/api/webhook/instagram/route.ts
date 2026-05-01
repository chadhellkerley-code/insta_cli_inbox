import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import {
  collectInstagramAccountIdentifiers,
  normalizeInstagramIdentifier,
  persistInstagramAccountIdentifiers,
} from "@/lib/meta/account-identifiers";
import { getMetaServerEnv } from "@/lib/meta/config";
import { fetchInstagramLoginAccountIdentity } from "@/lib/meta/client";
import {
  resolveInstagramUsernameCandidateFromMessagingEvent,
  syncInstagramUsername,
} from "@/lib/meta/instagram-username";
import {
  INSTAGRAM_ACCOUNT_STATUS_MESSAGING_READY,
  INSTAGRAM_MESSAGING_STATUS_READY,
  INSTAGRAM_WEBHOOK_STATUS_READY,
} from "@/lib/meta/account-status";
import { scheduleAutomationForInboundMessage } from "@/lib/automation/runtime";
import { resolveInstagramContactProfile } from "@/lib/meta/profile-enrichment";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type MessagingEvent = {
  sender?: { id?: string; username?: string };
  recipient?: { id?: string; username?: string };
  timestamp?: number | string;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    is_deleted?: boolean;
    attachments?: Array<{
      type?: string;
      payload?: {
        url?: string;
        source?: string;
      };
    }>;
  };
};

type WebhookPayload = {
  object?: string;
  entry?: Array<{
    id?: string;
    messaging?: MessagingEvent[];
    changes?: Array<{
      field?: string;
      value?: MessagingEvent;
    }>;
  }>;
};

type AccountLookup = {
  id: string;
  owner_id: string;
  page_id: string | null;
  instagram_user_id: string | null;
  instagram_account_id: string;
  instagram_app_user_id: string | null;
  username: string | null;
  access_token: string;
  token_expires_at: string | null;
  last_oauth_at: string | null;
  name?: string | null;
  profile_picture_url?: string | null;
  status?: string | null;
};

type ConversationLookup = {
  id: string;
  contact_username: string | null;
  contact_name: string | null;
  unread_count: number | null;
};

type AccountMatchResult = {
  account: AccountLookup;
  matchedBy: string;
  matchedValue: string;
};

type ClassifiedMessagingEvent = {
  direction: "in" | "out";
  contactIgsid: string;
  ownedCandidateIds: string[];
  ownedUsername: string | null;
  ownedIdentifierCandidates: Array<{
    identifier: string | null | undefined;
    identifierType: string;
  }>;
};

type MessagingEventSkipReason =
  | "missing_message"
  | "missing_message_mid"
  | "deleted_message"
  | "missing_owned_account_identifier"
  | "missing_contact_igsid";

type CachedAccountMatch = {
  accountId: string;
  expiresAtMs: number;
};

type PersistMessagingEventResult =
  | {
      status: "persisted";
      conversationId: string;
      contactIgsid: string;
      isInbound: boolean;
      messageType: string;
      createdAt: string;
    }
  | {
      status: "skipped";
      reason: MessagingEventSkipReason;
    };

const REMOTE_MATCH_CACHE_TTL_MS = 10 * 60 * 1000;
const remoteAccountMatchCache = new Map<string, CachedAccountMatch>();

function logWebhook(
  level: "info" | "warn" | "error",
  message: string,
  payload: Record<string, unknown>,
) {
  const formattedMessage = `[instagram-webhook] ${message}`;

  if (level === "error") {
    console.error(formattedMessage, payload);
    return;
  }

  if (level === "warn") {
    console.warn(formattedMessage, payload);
    return;
  }

  console.info(formattedMessage, payload);
}

function mapAttachmentType(type: string | undefined) {
  switch (type) {
    case "audio":
      return "audio";
    case "image":
      return "image";
    case "video":
      return "video";
    case "file":
      return "file";
    default:
      return "text";
  }
}

function resolveWebhookTimestampToIso(timestamp?: number | string) {
  if (timestamp === undefined || timestamp === null || timestamp === "") {
    return new Date().toISOString();
  }

  const numeric =
    typeof timestamp === "string" ? Number(timestamp.trim()) : timestamp;

  if (!Number.isFinite(numeric)) {
    return new Date().toISOString();
  }

  const milliseconds = numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  const date = new Date(milliseconds);

  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

function getMessagePreview(text: string | null, messageType: string) {
  if (text?.trim()) {
    return text;
  }

  switch (messageType) {
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

function classifyMessagingEvent(
  entryId: string | null,
  event: MessagingEvent,
): ClassifiedMessagingEvent | { status: "skipped"; reason: MessagingEventSkipReason } {
  if (event.message?.is_deleted) {
    return {
      status: "skipped",
      reason: "deleted_message",
    } as const;
  }

  const normalizedEntryId = normalizeInstagramIdentifier(entryId);
  const senderId = normalizeInstagramIdentifier(event.sender?.id ?? null);
  const recipientId = normalizeInstagramIdentifier(event.recipient?.id ?? null);
  const isEcho = event.message?.is_echo === true;
  const direction = isEcho ? "out" : "in";
  const ownedActorId = isEcho ? senderId : recipientId;
  const contactIgsid = isEcho ? recipientId : senderId;
  const ownedCandidateIds = Array.from(
    new Set([normalizedEntryId, ownedActorId].filter(Boolean) as string[]),
  );

  if (ownedCandidateIds.length === 0) {
    return {
      status: "skipped",
      reason: "missing_owned_account_identifier",
    } as const;
  }

  if (!contactIgsid) {
    return {
      status: "skipped",
      reason: "missing_contact_igsid",
    } as const;
  }

  return {
    direction,
    contactIgsid,
    ownedCandidateIds,
    ownedUsername: normalizeInstagramUsername(
      isEcho ? event.sender?.username : event.recipient?.username,
    ),
    ownedIdentifierCandidates: [
      {
        identifier: ownedActorId,
        identifierType: isEcho ? "webhook_sender_id" : "webhook_recipient_id",
      },
    ],
  };
}

function validateWebhookSignature(rawBody: string, signatureHeader: string | null) {
  if (!signatureHeader?.startsWith("sha256=")) {
    return false;
  }

  const expected = signatureHeader.slice("sha256=".length).trim();

  if (!expected) {
    return false;
  }

  const { appSecret } = getMetaServerEnv();
  const actual = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  const actualBuffer = Buffer.from(actual, "hex");

  if (expectedBuffer.length === 0 || expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, actualBuffer);
}

function normalizeInstagramUsername(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().replace(/^@+/, "");
  return trimmed || null;
}

async function loadAccountById(
  admin: ReturnType<typeof createAdminClient>,
  accountId: string,
) {
  const result = await admin
    .from("instagram_accounts")
    .select(
      "id, owner_id, page_id, instagram_user_id, instagram_account_id, instagram_app_user_id, username, access_token, token_expires_at, last_oauth_at, name, profile_picture_url",
    )
    .eq("id", accountId)
    .maybeSingle();
  const account = result.data as AccountLookup | null;

  if (result.error) {
    throw new Error(result.error.message);
  }

  return account;
}

function readCachedAccountMatch(candidateId: string) {
  const cached = remoteAccountMatchCache.get(candidateId);

  if (!cached) {
    return null;
  }

  if (cached.expiresAtMs <= Date.now()) {
    remoteAccountMatchCache.delete(candidateId);
    return null;
  }

  return cached;
}

function writeCachedAccountMatch(candidateId: string, accountId: string) {
  remoteAccountMatchCache.set(candidateId, {
    accountId,
    expiresAtMs: Date.now() + REMOTE_MATCH_CACHE_TTL_MS,
  });
}

function dedupeByAccountId<T extends { account_id: string }>(rows: T[]) {
  return Array.from(new Map(rows.map((row) => [row.account_id, row])).values());
}

async function findAccountForEvent(
  admin: ReturnType<typeof createAdminClient>,
  options: {
    candidateIds: string[];
    candidateUsername: string | null;
  },
) {
  const candidateIds = Array.from(
    new Set(options.candidateIds.map(normalizeInstagramIdentifier).filter(Boolean) as string[]),
  );
  const candidateUsernames = [
    normalizeInstagramUsername(options.candidateUsername),
  ].filter(Boolean) as string[];

  if (candidateIds.length > 0) {
    const aliasResult = await admin
      .from("instagram_account_identifiers")
      .select("account_id, identifier, identifier_type")
      .in("identifier", candidateIds)
      .neq("identifier_type", "webhook_entry_id");
    const aliases =
      (aliasResult.data as
        | Array<{ account_id: string; identifier: string; identifier_type: string }>
        | null) ?? [];

    if (aliasResult.error) {
      throw new Error(aliasResult.error.message);
    }

    for (const candidateId of candidateIds) {
      const aliasesForCandidate = dedupeByAccountId(
        aliases.filter((row) => row.identifier === candidateId),
      );

      if (aliasesForCandidate.length === 0) {
        continue;
      }

      if (aliasesForCandidate.length > 1) {
        logWebhook("warn", "ambiguous alias identifier match", {
          candidateId,
          accountIds: aliasesForCandidate.map((row) => row.account_id),
        });
        continue;
      }

      const alias = aliasesForCandidate[0];
      const account = await loadAccountById(admin, alias.account_id);

      if (account) {
        return {
          account,
          matchedBy: `identifier:${alias.identifier_type}`,
          matchedValue: alias.identifier,
        } satisfies AccountMatchResult;
      }
    }
  }

  for (const candidateId of candidateIds) {
    for (const column of [
      "instagram_account_id",
      "instagram_app_user_id",
      "instagram_user_id",
      "page_id",
    ] as const) {
      const result = await admin
        .from("instagram_accounts")
        .select(
          "id, owner_id, page_id, instagram_user_id, instagram_account_id, instagram_app_user_id, username, access_token, token_expires_at, last_oauth_at, name, profile_picture_url",
        )
        .eq(column, candidateId)
        .limit(2);
      const accounts = (result.data as AccountLookup[] | null) ?? [];

      if (result.error) {
        throw new Error(result.error.message);
      }

      if (accounts.length > 1) {
        logWebhook("warn", "ambiguous direct column match", {
          candidateId,
          column,
          accountIds: accounts.map((account) => account.id),
        });
        continue;
      }

      const account = accounts[0] ?? null;

      if (account) {
        return {
          account,
          matchedBy: column,
          matchedValue: candidateId,
        } satisfies AccountMatchResult;
      }
    }
  }

  if (candidateUsernames.length > 0) {
    const usernameResult = await admin
      .from("instagram_accounts")
      .select(
        "id, owner_id, page_id, instagram_user_id, instagram_account_id, instagram_app_user_id, username, access_token, token_expires_at, last_oauth_at, name, profile_picture_url",
      )
      .in("username", candidateUsernames)
      .limit(candidateUsernames.length);
    const accounts = (usernameResult.data as AccountLookup[] | null) ?? [];

    if (usernameResult.error) {
      throw new Error(usernameResult.error.message);
    }

    for (const candidateUsername of candidateUsernames) {
      const account = accounts.find(
        (item) => normalizeInstagramUsername(item.username) === candidateUsername,
      );

      if (account) {
        const matchedActor =
          normalizeInstagramUsername(options.candidateUsername) === candidateUsername
            ? "owned_username"
            : "username";

        return {
          account,
          matchedBy: matchedActor,
          matchedValue: candidateUsername,
        } satisfies AccountMatchResult;
      }
    }
  }

  return null;
}

async function findBootstrapAccountForEvent(
  admin: ReturnType<typeof createAdminClient>,
  options: {
    senderId: string | null;
    recipientId: string | null;
  },
) {
  const recipientId = normalizeInstagramIdentifier(options.recipientId);

  if (!recipientId) {
    return null;
  }

  const result = await admin
    .from("instagram_accounts")
    .select(
      "id, owner_id, page_id, instagram_user_id, instagram_account_id, instagram_app_user_id, username, access_token, token_expires_at, last_oauth_at, name, profile_picture_url, status",
    );
  const accounts = (result.data as AccountLookup[] | null) ?? [];

  if (result.error) {
    throw new Error(result.error.message);
  }

  const senderId = normalizeInstagramIdentifier(options.senderId);
  const candidates = accounts.filter((account) => {
    const storedIds = new Set(
      collectInstagramAccountIdentifiers(account).map((identifier) => identifier.identifier),
    );
    const currentAppUserId = normalizeInstagramIdentifier(account.instagram_app_user_id);
    const canBootstrapAppUserId =
      !currentAppUserId ||
      currentAppUserId === normalizeInstagramIdentifier(account.instagram_user_id) ||
      currentAppUserId === normalizeInstagramIdentifier(account.instagram_account_id);

    if (!canBootstrapAppUserId) {
      return false;
    }

    if (storedIds.has(recipientId)) {
      return false;
    }

    if (senderId && storedIds.has(senderId)) {
      return false;
    }

    return true;
  });

  if (candidates.length !== 1) {
    return null;
  }

  return {
    account: candidates[0],
    matchedBy: "bootstrap:recipient_id",
    matchedValue: recipientId,
  } satisfies AccountMatchResult;
}

async function findAccountByRemoteIdentityForEvent(
  admin: ReturnType<typeof createAdminClient>,
  options: {
    candidateIds: string[];
  },
) {
  const candidateIds = new Set(
    options.candidateIds
      .map((value) => normalizeInstagramIdentifier(value))
      .filter(Boolean) as string[],
  );

  if (candidateIds.size === 0) {
    return null;
  }

  for (const candidateId of candidateIds) {
    const cached = readCachedAccountMatch(candidateId);

    if (!cached) {
      continue;
    }

    const account = await loadAccountById(admin, cached.accountId);

    if (!account) {
      remoteAccountMatchCache.delete(candidateId);
      continue;
    }

    return {
      account,
      matchedBy: "remote_identity_cache",
      matchedValue: candidateId,
    } satisfies AccountMatchResult;
  }

  const accountsResult = await admin
    .from("instagram_accounts")
    .select(
      "id, owner_id, page_id, instagram_user_id, instagram_account_id, instagram_app_user_id, username, access_token, token_expires_at, last_oauth_at, name, profile_picture_url",
    );
  const accounts = (accountsResult.data as AccountLookup[] | null) ?? [];

  if (accountsResult.error) {
    throw new Error(accountsResult.error.message);
  }

  const matches: AccountMatchResult[] = [];

  for (const account of accounts) {
    if (!account.access_token?.trim()) {
      continue;
    }

    try {
      const remoteIdentity = await fetchInstagramLoginAccountIdentity({
        accessToken: account.access_token,
      });
      const remoteCandidates = [
        normalizeInstagramIdentifier(remoteIdentity.instagramAccountId),
        normalizeInstagramIdentifier(remoteIdentity.appScopedUserId),
      ].filter(Boolean) as string[];
      const matchedValue = remoteCandidates.find((value) => candidateIds.has(value));

      if (!matchedValue) {
        continue;
      }

      matches.push({
        account,
        matchedBy: "remote_identity",
        matchedValue,
      });
    } catch (error) {
      logWebhook("warn", "remote identity lookup skipped", {
        accountId: account.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (matches.length !== 1) {
    return null;
  }

  const match = matches[0];
  await persistInstagramAccountIdentifiers({
    admin,
    accountId: match.account.id,
    identifiers: [
      {
        identifier: match.matchedValue,
        identifierType: "remote_identity",
      },
    ],
  });

  for (const candidateId of candidateIds) {
    writeCachedAccountMatch(candidateId, match.account.id);
  }

  return match;
}

function resolveOwnedIdentifierCandidates(
  account: AccountLookup,
  classification: ClassifiedMessagingEvent,
) {
  const storedIds = new Set(
    collectInstagramAccountIdentifiers(account).map((identifier) => identifier.identifier),
  );

  return classification.ownedIdentifierCandidates.map((candidate) => {
    const identifier = normalizeInstagramIdentifier(candidate.identifier);

    return {
      identifier:
        identifier &&
        (storedIds.has(identifier) || classification.ownedCandidateIds.includes(identifier))
          ? identifier
          : null,
      identifierType: candidate.identifierType,
    };
  });
}

async function backfillInstagramAppUserId(
  admin: ReturnType<typeof createAdminClient>,
  account: AccountLookup,
  identifierCandidates: Array<{ identifier: string | null | undefined; identifierType: string }>,
) {
  const currentIds = new Set(
    collectInstagramAccountIdentifiers(account).map((identifier) => identifier.identifier),
  );
  const nextAppUserId = identifierCandidates
    .filter((candidate) => candidate.identifierType !== "webhook_entry_id")
    .map((candidate) => normalizeInstagramIdentifier(candidate.identifier))
    .find((candidate) => candidate && !currentIds.has(candidate));

  if (
    !nextAppUserId ||
    (account.instagram_app_user_id &&
      normalizeInstagramIdentifier(account.instagram_app_user_id) === nextAppUserId)
  ) {
    return;
  }

  const currentAppUserId = normalizeInstagramIdentifier(account.instagram_app_user_id);
  const canOverwriteExistingAppUserId =
    !currentAppUserId ||
    currentAppUserId === normalizeInstagramIdentifier(account.instagram_user_id) ||
    currentAppUserId === normalizeInstagramIdentifier(account.instagram_account_id);

  if (!canOverwriteExistingAppUserId) {
    return;
  }

  const update = await admin
    .from("instagram_accounts")
    .update({
      instagram_app_user_id: nextAppUserId,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", account.id);

  if (update.error) {
    console.warn("[instagram-webhook] instagram_app_user_id backfill skipped", {
      accountId: account.id,
      instagramAppUserId: nextAppUserId,
      error: update.error.message,
    });
    return;
  }

  account.instagram_app_user_id = nextAppUserId;
}

async function persistWebhookDebugEvent(
  admin: ReturnType<typeof createAdminClient>,
  options: {
    reason: string;
    bodyObject: string | null;
    entryId: string | null;
    senderId: string | null;
    recipientId: string | null;
    messageId: string | null;
    matchedAccountId?: string | null;
    payload: unknown;
  },
) {
  const result = await admin.from("instagram_webhook_events_debug").insert({
    matched_account_id: options.matchedAccountId ?? null,
    reason: options.reason,
    body_object: options.bodyObject,
    entry_id: options.entryId,
    sender_id: options.senderId,
    recipient_id: options.recipientId,
    message_mid: options.messageId,
    payload: options.payload,
  } as never);

  if (result.error) {
    console.warn("[instagram-webhook] debug persistence skipped", {
      reason: options.reason,
      entryId: options.entryId,
      senderId: options.senderId,
      recipientId: options.recipientId,
      messageId: options.messageId,
      error: result.error.message,
    });
  }
}

async function upsertConversationForMessage(
  admin: ReturnType<typeof createAdminClient>,
  options: {
    accountId: string;
    ownerId: string;
    contactIgsid: string;
    contactUsername: string | null;
    contactName: string | null;
    preview: string;
    messageType: string;
    createdAt: string;
    isInbound: boolean;
  },
) {
  const existingResult = await admin
    .from("instagram_conversations")
    .select("id, contact_username, contact_name, unread_count")
    .eq("owner_id", options.ownerId)
    .eq("account_id", options.accountId)
    .eq("contact_igsid", options.contactIgsid)
    .maybeSingle();
  const existing = existingResult.data as ConversationLookup | null;

  if (existingResult.error) {
    throw new Error(existingResult.error.message);
  }

  if (existing) {
    const update = await admin
      .from("instagram_conversations")
      .update({
        contact_username: options.contactUsername ?? existing.contact_username,
        contact_name: options.contactName ?? existing.contact_name,
        last_message_text: options.preview,
        last_message_type: options.messageType,
        last_message_at: options.createdAt,
        unread_count: (existing.unread_count ?? 0) + (options.isInbound ? 1 : 0),
        updated_at: options.createdAt,
      } as never)
      .eq("id", existing.id)
      .eq("owner_id", options.ownerId)
      .select("id")
      .maybeSingle();
    const updatedConversation = update.data as { id: string } | null;

    if (update.error || !updatedConversation) {
      throw new Error(update.error?.message ?? "No pudimos actualizar el hilo.");
    }

    return updatedConversation.id;
  }

  const insert = await admin
    .from("instagram_conversations")
    .insert({
      owner_id: options.ownerId,
      account_id: options.accountId,
      contact_igsid: options.contactIgsid,
      contact_username: options.contactUsername,
      contact_name: options.contactName,
      last_message_text: options.preview,
      last_message_type: options.messageType,
      last_message_at: options.createdAt,
      unread_count: options.isInbound ? 1 : 0,
      labels: [],
      notes: null,
    } as never)
    .select("id")
    .maybeSingle();
  const insertedConversation = insert.data as { id: string } | null;

  if (insert.error || !insertedConversation) {
    throw new Error(insert.error?.message ?? "No pudimos crear el hilo.");
  }

  return insertedConversation.id;
}

function resolveConversationContactUsername(
  account: AccountLookup,
  event: MessagingEvent,
  isInbound: boolean,
) {
  if (isInbound) {
    return event.sender?.username ?? event.recipient?.username ?? null;
  }

  const recipientUsername = event.recipient?.username ?? null;

  if (recipientUsername && recipientUsername !== account.username) {
    return recipientUsername;
  }

  return null;
}

async function resolveConversationContactProfile(
  admin: ReturnType<typeof createAdminClient>,
  account: AccountLookup,
  contactIgsid: string,
  event: MessagingEvent,
  isInbound: boolean,
) {
  const webhookUsername = normalizeInstagramUsername(
    resolveConversationContactUsername(account, event, isInbound),
  );

  try {
    const cachedProfile = await resolveInstagramContactProfile({
      admin,
      account,
      contactIgsid,
    });

    return {
      contactUsername: cachedProfile.contactUsername ?? webhookUsername,
      contactName: cachedProfile.contactName,
    };
  } catch (error) {
    console.warn("[instagram-webhook] contact profile enrichment skipped", {
      accountId: account.id,
      contactIgsid,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return {
    contactUsername: webhookUsername,
    contactName: null,
  };
}

async function enrichAccountUsernameFromEvent(
  admin: ReturnType<typeof createAdminClient>,
  account: AccountLookup,
  event: MessagingEvent,
) {
  const candidate = resolveInstagramUsernameCandidateFromMessagingEvent(account, event);

  if (!candidate) {
    return;
  }

  await syncInstagramUsername({
    admin,
    account,
    candidateUsername: candidate.username,
    source: candidate.source,
  });
}

async function persistMessagingEvent(
  admin: ReturnType<typeof createAdminClient>,
  account: AccountLookup,
  classification: ClassifiedMessagingEvent,
  event: MessagingEvent,
): Promise<PersistMessagingEventResult> {
  if (!event.message) {
    return {
      status: "skipped",
      reason: "missing_message",
    };
  }

  if (!event.message.mid) {
    return {
      status: "skipped",
      reason: "missing_message_mid",
    };
  }

  const senderId = normalizeInstagramIdentifier(event.sender?.id ?? null);
  const recipientId =
    normalizeInstagramIdentifier(event.recipient?.id ?? null) ??
    account.instagram_app_user_id ??
    account.instagram_account_id;
  const isInbound = classification.direction === "in";
  const contactIgsid = classification.contactIgsid;

  const ownedIdentifierCandidates = resolveOwnedIdentifierCandidates(
    account,
    classification,
  );
  await persistInstagramAccountIdentifiers({
    admin,
    accountId: account.id,
    identifiers: [
      ...collectInstagramAccountIdentifiers(account).map((identifier) => ({
        identifier: identifier.identifier,
        identifierType: identifier.identifierType,
      })),
      ...ownedIdentifierCandidates,
    ],
  });
  await backfillInstagramAppUserId(admin, account, ownedIdentifierCandidates);

  const attachment = event.message.attachments?.[0];
  const scopedMetaMessageId = `${account.id}:${event.message.mid}`;
  const messageType = event.message.text?.trim()
    ? "text"
    : mapAttachmentType(attachment?.type);
  const createdAt = resolveWebhookTimestampToIso(event.timestamp);
  const preview = getMessagePreview(event.message.text ?? null, messageType);
  const contactProfile = await resolveConversationContactProfile(
    admin,
    account,
    contactIgsid,
    event,
    isInbound,
  );
  const conversationId = await upsertConversationForMessage(admin, {
    accountId: account.id,
    ownerId: account.owner_id,
    contactIgsid,
    contactUsername: contactProfile.contactUsername,
    contactName: contactProfile.contactName,
    preview,
    messageType,
    createdAt,
    isInbound,
  });

  const upsert = await admin.from("instagram_messages").upsert(
    {
      owner_id: account.owner_id,
      account_id: account.id,
      conversation_id: conversationId,
      meta_message_id: scopedMetaMessageId,
      direction: isInbound ? "in" : "out",
      message_type: messageType,
      text_content: event.message.text ?? null,
      media_url: attachment?.payload?.url ?? attachment?.payload?.source ?? null,
      sender_igsid: senderId,
      recipient_igsid: recipientId,
      raw_payload: event,
      sent_at: createdAt,
      created_at: createdAt,
    } as never,
    {
      onConflict: "meta_message_id",
      ignoreDuplicates: true,
    },
  );

  if (upsert.error) {
    throw new Error(upsert.error.message);
  }

  await admin
    .from("instagram_accounts")
    .update({
      last_webhook_at: new Date().toISOString(),
      last_webhook_check_at: new Date().toISOString(),
      webhook_status: INSTAGRAM_WEBHOOK_STATUS_READY,
      messaging_status: INSTAGRAM_MESSAGING_STATUS_READY,
      webhook_subscription_error: null,
      status: INSTAGRAM_ACCOUNT_STATUS_MESSAGING_READY,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", account.id);

  await enrichAccountUsernameFromEvent(admin, account, event);

  if (isInbound) {
    try {
      await scheduleAutomationForInboundMessage(admin, {
        ownerId: account.owner_id,
        accountId: account.id,
        conversationId,
        createdAt,
        isInbound,
        inboundText: event.message.text ?? null,
      });
    } catch (error) {
      console.warn("[instagram-webhook] automation scheduling skipped", {
        accountId: account.id,
        conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    status: "persisted",
    conversationId,
    contactIgsid,
    isInbound,
    messageType,
    createdAt,
  };
}

function normalizeEntryMessagingEvents(entry: NonNullable<WebhookPayload["entry"]>[number]) {
  const directEvents = Array.isArray(entry.messaging) ? entry.messaging : [];
  const changeEvents = Array.isArray(entry.changes)
    ? entry.changes
        .filter((change) => change?.field === "messages" && change.value)
        .map((change) => change.value as MessagingEvent)
    : [];

  return [...directEvents, ...changeEvents];
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const requestUrl = new URL(request.url);
  const verificationFailedResponse = new Response("Webhook verification failed.", {
    status: 403,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });

  logWebhook("info", "verification request received", {
    method: request.method,
    path: requestUrl.pathname,
    mode,
    hasVerifyToken: Boolean(token),
    hasChallenge: Boolean(challenge),
  });

  try {
    const { webhookVerifyToken } = getMetaServerEnv();
    const verified =
      mode === "subscribe" && token === webhookVerifyToken && Boolean(challenge);

    logWebhook(verified ? "info" : "warn", "verification result", {
      mode,
      verified,
      hasVerifyToken: Boolean(token),
      hasChallenge: Boolean(challenge),
    });

    if (verified && challenge) {
      return new Response(challenge, {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }
  } catch (error) {
    logWebhook("error", "verification failed", {
      mode,
      error: error instanceof Error ? error.message : String(error),
    });
    return verificationFailedResponse;
  }

  return verificationFailedResponse;
}

export async function POST(request: Request) {
  const signatureHeader = request.headers.get("x-hub-signature-256");
  const contentType = request.headers.get("content-type");
  const requestUrl = new URL(request.url);

  logWebhook("info", "request received", {
    method: request.method,
    path: requestUrl.pathname,
    contentType,
    hasSignatureHeader: Boolean(signatureHeader),
  });

  const rawBody = await request.text();
  const signatureValid = validateWebhookSignature(
    rawBody,
    signatureHeader,
  );

  logWebhook("info", "signature validation", {
    rawBodyLength: rawBody.length,
    hasSignatureHeader: Boolean(signatureHeader),
    signatureValid,
  });

  if (!signatureValid) {
    logWebhook("warn", "request rejected", {
      reason: "invalid_signature",
      hasSignatureHeader: Boolean(signatureHeader),
    });
    return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  const body = (() => {
    try {
      return JSON.parse(rawBody) as WebhookPayload | null;
    } catch {
      return null;
    }
  })();

  if (!body) {
    logWebhook("warn", "request rejected", {
      reason: "invalid_payload_json",
    });
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const entries = Array.isArray(body.entry) ? body.entry : [];
  const bodyObject = typeof body.object === "string" ? body.object : null;

  logWebhook("info", "payload received", {
    bodyObject,
    entryCount: entries.length,
  });

  const normalizedBodyObject = bodyObject?.toLowerCase() ?? null;
  const isSupportedWebhookObject =
    normalizedBodyObject === "instagram" || normalizedBodyObject === "page";

  if (!isSupportedWebhookObject) {
    logWebhook("warn", "request rejected", {
      reason: "unsupported_object",
      bodyObject: normalizedBodyObject,
      entryCount: entries.length,
    });
    return NextResponse.json({ error: "Unsupported webhook object." }, { status: 400 });
  }

  const admin = createAdminClient();

  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex];
    const messagingEvents = normalizeEntryMessagingEvents(entry);

    logWebhook("info", "entry received", {
      bodyObject,
      entryIndex,
      entryId: normalizeInstagramIdentifier(entry.id ?? null),
      eventCount: messagingEvents.length,
    });

    for (let eventIndex = 0; eventIndex < messagingEvents.length; eventIndex += 1) {
      const event = messagingEvents[eventIndex];
      const entryId = normalizeInstagramIdentifier(entry.id ?? null);
      const senderId = normalizeInstagramIdentifier(event.sender?.id ?? null);
      const recipientId = normalizeInstagramIdentifier(event.recipient?.id ?? null);
      const messageId = normalizeInstagramIdentifier(event.message?.mid ?? null);

      logWebhook("info", "event received", {
        bodyObject,
        entryIndex,
        eventIndex,
        entryId,
        senderId,
        recipientId,
        messageId,
      });

      try {
        if (!event.message) {
          logWebhook("info", "message skipped", {
            reason: "missing_message",
            bodyObject,
            entryIndex,
            eventIndex,
            entryId,
            senderId,
            recipientId,
            messageId,
          });
          await persistWebhookDebugEvent(admin, {
            reason: "missing_message",
            bodyObject,
            entryId,
            senderId,
            recipientId,
            messageId,
            payload: {
              object: bodyObject,
              entry: { id: entryId, entryIndex },
              event,
            },
          });
          continue;
        }

        const classification = classifyMessagingEvent(entryId, event);

        if ("status" in classification) {
          logWebhook("warn", "message skipped", {
            reason: classification.reason,
            bodyObject,
            entryIndex,
            eventIndex,
            entryId,
            senderId,
            recipientId,
            messageId,
          });
          await persistWebhookDebugEvent(admin, {
            reason: classification.reason,
            bodyObject,
            entryId,
            senderId,
            recipientId,
            messageId,
            payload: {
              object: bodyObject,
              entry: { id: entryId, entryIndex },
              event,
            },
          });
          continue;
        }

        let match = await findAccountForEvent(
          admin,
          {
            candidateIds: classification.ownedCandidateIds,
            candidateUsername: classification.ownedUsername,
          },
        );

        if (!match) {
          match = await findBootstrapAccountForEvent(admin, {
            senderId,
            recipientId,
          });
        }

        if (!match) {
          match = await findAccountByRemoteIdentityForEvent(admin, {
            candidateIds: classification.ownedCandidateIds,
          });
        }

        if (!match) {
          logWebhook("warn", "account match failed", {
            bodyObject,
            entryIndex,
            eventIndex,
            entryId,
            senderId,
            recipientId,
            messageId,
            matchedAccountId: null,
          });
          await persistWebhookDebugEvent(admin, {
            reason: "account_match_failed",
            bodyObject,
            entryId,
            senderId,
            recipientId,
            messageId,
            payload: {
              object: bodyObject,
              entry: {
                id: entryId,
              },
              event,
            },
          });
          continue;
        }

        logWebhook("info", "account matched", {
          bodyObject,
          entryIndex,
          eventIndex,
          entryId,
          senderId,
          recipientId,
          messageId,
          matchedAccountId: match.account.id,
          matchedBy: match.matchedBy,
          matchedValue: match.matchedValue,
        });

        const persistence = await persistMessagingEvent(admin, match.account, classification, event);

        if (persistence.status === "skipped") {
          logWebhook("warn", "message skipped", {
            reason: persistence.reason,
            bodyObject,
            entryIndex,
            eventIndex,
            entryId,
            senderId,
            recipientId,
            messageId,
            matchedAccountId: match.account.id,
          });
          await persistWebhookDebugEvent(admin, {
            reason: persistence.reason,
            bodyObject,
            entryId,
            senderId,
            recipientId,
            messageId,
            matchedAccountId: match.account.id,
            payload: {
              object: bodyObject,
              entry: { id: entryId, entryIndex },
              event,
            },
          });
          continue;
        }

        logWebhook("info", "message persisted", {
          bodyObject,
          entryIndex,
          eventIndex,
          entryId,
          senderId,
          recipientId,
          messageId,
          matchedAccountId: match.account.id,
          conversationId: persistence.conversationId,
          contactIgsid: persistence.contactIgsid,
          direction: persistence.isInbound ? "in" : "out",
          messageType: persistence.messageType,
          createdAt: persistence.createdAt,
        });
      } catch (error) {
        logWebhook("error", "event failed", {
          bodyObject,
          entryIndex,
          eventIndex,
          entryId,
          senderId,
          recipientId,
          messageId,
          error: error instanceof Error ? error.message : error,
        });
        await persistWebhookDebugEvent(admin, {
          reason: "event_failed",
          bodyObject,
          entryId,
          senderId,
          recipientId,
          messageId,
          payload: {
            object: bodyObject,
            entry: { id: entryId, entryIndex },
            event,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }
  }

  return NextResponse.json({ received: true });
}
