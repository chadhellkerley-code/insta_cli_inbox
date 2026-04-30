import { NextResponse } from "next/server";

import type { AutomationAgentInput } from "@/lib/automation/types";
import {
  deleteAutomationAgent,
  loadAutomationAgents,
  saveAutomationAgent,
} from "@/lib/automation/server";
import { createClient } from "@/lib/supabase/server";

type Params = {
  params: Promise<{
    agentId: string;
  }>;
};

export async function GET(_request: Request, { params }: Params) {
  const { agentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const agents = await loadAutomationAgents(supabase, user.id);
  const agent = agents.find((item) => item.id === agentId) ?? null;

  if (!agent) {
    return NextResponse.json({ error: "Agente no encontrado." }, { status: 404 });
  }

  return NextResponse.json({ agent });
}

export async function PUT(request: Request, { params }: Params) {
  const { agentId } = await params;
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
    const agent = await saveAutomationAgent(supabase, user.id, {
      ...body,
      id: agentId,
    });

    return NextResponse.json({ agent });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No pudimos actualizar el agente." },
      { status: 400 },
    );
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { agentId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    await deleteAutomationAgent(supabase, user.id, agentId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No pudimos eliminar el agente." },
      { status: 400 },
    );
  }
}
