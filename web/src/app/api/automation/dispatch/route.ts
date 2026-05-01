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
  | { mode: "user"; client: DispatchClient; userId: string }
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

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { mode: "unauthorized" };
  }

  return {
    mode: "user",
    client: supabase,
    userId: user.id,
  };
}

async function loadRecentAutomationErrors(
  client: DispatchClient,
  ownerId: string,
  sinceIso: string,
) {
  const result = await client
    .from("automation_jobs")
    .select("status, job_type, attempt_count, last_error, payload, updated_at")
    .eq("owner_id", ownerId)
    .in("status", ["pending", "failed"])
    .not("last_error", "is", null)
    .gte("updated_at", sinceIso)
    .order("updated_at", { ascending: false })
    .limit(5);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return ((result.data ?? []) as Array<{
    status: string;
    job_type: string;
    attempt_count: number;
    last_error: string | null;
    payload: Record<string, unknown> | null;
  }>).map((job) => ({
    status: job.status,
    jobType: job.job_type,
    attemptCount: job.attempt_count,
    lastError: job.last_error ?? "",
    messageType:
      typeof job.payload?.messageType === "string" ? job.payload.messageType : null,
    stageName:
      typeof job.payload?.stageName === "string" ? job.payload.stageName : null,
  }));
}

async function handleDispatch(request: Request) {
  try {
    const dispatchClient = await resolveDispatchClient(request);

    if (dispatchClient.mode === "unauthorized") {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const startedAt = new Date().toISOString();
    const summary = await processDueAutomationJobs(dispatchClient.client, { limit: 25 });
    let recentErrors: Awaited<ReturnType<typeof loadRecentAutomationErrors>> = [];

    if (dispatchClient.mode === "user") {
      try {
        recentErrors = await loadRecentAutomationErrors(
          dispatchClient.client,
          dispatchClient.userId,
          startedAt,
        );
      } catch {
        recentErrors = [];
      }
    }

    return NextResponse.json({
      ok: true,
      summary,
      recentErrors,
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
