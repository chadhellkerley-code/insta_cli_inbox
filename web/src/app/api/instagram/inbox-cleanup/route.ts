import { NextResponse } from "next/server";

import {
  getInstagramInboxCleanupStatus,
  runInstagramInboxCleanup,
} from "@/lib/meta/inbox-cleanup";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const [status, preview] = await Promise.all([
      getInstagramInboxCleanupStatus(user.id),
      runInstagramInboxCleanup({
        userId: user.id,
        mode: "preview",
      }),
    ]);

    return NextResponse.json({
      ok: true,
      status,
      preview,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No pudimos diagnosticar el inbox de Instagram.",
      },
      { status: 500 },
    );
  }
}

export async function POST() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const report = await runInstagramInboxCleanup({
      userId: user.id,
      mode: "apply",
    });
    const status = await getInstagramInboxCleanupStatus(user.id);

    return NextResponse.json({
      ok: true,
      status,
      report,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "No pudimos aplicar la limpieza del inbox de Instagram.";
    const statusCode = message.includes("en progreso") ? 409 : 500;

    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
