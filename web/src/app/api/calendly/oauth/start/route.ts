import { NextResponse } from "next/server";

import {
  buildCalendlyOauthUrl,
  createCalendlyOauthState,
  getCalendlyRedirectUri,
} from "@/lib/calendly/oauth";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const redirectUri = getCalendlyRedirectUri(new URL(request.url).origin);
  const state = createCalendlyOauthState(user.id, redirectUri);
  const oauthUrl = buildCalendlyOauthUrl({ state, redirectUri });

  return NextResponse.redirect(oauthUrl);
}
