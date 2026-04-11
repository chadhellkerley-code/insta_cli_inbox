import { NextResponse } from "next/server";

import {
  getMetaCanonicalRedirectUri,
  getMetaOauthConfig,
  META_OAUTH_CALLBACK_PATH,
} from "@/lib/meta/config";
import { buildMetaOauthCompletionUrl } from "@/lib/meta/oauth-callback";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const code = requestUrl.searchParams.get("code");
  const state = requestUrl.searchParams.get("state");
  const oauthConfig = getMetaOauthConfig();
  const canonicalRedirectUri = getMetaCanonicalRedirectUri();

  console.error("[meta-oauth] non-canonical callback blocked", {
    flow: oauthConfig.flow,
    route: requestUrl.pathname,
    callbackUrl: requestUrl.toString(),
    canonicalCallbackPath: META_OAUTH_CALLBACK_PATH,
    canonicalRedirectUri,
    hasCode: Boolean(code),
    codeLength: code?.length ?? 0,
    hasState: Boolean(state),
    stateLength: state?.length ?? 0,
  });

  return NextResponse.redirect(
    buildMetaOauthCompletionUrl(origin, {
      status: "error",
      message:
        "Configuracion OAuth invalida: Meta debe usar la callback canonica /auth/callback.",
    }),
  );
}
