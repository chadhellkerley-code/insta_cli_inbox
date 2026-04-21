import { NextResponse } from "next/server";

import { buildMetaOauthUrl } from "@/lib/meta/client";
import {
  getMetaCanonicalRedirectConfig,
  getMetaOauthConfig,
  getMetaServerEnv,
} from "@/lib/meta/config";
import { createMetaOauthState } from "@/lib/meta/oauth-state";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const debug = requestUrl.searchParams.get("debug") === "1";
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (debug) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    return NextResponse.redirect(new URL("/login", request.url));
  }

  const oauthConfig = getMetaOauthConfig();
  const redirectConfig = getMetaCanonicalRedirectConfig();
  const { appId } = getMetaServerEnv();
  const state = createMetaOauthState(user.id, oauthConfig.redirectUri);
  const oauthUrl = buildMetaOauthUrl(state);

  console.info("[instagram-oauth] authorize URL created", {
    flow: oauthConfig.flow,
    authorizeEndpoint: oauthConfig.authorizeUrl,
    clientId: appId,
    canonicalCallbackPath: redirectConfig.callbackPath,
    canonicalRedirectUri: redirectConfig.redirectUri,
    authorizeRedirectUri: oauthConfig.redirectUri,
    redirectUriStoredInState: oauthConfig.redirectUri,
    redirectUriMatchesCanonical: oauthConfig.redirectUri === redirectConfig.redirectUri,
    scopes: oauthConfig.scopes,
    hasState: true,
    stateLength: state.length,
    debug,
  });

  return debug
    ? NextResponse.json({
        url: oauthUrl,
        clientId: appId,
        redirectUri: oauthConfig.redirectUri,
      })
    : NextResponse.redirect(oauthUrl);
}
