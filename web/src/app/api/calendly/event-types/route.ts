import { NextResponse } from "next/server";

import {
  calendlyTokenNeedsRefresh,
  listCalendlyEventTypes,
  refreshCalendlyToken,
} from "@/lib/calendly/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CalendlyConnectionRecord = {
  calendly_user_uri: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
};

type CalendlySettingsRecord = {
  default_event_type_uri: string | null;
  default_event_type_name: string | null;
  enabled: boolean;
};

async function getUser() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}

async function loadFreshConnection(ownerId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calendly_connections")
    .select("calendly_user_uri, access_token, refresh_token, expires_at")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const connection = data as CalendlyConnectionRecord | null;

  if (!connection) {
    return null;
  }

  if (!calendlyTokenNeedsRefresh(connection.expires_at)) {
    return connection;
  }

  const refreshedTokens = await refreshCalendlyToken(connection.refresh_token);
  const { error: refreshError } = await admin
    .from("calendly_connections")
    .update({
      access_token: refreshedTokens.accessToken,
      refresh_token: refreshedTokens.refreshToken,
      expires_at: refreshedTokens.expiresAt,
    } as never)
    .eq("owner_id", ownerId);

  if (refreshError) {
    throw refreshError;
  }

  return {
    ...connection,
    access_token: refreshedTokens.accessToken,
    refresh_token: refreshedTokens.refreshToken,
    expires_at: refreshedTokens.expiresAt,
  };
}

export async function GET() {
  const user = await getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const admin = createAdminClient();
    const connection = await loadFreshConnection(user.id);

    if (!connection) {
      return NextResponse.json(
        { error: "Calendly no esta conectado." },
        { status: 404 },
      );
    }

    const [{ data: settingsData }, eventTypes] = await Promise.all([
      admin
        .from("calendly_settings")
        .select("default_event_type_uri, default_event_type_name, enabled")
        .eq("owner_id", user.id)
        .maybeSingle(),
      listCalendlyEventTypes({
        accessToken: connection.access_token,
        userUri: connection.calendly_user_uri,
      }),
    ]);
    const settings = settingsData as CalendlySettingsRecord | null;

    return NextResponse.json({
      eventTypes,
      defaultEventTypeUri: settings?.default_event_type_uri ?? null,
      defaultEventTypeName: settings?.default_event_type_name ?? null,
      enabled: settings?.enabled ?? true,
    });
  } catch (error) {
    console.error("[calendly] event types failed", error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No pudimos listar reuniones." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const user = await getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as
    | {
        defaultEventTypeUri?: unknown;
        defaultEventTypeName?: unknown;
        enabled?: unknown;
      }
    | null;

  if (!body) {
    return NextResponse.json({ error: "Payload invalido." }, { status: 400 });
  }

  const defaultEventTypeUri =
    typeof body.defaultEventTypeUri === "string" && body.defaultEventTypeUri.trim()
      ? body.defaultEventTypeUri.trim()
      : null;
  const defaultEventTypeName =
    typeof body.defaultEventTypeName === "string" && body.defaultEventTypeName.trim()
      ? body.defaultEventTypeName.trim()
      : null;

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("calendly_settings")
      .upsert(
        {
          owner_id: user.id,
          default_event_type_uri: defaultEventTypeUri,
          default_event_type_name: defaultEventTypeName,
          enabled: typeof body.enabled === "boolean" ? body.enabled : true,
        } as never,
        { onConflict: "owner_id" },
      );

    if (error) {
      throw error;
    }

    return NextResponse.json({
      ok: true,
      defaultEventTypeUri,
      defaultEventTypeName,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No pudimos guardar Calendly." },
      { status: 500 },
    );
  }
}
