import { NextResponse } from "next/server";

import { loadAiCredential, saveAiCredential } from "@/lib/automation/ai-credentials";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const credential = await loadAiCredential(user.id);

    return NextResponse.json({
      provider: credential?.provider ?? null,
      model: credential?.model ?? null,
      hasApiKey: Boolean(credential),
      apiKeyLast4: credential?.api_key_last4 ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No pudimos cargar la credencial." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        provider?: unknown;
        model?: unknown;
        apiKey?: unknown;
      }
    | null;

  if (!body) {
    return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
  }

  try {
    const credential = await saveAiCredential(
      user.id,
      String(body.provider ?? ""),
      String(body.model ?? ""),
      String(body.apiKey ?? ""),
    );

    return NextResponse.json({
      provider: credential.provider,
      model: credential.model,
      hasApiKey: true,
      apiKeyLast4: credential.api_key_last4,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No pudimos guardar la credencial." },
      { status: 400 },
    );
  }
}
