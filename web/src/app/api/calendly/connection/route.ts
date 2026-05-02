import { NextResponse } from "next/server";

import {
  calendlyTokenNeedsRefresh,
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

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("calendly_connections")
    .select("calendly_user_uri, access_token, refresh_token, expires_at")
    .eq("owner_id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "No pudimos cargar la conexion de Calendly." },
      { status: 500 },
    );
  }

  const connection = data as CalendlyConnectionRecord | null;

  if (!connection) {
    return NextResponse.json({
      connected: false,
      calendly_user_uri: null,
      expires_at: null,
    });
  }

  let expiresAt = connection.expires_at;

  if (calendlyTokenNeedsRefresh(connection.expires_at)) {
    try {
      const refreshedTokens = await refreshCalendlyToken(connection.refresh_token);

      expiresAt = refreshedTokens.expiresAt;

      const { error: refreshError } = await admin
        .from("calendly_connections")
        .update({
          access_token: refreshedTokens.accessToken,
          refresh_token: refreshedTokens.refreshToken,
          expires_at: refreshedTokens.expiresAt,
        } as never)
        .eq("owner_id", user.id);

      if (refreshError) {
        throw refreshError;
      }
    } catch (refreshError) {
      console.error("[calendly] token refresh failed", refreshError);

      return NextResponse.json({
        connected: false,
        calendly_user_uri: connection.calendly_user_uri,
        expires_at: connection.expires_at,
        needs_reconnect: true,
      });
    }
  }

  return NextResponse.json({
    connected: true,
    calendly_user_uri: connection.calendly_user_uri,
    expires_at: expiresAt,
  });
}
