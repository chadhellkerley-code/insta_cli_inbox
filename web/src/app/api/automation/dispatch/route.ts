import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { processDueAutomationJobs } from "@/lib/automation/runtime";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type DispatchClient = Pick<SupabaseClient, "from">;

async function resolveDispatchClient(
  request: Request,
): Promise<
  | { mode: "cron"; client: DispatchClient }
  | { mode: "user"; client: DispatchClient }
  | { mode: "unauthorized" }
> {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET ?? process.env.AUTOMATION_DISPATCH_SECRET;

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return {
      mode: "cron",
      client: createAdminClient(),
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { mode: "unauthorized" };
  }

  return {
    mode: "user",
    client: supabase,
  };
}

async function handleDispatch(request: Request) {
  try {
    const dispatchClient = await resolveDispatchClient(request);

    if (dispatchClient.mode === "unauthorized") {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const summary = await processDueAutomationJobs(dispatchClient.client, { limit: 25 });

    return NextResponse.json({
      ok: true,
      summary,
      mode: dispatchClient.mode,
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
