import { NextResponse } from "next/server";

import { cleanupMisroutedInstagramInboxData } from "@/lib/meta/inbox-cleanup";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const stats = await cleanupMisroutedInstagramInboxData({
      userId: user.id,
    });

    return NextResponse.json({
      ok: true,
      stats,
      message:
        stats.conversationsReassigned > 0 || stats.conversationsMerged > 0
          ? "Limpieza completada. Los chats mal asignados se movieron al inbox correcto."
          : "Limpieza completada. No encontramos chats mal asignados para este usuario.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No pudimos limpiar el inbox contaminado.",
      },
      { status: 500 },
    );
  }
}
