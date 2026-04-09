import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const allowedTypes = new Set(["send_message", "sync_inbox", "login_account"]);

type AccountLookupClient = {
  select: (
    columns: string,
  ) => {
    eq: (column: string, value: string | number) => unknown;
  };
};

type AgentJobsInsertClient = {
  insert: (
    values: Record<string, unknown>,
  ) => Promise<{ error: { message: string } | null }>;
};

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  let body: {
    type?: string;
    accountId?: number;
    threadId?: string;
    message?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  const type = String(body.type || "").trim();
  const accountId = Number(body.accountId);

  if (!allowedTypes.has(type) || Number.isNaN(accountId)) {
    return NextResponse.json({ error: "Job invalido." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const accountsClient = admin.from("accounts") as unknown as AccountLookupClient;
    const accountQuery = accountsClient.select("id, agent_id") as {
      eq: (column: string, value: string | number) => {
        eq: (nestedColumn: string, nestedValue: string | number) => {
          maybeSingle: () => Promise<{
            data: { id: number; agent_id: string | null } | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
    const { data: account, error: accountError } = await accountQuery
      .eq("id", accountId)
      .eq("owner_id", user.id)
      .maybeSingle();

    if (accountError || !account) {
      throw new Error(accountError?.message ?? "Cuenta no encontrada.");
    }

    if (!account.agent_id) {
      throw new Error("La cuenta no tiene un agente asignado.");
    }

    const payload: Record<string, unknown> = {
      account_id: account.id,
    };

    if (type === "send_message") {
      const threadId = String(body.threadId || "").trim();
      const message = String(body.message || "").trim();

      if (!threadId || !message) {
        return NextResponse.json(
          { error: "Faltan threadId o message." },
          { status: 400 },
        );
      }

      payload.thread_id = threadId;
      payload.message = message;
    }

    const jobsClient = admin.from("agent_jobs") as unknown as AgentJobsInsertClient;
    const { error } = await jobsClient.insert({
      owner_id: user.id,
      agent_id: account.agent_id,
      type,
      status: "pending",
      payload,
    });

    if (error) {
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "No se pudo crear el job.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
