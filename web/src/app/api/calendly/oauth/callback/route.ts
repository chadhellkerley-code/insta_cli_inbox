import { NextResponse } from "next/server";

import {
  exchangeCalendlyCodeForTokens,
  getCalendlyCurrentUser,
  verifyCalendlyOauthState,
} from "@/lib/calendly/oauth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function buildSettingsRedirect(requestUrl: URL, params: Record<string, string>) {
  const url = new URL("/settings", requestUrl.origin);

  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const error =
    requestUrl.searchParams.get("error_description") ??
    requestUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      buildSettingsRedirect(requestUrl, {
        calendly: "error",
        message: error,
      }),
    );
  }

  const oauthState = verifyCalendlyOauthState(state);

  if (!code || !oauthState) {
    return NextResponse.redirect(
      buildSettingsRedirect(requestUrl, {
        calendly: "error",
        message: "No se pudo validar la conexion con Calendly.",
      }),
    );
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || user.id !== oauthState.userId) {
    return NextResponse.redirect(
      buildSettingsRedirect(requestUrl, {
        calendly: "error",
        message: "La sesion no coincide con la conexion de Calendly.",
      }),
    );
  }

  try {
    const tokens = await exchangeCalendlyCodeForTokens({
      code,
      redirectUri: oauthState.redirectUri,
    });
    const calendlyUser = await getCalendlyCurrentUser(tokens.accessToken);
    const admin = createAdminClient();

    const { error: connectionError } = await admin
      .from("calendly_connections")
      .upsert(
        {
          owner_id: user.id,
          calendly_user_uri: calendlyUser.uri,
          organization_uri: calendlyUser.organizationUri,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          expires_at: tokens.expiresAt,
        } as never,
        { onConflict: "owner_id" },
      );

    if (connectionError) {
      throw connectionError;
    }

    const { error: settingsError } = await admin
      .from("calendly_settings")
      .upsert(
        {
          owner_id: user.id,
          enabled: true,
        } as never,
        { onConflict: "owner_id" },
      );

    if (settingsError) {
      throw settingsError;
    }

    return NextResponse.redirect(
      buildSettingsRedirect(requestUrl, { calendly: "connected" }),
    );
  } catch (connectError) {
    console.error("[calendly-oauth] callback failed", connectError);

    return NextResponse.redirect(
      buildSettingsRedirect(requestUrl, {
        calendly: "error",
        message:
          connectError instanceof Error
            ? connectError.message
            : "No se pudo conectar Calendly.",
      }),
    );
  }
}
