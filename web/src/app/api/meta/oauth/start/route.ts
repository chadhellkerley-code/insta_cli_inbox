import { NextResponse } from "next/server";

import { buildMetaOauthUrl } from "@/lib/meta/client";
import { META_OAUTH_STATE_COOKIE } from "@/lib/meta/config";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(buildMetaOauthUrl(state));

  response.cookies.set(META_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });

  return response;
}
