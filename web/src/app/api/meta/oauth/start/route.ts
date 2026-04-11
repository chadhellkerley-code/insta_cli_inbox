import { NextResponse } from "next/server";

import { buildMetaOauthUrl } from "@/lib/meta/client";
import {
  EXPECTED_META_APP_ID,
  getMetaOauthConfig,
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

  const state = createMetaOauthState(user.id);
  const oauthUrl = buildMetaOauthUrl(state);
  const oauthConfig = getMetaOauthConfig();

  console.info("[meta-oauth] authorize URL created", {
    flow: oauthConfig.flow,
    authorizeUrl: oauthUrl,
    authorizeEndpoint: oauthConfig.authorizeUrl,
    clientId: EXPECTED_META_APP_ID,
    redirectUri: oauthConfig.redirectUri,
    callbackPath: new URL(oauthConfig.redirectUri).pathname,
    scopes: oauthConfig.scopes,
    hasState: true,
    stateLength: state.length,
    debug,
  });

  const response = debug
    ? NextResponse.json({
        url: oauthUrl,
        clientId: EXPECTED_META_APP_ID,
        redirectUri: oauthConfig.redirectUri,
      })
    : NextResponse.redirect(oauthUrl);

  return response;
}
