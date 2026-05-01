import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type MessageLookup = {
  id: string;
  owner_id: string;
  conversation_id: string;
};

type LastMessageLookup = {
  text_content: string | null;
  message_type: string | null;
  sent_at: string | null;
  created_at: string | null;
};

function getMessagePreview(message: LastMessageLookup) {
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

export async function DELETE(
  _request: Request,
  { params }: { params: { messageId: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const lookup = await supabase
    .from("instagram_messages")
    .select("id, owner_id, conversation_id")
    .eq("id", params.messageId)
    .maybeSingle();

  if (lookup.error) {
    return NextResponse.json({ error: lookup.error.message }, { status: 500 });
  }

  const message = lookup.data as MessageLookup | null;

  if (!message || message.owner_id !== user.id) {
    return NextResponse.json({ error: "Mensaje no encontrado." }, { status: 404 });
  }

  const deletion = await supabase
    .from("instagram_messages")
    .delete()
    .eq("id", message.id)
    .eq("owner_id", user.id);

  if (deletion.error) {
    return NextResponse.json({ error: deletion.error.message }, { status: 500 });
  }

  const lastMessageResult = await supabase
    .from("instagram_messages")
    .select("text_content, message_type, sent_at, created_at")
    .eq("owner_id", user.id)
    .eq("conversation_id", message.conversation_id)
    .order("sent_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (lastMessageResult.error) {
    return NextResponse.json({ error: lastMessageResult.error.message }, { status: 500 });
  }

  const lastMessage = lastMessageResult.data as LastMessageLookup | null;
  const updatedAt = new Date().toISOString();
  const conversationPatch = lastMessage
    ? {
        last_message_text: getMessagePreview(lastMessage),
        last_message_type: lastMessage.message_type,
        last_message_at: lastMessage.sent_at ?? lastMessage.created_at,
        updated_at: updatedAt,
      }
    : {
        last_message_text: null,
        last_message_type: null,
        last_message_at: null,
        updated_at: updatedAt,
      };

  const conversationUpdate = await supabase
    .from("instagram_conversations")
    .update(conversationPatch as never)
    .eq("id", message.conversation_id)
    .eq("owner_id", user.id);

  if (conversationUpdate.error) {
    return NextResponse.json({ error: conversationUpdate.error.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    conversation: {
      id: message.conversation_id,
      ...conversationPatch,
    },
  });
}
