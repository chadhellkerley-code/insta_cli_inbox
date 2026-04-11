import { NextResponse } from "next/server";

import {
  exchangeForLongLivedToken,
  refreshLongLivedInstagramToken,
  sendInstagramMessage,
} from "@/lib/meta/client";
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

const SHORT_LIVED_THRESHOLD_MS = 2 * 60 * 60 * 1000;
const LONG_LIVED_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

function getTokenTimeRemaining(expiresAt: string | null | undefined) {
  if (!expiresAt) {
    return null;
  }

  const expiresAtMs = new Date(expiresAt).getTime();

  if (Number.isNaN(expiresAtMs)) {
    return null;
  }

  return expiresAtMs - Date.now();
}

async function ensureUsableInstagramAccessToken(
  admin: ReturnType<typeof createAdminClient>,
  account: AccountLookup,
) {
  const timeRemainingMs = getTokenTimeRemaining(account.token_expires_at);

  if (timeRemainingMs === null || timeRemainingMs > LONG_LIVED_REFRESH_THRESHOLD_MS) {
    return account.access_token;
  }

  const shouldExchangeShortLivedToken = timeRemainingMs <= SHORT_LIVED_THRESHOLD_MS;

  try {
    const refreshedToken = shouldExchangeShortLivedToken
      ? await exchangeForLongLivedToken(account.access_token)
      : await refreshLongLivedInstagramToken(account.access_token);

    const nextExpiresAt = new Date(
      Date.now() + (refreshedToken.expires_in ?? 60 * 24 * 60 * 60) * 1000,
    ).toISOString();

    const updateResult = await admin
      .from("instagram_accounts")
      .update({
        access_token: refreshedToken.access_token,
        token_expires_at: nextExpiresAt,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", account.id);

    if (updateResult.error) {
      throw new Error(updateResult.error.message);
    }

    return refreshedToken.access_token;
  } catch (error) {
    if (timeRemainingMs > 0) {
      return account.access_token;
    }

    throw error;
  }
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as SendMessageBody | null;
  const conversationId = body?.conversationId?.trim();
  const messageType = body?.messageType ?? "text";
  const text = body?.text?.trim();
  const mediaUrl = body?.mediaUrl?.trim();

  if (!conversationId) {
    return NextResponse.json(
      { error: "Falta la conversacion a responder." },
      { status: 400 },
    );
  }

  if (messageType === "text" && !text) {
    return NextResponse.json(
      { error: "Escribe un mensaje antes de enviar." },
      { status: 400 },
    );
  }

  if (messageType === "audio" && !mediaUrl) {
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

    if (conversation.owner_id !== user.id) {
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

    const accessToken = await ensureUsableInstagramAccessToken(admin, account);

    const metaResponse = await sendInstagramMessage({
      accessToken,
      instagramAccountId: account.instagram_account_id,
      recipientId: conversation.contact_igsid,
      text,
      messageType: messageType === "audio" ? "audio" : undefined,
      mediaUrl,
    });
    const createdAt = new Date().toISOString();
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

    return NextResponse.json({ ok: true });
  } catch (error) {
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
