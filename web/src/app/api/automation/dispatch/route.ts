import { NextResponse } from "next/server";

import { processDueAutomationJobs } from "@/lib/automation/runtime";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

async function isAuthorized(request: Request) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET ?? process.env.AUTOMATION_DISPATCH_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return Boolean(user);
}

async function handleDispatch(request: Request) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const summary = await processDueAutomationJobs(admin, { limit: 25 });

    return NextResponse.json({
      ok: true,
      summary,
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No pudimos ejecutar el dispatcher." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return handleDispatch(request);
}

export async function POST(request: Request) {
  return handleDispatch(request);
}
