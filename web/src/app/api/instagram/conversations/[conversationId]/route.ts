import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type UpdateConversationBody = {
  labels?: string[];
  notes?: string;
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ conversationId: string }> },
) {
  const { conversationId } = await params;
  const supabase = await createClient();
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
    .eq("id", conversationId)
    .eq("owner_id", user.id);

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
