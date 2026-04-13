import { NextResponse } from "next/server";

import { sendInstagramMessage } from "@/lib/meta/client";
import { ensureInstagramAccessToken } from "@/lib/meta/token-lifecycle";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type SendMessageBody = {
  conversationId?: string;
  text?: string;
  messageType?: "text" | "audio";
  mediaUrl?: string;
};

type ConversationLookup = {
  id: string;
  owner_id: string;
  account_id: string;
  contact_igsid: string;
};

type AccountLookup = {
  id: string;
  instagram_account_id: string;
  access_token: string;
  token_expires_at: string | null;
};

function logInstagramMessage(
  level: "info" | "warn" | "error",
  message: string,
  payload: Record<string, unknown>,
) {
  console[level](`[instagram-messages] ${message}`, payload);
}

export async function POST(request: Request) {
  const supabase = createClient();
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

    if (conversation.owner_id !== user.id) {
      logInstagramMessage("warn", "request rejected", {
        reason: "conversation_owner_mismatch",
        userId: user.id,
        conversationId: conversation.id,
        ownerId: conversation.owner_id,
      });
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const accountResult = await admin
      .from("instagram_accounts")
      .select("id, instagram_account_id, access_token, token_expires_at")
      .eq("id", conversation.account_id)
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
    });

    const metaResponse = await sendInstagramMessage({
      accessToken: managedToken.accessToken,
      instagramAccountId: account.instagram_account_id,
      recipientId: conversation.contact_igsid,
      text,
      messageType: messageType === "audio" ? "audio" : undefined,
      mediaUrl,
    });

    logInstagramMessage("info", "meta message sent", {
      userId: user.id,
      conversationId: conversation.id,
      accountId: account.id,
      metaMessageId: metaResponse.message_id ?? null,
      messageType,
    });

    const createdAt = nowIso;
    const preview = text || (messageType === "audio" ? "Mensaje de audio" : "Mensaje");

    const messageInsert = await admin.from("instagram_messages").insert({
      owner_id: user.id,
      account_id: account.id,
      conversation_id: conversation.id,
      meta_message_id: metaResponse.message_id ?? crypto.randomUUID(),
      direction: "out",
      message_type: messageType,
      text_content: text ?? null,
      media_url: mediaUrl ?? null,
      sender_igsid: account.instagram_account_id,
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
        last_message_text: preview,
        last_message_type: messageType,
        last_message_at: createdAt,
        unread_count: 0,
        updated_at: createdAt,
      } as never)
      .eq("id", conversation.id);

    if (conversationUpdate.error) {
      throw new Error(conversationUpdate.error.message);
    }

    logInstagramMessage("info", "message persisted", {
      userId: user.id,
      conversationId: conversation.id,
      accountId: account.id,
      messageType,
      createdAt,
    });

    return NextResponse.json({ ok: true });
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
