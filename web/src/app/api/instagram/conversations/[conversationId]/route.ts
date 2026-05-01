import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type UpdateConversationBody = {
  labels?: string[];
  notes?: string;
};

type ConversationLookup = {
  id: string;
  owner_id: string;
};

export async function PATCH(
  request: Request,
  { params }: { params: { conversationId: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | UpdateConversationBody
    | null;
  const labels = Array.isArray(body?.labels)
    ? Array.from(
        new Set(
          body.labels
            .map((label) => label.trim())
            .filter(Boolean),
        ),
      )
    : [];
  const notes = body?.notes?.trim() ?? "";

  const result = await supabase
    .from("instagram_conversations")
    .update({
      labels,
      notes,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", params.conversationId)
    .eq("owner_id", user.id);

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: Request,
  { params }: { params: { conversationId: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const lookup = await supabase
    .from("instagram_conversations")
    .select("id, owner_id")
    .eq("id", params.conversationId)
    .maybeSingle();

  if (lookup.error) {
    return NextResponse.json({ error: lookup.error.message }, { status: 500 });
  }

  const conversation = lookup.data as ConversationLookup | null;

  if (!conversation || conversation.owner_id !== user.id) {
    return NextResponse.json({ error: "Conversacion no encontrada." }, { status: 404 });
  }

  const deletion = await supabase
    .from("instagram_conversations")
    .delete()
    .eq("id", conversation.id)
    .eq("owner_id", user.id);

  if (deletion.error) {
    return NextResponse.json({ error: deletion.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
