import type { NextRequest } from "next/server";

import { handleCanonicalMetaOauthCallback } from "@/lib/meta/oauth-callback";

export async function GET(request: NextRequest) {
  return handleCanonicalMetaOauthCallback(request);
}
