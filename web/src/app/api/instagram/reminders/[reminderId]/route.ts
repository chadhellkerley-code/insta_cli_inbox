import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

type UpdateReminderBody = {
  status?: "pending" | "dismissed";
};

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ reminderId: string }> },
) {
  const { reminderId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as UpdateReminderBody | null;
  const status = body?.status === "dismissed" ? "dismissed" : "pending";

  const result = await supabase
    .from("instagram_reminders")
    .update({
      status,
      dismissed_at: status === "dismissed" ? new Date().toISOString() : null,
    } as never)
    .eq("id", reminderId)
    .eq("owner_id", user.id);

  if (result.error) {
    return NextResponse.json({ error: result.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
