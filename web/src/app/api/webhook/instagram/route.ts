import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { getMetaServerEnv } from "@/lib/meta/config";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type MessagingEvent = {
  sender?: { id?: string; username?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
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
  instagram_account_id: string;
  instagram_app_user_id: string | null;
};

type ConversationLookup = {
  id: string;
  contact_username: string | null;
  unread_count: number | null;
};

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

async function findAccountForEntry(
  admin: ReturnType<typeof createAdminClient>,
  entryId: string | null,
  recipientId: string | null,
) {
  const candidateIds = [entryId, recipientId].filter(Boolean) as string[];

  for (const candidateId of candidateIds) {
    for (const column of ["instagram_account_id", "instagram_app_user_id"] as const) {
      const result = await admin
        .from("instagram_accounts")
        .select("id, owner_id, instagram_account_id, instagram_app_user_id")
        .eq(column, candidateId)
        .maybeSingle();
      const account = result.data as AccountLookup | null;

      if (!result.error && account) {
        return account;
      }
    }
  }

  return null;
}

async function upsertConversationForMessage(
  admin: ReturnType<typeof createAdminClient>,
  options: {
    accountId: string;
    ownerId: string;
    contactIgsid: string;
    contactUsername: string | null;
    preview: string;
    messageType: string;
    createdAt: string;
    isInbound: boolean;
  },
) {
  const existingResult = await admin
    .from("instagram_conversations")
    .select("id, contact_username, unread_count")
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
        last_message_text: options.preview,
        last_message_type: options.messageType,
        last_message_at: options.createdAt,
        unread_count: (existing.unread_count ?? 0) + (options.isInbound ? 1 : 0),
        updated_at: options.createdAt,
      } as never)
      .eq("id", existing.id)
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

async function persistMessagingEvent(
  admin: ReturnType<typeof createAdminClient>,
  account: AccountLookup,
  event: MessagingEvent,
) {
  if (!event.message?.mid) {
    return;
  }

  const senderId = event.sender?.id ?? null;
  const recipientId = event.recipient?.id ?? account.instagram_account_id;
  const isInbound = senderId !== account.instagram_account_id;
  const contactIgsid = isInbound ? senderId : recipientId;

  if (!contactIgsid) {
    return;
  }

  const attachment = event.message.attachments?.[0];
  const messageType = event.message.text?.trim()
    ? "text"
    : mapAttachmentType(attachment?.type);
  const createdAt = event.timestamp
    ? new Date(event.timestamp).toISOString()
    : new Date().toISOString();
  const preview = getMessagePreview(event.message.text ?? null, messageType);
  const conversationId = await upsertConversationForMessage(admin, {
    accountId: account.id,
    ownerId: account.owner_id,
    contactIgsid,
    contactUsername: event.sender?.username ?? null,
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
      meta_message_id: event.message.mid,
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
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", account.id);
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
  const { webhookVerifyToken } = getMetaServerEnv();

  if (mode === "subscribe" && token === webhookVerifyToken && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return NextResponse.json({ error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (!validateWebhookSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
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
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (typeof body.object !== "string" || body.object.toLowerCase() !== "instagram") {
    return NextResponse.json({ error: "Unsupported webhook object." }, { status: 400 });
  }

  const admin = createAdminClient();
  const entries = Array.isArray(body.entry) ? body.entry : [];

  for (const entry of entries) {
    const messagingEvents = normalizeEntryMessagingEvents(entry);

    for (const event of messagingEvents) {
      try {
        const account = await findAccountForEntry(
          admin,
          entry.id ?? null,
          event.recipient?.id ?? null,
        );

        if (!event.message) {
          console.info("[instagram-webhook] skipping non-message event", {
            entryId: entry.id ?? null,
            recipientId: event.recipient?.id ?? null,
            senderId: event.sender?.id ?? null,
          });
          continue;
        }

        if (!account) {
          console.warn("[instagram-webhook] account match failed", {
            entryId: entry.id ?? null,
            recipientId: event.recipient?.id ?? null,
            senderId: event.sender?.id ?? null,
            messageId: event.message.mid ?? null,
          });
          continue;
        }

        await persistMessagingEvent(admin, account, event);
      } catch (error) {
        console.error(
          "Instagram webhook event failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }
  }

  return NextResponse.json({ received: true });
}
