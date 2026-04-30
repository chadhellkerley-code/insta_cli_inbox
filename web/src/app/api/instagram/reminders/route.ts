import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type CreateReminderBody = {
  conversationId?: string;
  title?: string;
  note?: string;
  remindAt?: string;
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as CreateReminderBody | null;
  const conversationId = body?.conversationId?.trim();
  const title = body?.title?.trim();
  const note = body?.note?.trim() ?? "";
  const remindAt = body?.remindAt?.trim();

  if (!conversationId || !title || !remindAt) {
    return NextResponse.json(
      { error: "Completá título y fecha del recordatorio." },
      { status: 400 },
    );
  }

  const conversation = await supabase
    .from("instagram_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (conversation.error || !conversation.data) {
    return NextResponse.json(
      { error: conversation.error?.message ?? "Conversación no encontrada." },
      { status: 404 },
    );
  }

  const insert = await supabase.from("instagram_reminders").insert({
    owner_id: user.id,
    conversation_id: conversationId,
    title,
    note: note || null,
    remind_at: new Date(remindAt).toISOString(),
    status: "pending",
  } as never);

  if (insert.error) {
    return NextResponse.json({ error: insert.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
