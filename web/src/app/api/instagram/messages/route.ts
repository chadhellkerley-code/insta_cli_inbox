import { NextResponse } from "next/server";

import { persistInstagramAccountIdentifiers } from "@/lib/meta/account-identifiers";
import {
  fetchInstagramLoginAccountIdentity,
  sendInstagramMessage,
} from "@/lib/meta/client";
import { assertInstagramAudioUrlAccessible } from "@/lib/meta/audio-url";
import {
  INSTAGRAM_ACCOUNT_STATUS_MESSAGING_READY,
  INSTAGRAM_MESSAGING_STATUS_READY,
} from "@/lib/meta/account-status";
import { resolveInstagramContactProfile } from "@/lib/meta/profile-enrichment";
import { ensureInstagramAccessToken } from "@/lib/meta/token-lifecycle";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SendMessageBody = {
  conversationId?: string;
  text?: string;
  messageType?: "text" | "audio";
  mediaUrl?: string;
};

type LastInboundMessageLookup = {
  sent_at: string | null;
  created_at: string | null;
};

type ConversationLookup = {
  id: string;
  owner_id: string;
  account_id: string;
  contact_igsid: string;
};

type AccountLookup = {
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
  last_oauth_at: string | null;
};

const STANDARD_MESSAGING_WINDOW_MS = 24 * 60 * 60 * 1000;
const HUMAN_AGENT_MESSAGING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function normalizeOptionalString(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

function toTimestampMs(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function logInstagramMessage(
  level: "info" | "warn" | "error",
  message: string,
  payload: Record<string, unknown>,
) {
  const formattedMessage = `[instagram-messages] ${message}`;

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

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  logInstagramMessage("info", "request received", {
    method: request.method,
    path: new URL(request.url).pathname,
    authenticated: Boolean(user),
  });

  if (!user) {
    logInstagramMessage("warn", "request rejected", {
      reason: "unauthorized",
    });
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as SendMessageBody | null;
  const conversationId = body?.conversationId?.trim();
  const messageType = body?.messageType ?? "text";
  const text = body?.text?.trim();
  const mediaUrl = body?.mediaUrl?.trim();

  logInstagramMessage("info", "payload parsed", {
    userId: user.id,
    conversationId,
    messageType,
    hasText: Boolean(text),
    hasMediaUrl: Boolean(mediaUrl),
  });

  if (!conversationId) {
    logInstagramMessage("warn", "request rejected", {
      reason: "missing_conversation_id",
      userId: user.id,
    });
    return NextResponse.json(
      { error: "Falta la conversacion a responder." },
      { status: 400 },
    );
  }

  if (messageType === "text" && !text) {
    logInstagramMessage("warn", "request rejected", {
      reason: "missing_text",
      userId: user.id,
      conversationId,
    });
    return NextResponse.json(
      { error: "Escribe un mensaje antes de enviar." },
      { status: 400 },
    );
  }

  if (messageType === "audio" && !mediaUrl) {
    logInstagramMessage("warn", "request rejected", {
      reason: "missing_media_url",
      userId: user.id,
      conversationId,
    });
    return NextResponse.json(
      { error: "No encontramos el audio para enviar." },
      { status: 400 },
    );
  }

  try {
    const admin = createAdminClient();
    const conversationResult = await admin
      .from("instagram_conversations")
      .select("id, owner_id, account_id, contact_igsid")
      .eq("id", conversationId)
      .eq("owner_id", user.id)
      .maybeSingle();
    const conversation = conversationResult.data as ConversationLookup | null;

    if (conversationResult.error || !conversation) {
      throw new Error(conversationResult.error?.message ?? "Conversacion no encontrada.");
    }

    logInstagramMessage("info", "conversation loaded", {
      userId: user.id,
      conversationId: conversation.id,
      accountId: conversation.account_id,
      contactIgsid: conversation.contact_igsid,
    });

    const accountResult = await admin
      .from("instagram_accounts")
      .select(
        "id, owner_id, instagram_user_id, instagram_account_id, instagram_app_user_id, username, account_type, access_token, token_expires_at, token_lifecycle, last_oauth_at",
      )
      .eq("id", conversation.account_id)
      .eq("owner_id", user.id)
      .maybeSingle();
    const account = accountResult.data as AccountLookup | null;

    if (accountResult.error || !account) {
      throw new Error(accountResult.error?.message ?? "Cuenta no encontrada.");
    }

    logInstagramMessage("info", "account loaded", {
      userId: user.id,
      conversationId: conversation.id,
      accountId: account.id,
      instagramAccountId: account.instagram_account_id,
      hasTokenExpiry: Boolean(account.token_expires_at),
    });

    const nowIso = new Date().toISOString();
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
            token_expires_at: nextToken.expiresAt,
            token_obtained_at: nextToken.obtainedAt,
            token_lifecycle: nextToken.lifecycle,
            last_token_refresh_at: nextToken.obtainedAt,
            updated_at: nextToken.obtainedAt,
          } as never)
          .eq("id", account.id)
          .eq("owner_id", user.id);

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
    }).catch((error) => {
      logInstagramMessage("warn", "account identity fetch skipped", {
        userId: user.id,
        conversationId: conversation.id,
        accountId: account.id,
        error: error instanceof Error ? error.message : String(error),
      });

      return null;
    });
    const resolvedInstagramAccountId =
      remoteIdentity?.instagramAccountId ?? account.instagram_account_id;
    const resolvedInstagramAppUserId =
      remoteIdentity?.appScopedUserId ??
      account.instagram_app_user_id ??
      account.instagram_user_id;
    const resolvedUsername =
      normalizeOptionalString(remoteIdentity?.username) ?? account.username;
    const resolvedAccountType =
      normalizeOptionalString(remoteIdentity?.accountType) ?? account.account_type;

    if (
      resolvedInstagramAccountId !== account.instagram_account_id ||
      resolvedInstagramAppUserId !== account.instagram_app_user_id ||
      resolvedUsername !== account.username ||
      resolvedAccountType !== account.account_type
    ) {
      const accountUpdate = await admin
        .from("instagram_accounts")
        .update({
          instagram_account_id: resolvedInstagramAccountId,
          instagram_app_user_id: resolvedInstagramAppUserId,
          username: resolvedUsername ?? account.username,
          account_type: resolvedAccountType,
          updated_at: nowIso,
        } as never)
        .eq("id", account.id)
        .eq("owner_id", user.id);

      if (accountUpdate.error) {
        throw new Error(accountUpdate.error.message);
      }

      await persistInstagramAccountIdentifiers({
        admin,
        accountId: account.id,
        identifiers: [
          {
            identifier: account.instagram_user_id,
            identifierType: "instagram_user_id",
          },
          {
            identifier: resolvedInstagramAccountId,
            identifierType: "instagram_account_id",
          },
          {
            identifier: resolvedInstagramAppUserId,
            identifierType: "instagram_app_user_id",
          },
        ],
      });

      account.instagram_account_id = resolvedInstagramAccountId;
      account.instagram_app_user_id = resolvedInstagramAppUserId;
      account.username = resolvedUsername;
      account.account_type = resolvedAccountType;

      logInstagramMessage("info", "account identifiers reconciled", {
        userId: user.id,
        conversationId: conversation.id,
        accountId: account.id,
        instagramAccountId: resolvedInstagramAccountId,
        instagramAppUserId: resolvedInstagramAppUserId,
      });
    }

    if (messageType === "audio" && mediaUrl) {
      await assertInstagramAudioUrlAccessible(mediaUrl);
    }

    const lastInboundResult = await admin
      .from("instagram_messages")
      .select("sent_at, created_at")
      .eq("owner_id", user.id)
      .eq("conversation_id", conversation.id)
      .eq("direction", "in")
      .order("sent_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    const lastInbound = lastInboundResult.data as LastInboundMessageLookup | null;

    if (lastInboundResult.error) {
      throw new Error(lastInboundResult.error.message);
    }

    const lastInboundAtMs = toTimestampMs(lastInbound?.sent_at ?? lastInbound?.created_at);

    if (lastInboundAtMs === null) {
      return NextResponse.json(
        {
          error:
            "No encontramos un mensaje entrante del cliente. Instagram requiere que el cliente haya iniciado la conversacion.",
        },
        { status: 400 },
      );
    }

    const elapsedSinceLastInboundMs = Date.now() - lastInboundAtMs;

    if (elapsedSinceLastInboundMs > HUMAN_AGENT_MESSAGING_WINDOW_MS) {
      return NextResponse.json(
        {
          error:
            "Pasaron mas de 7 dias desde el ultimo mensaje del cliente. Necesitas que vuelva a escribir para reabrir la conversacion.",
        },
        { status: 400 },
      );
    }

    const sendTag =
      elapsedSinceLastInboundMs > STANDARD_MESSAGING_WINDOW_MS
        ? "HUMAN_AGENT"
        : undefined;

    const contactProfile = await resolveInstagramContactProfile({
      admin,
      account,
      contactIgsid: conversation.contact_igsid,
    }).catch((error) => {
      logInstagramMessage("warn", "contact profile enrichment skipped", {
        userId: user.id,
        conversationId: conversation.id,
        accountId: account.id,
        contactIgsid: conversation.contact_igsid,
        error: error instanceof Error ? error.message : String(error),
      });

      return null;
    });

    const metaResponse = await sendInstagramMessage({
      accessToken: managedToken.accessToken,
      recipientId: conversation.contact_igsid,
      text,
      messageType: messageType === "audio" ? "audio" : undefined,
      mediaUrl,
      tag: sendTag,
    });

    logInstagramMessage("info", "meta message sent", {
      userId: user.id,
      conversationId: conversation.id,
      accountId: account.id,
      metaMessageId: metaResponse.message_id ?? null,
      messageType,
      tag: sendTag ?? "STANDARD",
    });

    const createdAt = nowIso;
    const scopedMetaMessageId = metaResponse.message_id
      ? `${account.id}:${metaResponse.message_id}`
      : crypto.randomUUID();
    const preview = text || (messageType === "audio" ? "Mensaje de audio" : "Mensaje");

    const messageInsert = await admin.from("instagram_messages").insert({
      owner_id: user.id,
      account_id: account.id,
      conversation_id: conversation.id,
      meta_message_id: scopedMetaMessageId,
      direction: "out",
      message_type: messageType,
      text_content: text ?? null,
      media_url: mediaUrl ?? null,
      sender_igsid: resolvedInstagramAppUserId ?? resolvedInstagramAccountId,
      recipient_igsid: conversation.contact_igsid,
      raw_payload: metaResponse,
      sent_at: createdAt,
      created_at: createdAt,
    } as never);

    if (messageInsert.error) {
      throw new Error(messageInsert.error.message);
    }

    const conversationUpdate = await admin
      .from("instagram_conversations")
      .update({
        ...(contactProfile?.contactUsername
          ? { contact_username: contactProfile.contactUsername }
          : {}),
        ...(contactProfile?.contactName ? { contact_name: contactProfile.contactName } : {}),
        last_message_text: preview,
        last_message_type: messageType,
        last_message_at: createdAt,
        unread_count: 0,
        updated_at: createdAt,
      } as never)
      .eq("id", conversation.id)
      .eq("owner_id", user.id);

    if (conversationUpdate.error) {
      throw new Error(conversationUpdate.error.message);
    }

    const readinessUpdate = await admin
      .from("instagram_accounts")
      .update({
        messaging_status: INSTAGRAM_MESSAGING_STATUS_READY,
        status: INSTAGRAM_ACCOUNT_STATUS_MESSAGING_READY,
        webhook_subscription_error: null,
        updated_at: createdAt,
      } as never)
      .eq("id", account.id)
      .eq("owner_id", user.id);

    if (readinessUpdate.error) {
      throw new Error(readinessUpdate.error.message);
    }

    logInstagramMessage("info", "message persisted", {
      userId: user.id,
      conversationId: conversation.id,
      accountId: account.id,
      messageType,
      createdAt,
    });

    return NextResponse.json({
      ok: true,
      metaMessageId: metaResponse.message_id ?? null,
      sentAt: createdAt,
    });
  } catch (error) {
    logInstagramMessage("error", "request failed", {
      userId: user.id,
      conversationId,
      messageType,
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No pudimos enviar el mensaje.",
      },
      { status: 500 },
    );
  }
}
