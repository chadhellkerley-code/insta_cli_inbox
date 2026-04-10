import { NextResponse } from "next/server";

import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  fetchInstagramProfile,
} from "@/lib/meta/client";
import {
  isProfessionalAccountType,
  META_LOGIN_SCOPES,
  PROFESSIONAL_ACCOUNT_HELP_URL,
} from "@/lib/meta/config";
import { verifyMetaOauthState } from "@/lib/meta/oauth-state";
import { createAdminClient } from "@/lib/supabase/admin";

type ExistingAccountLookup = {
  id: string;
  owner_id: string;
};

function buildCompletionUrl(origin: string, params: Record<string, string>) {
  const url = new URL("/meta/oauth/complete", origin);

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const oauthState = verifyMetaOauthState(state);

  console.log("ENV CHECK:", {
    hasServiceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    keyLength: process.env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0,
    hasUrl: !!process.env.SUPABASE_URL,
    nodeEnv: process.env.NODE_ENV,
  });

  console.log("OAuth callback received:", {
    hasCode: Boolean(code),
    hasState: Boolean(state),
    hasValidState: Boolean(oauthState),
    error: requestUrl.searchParams.get("error"),
    errorDescription: requestUrl.searchParams.get("error_description"),
  });

  if (!code || !oauthState) {
    return NextResponse.redirect(
      buildCompletionUrl(origin, {
        status: "error",
        message: "No pudimos validar la autorizacion de Meta.",
      }),
    );
  }

  try {
    const admin = createAdminClient();
    const userResult = await admin.auth.admin.getUserById(oauthState.userId);

    if (userResult.error || !userResult.data.user) {
      return NextResponse.redirect(
        buildCompletionUrl(origin, {
          status: "error",
          message: "No pudimos validar el usuario para completar la conexion.",
        }),
      );
    }

    const shortLivedToken = await exchangeCodeForShortLivedToken(code);
    const longLivedToken = await exchangeForLongLivedToken(shortLivedToken.access_token);
    const profile = await fetchInstagramProfile(longLivedToken.access_token);

    if (
      !profile.instagramAccountId ||
      !profile.username ||
      !isProfessionalAccountType(profile.accountType)
    ) {
      return NextResponse.redirect(
        buildCompletionUrl(origin, {
          status: "error",
          message:
            "La cuenta conectada no es Professional. Cambiala a Business o Creator e intentalo otra vez.",
          helpUrl: PROFESSIONAL_ACCOUNT_HELP_URL,
        }),
      );
    }

    const existingResult = await admin
      .from("instagram_accounts")
      .select("id, owner_id")
      .eq("instagram_account_id", profile.instagramAccountId)
      .maybeSingle();
    const existing = existingResult.data as ExistingAccountLookup | null;

    if (existingResult.error) {
      throw new Error(existingResult.error.message);
    }

    if (existing && existing.owner_id !== oauthState.userId) {
      throw new Error("Esta cuenta de Instagram ya esta conectada a otro usuario del CRM.");
    }

    const expiresAt = new Date(
      Date.now() + (longLivedToken.expires_in ?? 60 * 24 * 60 * 60) * 1000,
    ).toISOString();

    const upsertResult = await admin.from("instagram_accounts").upsert(
      {
        owner_id: oauthState.userId,
        instagram_account_id: profile.instagramAccountId,
        instagram_app_user_id: profile.appScopedUserId,
        username: profile.username,
        name: profile.name,
        account_type: profile.accountType,
        profile_picture_url: profile.profilePictureUrl,
        access_token: longLivedToken.access_token,
        token_expires_at: expiresAt,
        status: "connected",
        connected_at: new Date().toISOString(),
        scopes: shortLivedToken.permissions ?? Array.from(META_LOGIN_SCOPES),
        updated_at: new Date().toISOString(),
      } as never,
      {
        onConflict: "instagram_account_id",
      },
    );

    if (upsertResult.error) {
      throw new Error(upsertResult.error.message);
    }

    const response = NextResponse.redirect(
      buildCompletionUrl(origin, {
        status: "success",
        message: `Conectamos @${profile.username} correctamente.`,
        username: profile.username,
      }),
    );
    return response;
  } catch (error) {
    console.error("Callback error:", error instanceof Error ? error.message : error);

    return NextResponse.redirect(
      buildCompletionUrl(origin, {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "No pudimos completar la conexion con Meta.",
      }),
    );
  }
}
