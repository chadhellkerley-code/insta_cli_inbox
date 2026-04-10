import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  fetchInstagramProfile,
} from "@/lib/meta/client";
import {
  isProfessionalAccountType,
  META_LOGIN_SCOPES,
  META_OAUTH_STATE_COOKIE,
  PROFESSIONAL_ACCOUNT_HELP_URL,
} from "@/lib/meta/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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

function clearOauthCookie(response: NextResponse) {
  response.cookies.set(META_OAUTH_STATE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const expectedState = cookies().get(META_OAUTH_STATE_COOKIE)?.value ?? null;

  console.log("OAuth callback received:", {
    url: request.url,
    code,
    state,
    error: requestUrl.searchParams.get("error"),
    errorDescription: requestUrl.searchParams.get("error_description"),
  });
  console.log("OAuth callback state cookie:", {
    cookieName: META_OAUTH_STATE_COOKIE,
    hasExpectedState: Boolean(expectedState),
    expectedState,
  });

  if (!code || !state || !expectedState || state !== expectedState) {
    const response = NextResponse.redirect(
      buildCompletionUrl(origin, {
        status: "error",
        message: "No pudimos validar la autorizacion de Meta.",
      }),
    );
    clearOauthCookie(response);
    return response;
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const response = NextResponse.redirect(
      buildCompletionUrl(origin, {
        status: "error",
        message: "Tu sesion expiro antes de terminar la conexion.",
      }),
    );
    clearOauthCookie(response);
    return response;
  }

  try {
    const shortLivedToken = await exchangeCodeForShortLivedToken(code);
    const longLivedToken = await exchangeForLongLivedToken(shortLivedToken.access_token);
    const profile = await fetchInstagramProfile(longLivedToken.access_token);

    if (
      !profile.instagramAccountId ||
      !profile.username ||
      !isProfessionalAccountType(profile.accountType)
    ) {
      const response = NextResponse.redirect(
        buildCompletionUrl(origin, {
          status: "error",
          message:
            "La cuenta conectada no es Professional. Cambiala a Business o Creator e intentalo otra vez.",
          helpUrl: PROFESSIONAL_ACCOUNT_HELP_URL,
        }),
      );
      clearOauthCookie(response);
      return response;
    }

    const admin = createAdminClient();
    const existingResult = await admin
      .from("instagram_accounts")
      .select("id, owner_id")
      .eq("instagram_account_id", profile.instagramAccountId)
      .maybeSingle();
    const existing = existingResult.data as ExistingAccountLookup | null;

    if (existingResult.error) {
      throw new Error(existingResult.error.message);
    }

    if (existing && existing.owner_id !== user.id) {
      throw new Error("Esta cuenta de Instagram ya esta conectada a otro usuario del CRM.");
    }

    const expiresAt = new Date(
      Date.now() + (longLivedToken.expires_in ?? 60 * 24 * 60 * 60) * 1000,
    ).toISOString();

    const upsertResult = await admin.from("instagram_accounts").upsert(
      {
        owner_id: user.id,
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
    clearOauthCookie(response);
    return response;
  } catch (error) {
    const response = NextResponse.redirect(
      buildCompletionUrl(origin, {
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "No pudimos completar la conexion con Meta.",
      }),
    );
    clearOauthCookie(response);
    return response;
  }
}
