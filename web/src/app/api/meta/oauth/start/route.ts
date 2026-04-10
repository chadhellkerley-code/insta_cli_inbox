import { NextResponse } from "next/server";

import { buildMetaOauthUrl } from "@/lib/meta/client";
import {
  EXPECTED_META_APP_ID,
  META_OAUTH_REDIRECT_URI,
  META_OAUTH_STATE_COOKIE,
} from "@/lib/meta/config";
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

  const state = crypto.randomUUID();
  const oauthUrl = buildMetaOauthUrl(state);
  const response = debug
    ? NextResponse.json({
        url: oauthUrl,
        clientId: EXPECTED_META_APP_ID,
        redirectUri: META_OAUTH_REDIRECT_URI,
      })
    : NextResponse.redirect(oauthUrl);

  response.cookies.set(META_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });

  return response;
}
