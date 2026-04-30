import { NextResponse } from "next/server";

import type { AutomationAgentInput } from "@/lib/automation/types";
import { loadAutomationAgents, saveAutomationAgent } from "@/lib/automation/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const agents = await loadAutomationAgents(supabase, user.id);
  return NextResponse.json({ agents });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as AutomationAgentInput | null;

  if (!body) {
    return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
  }

  try {
    const agent = await saveAutomationAgent(supabase, user.id, body);

    return NextResponse.json({ agent });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No pudimos guardar el agente." },
      { status: 400 },
    );
  }
}
