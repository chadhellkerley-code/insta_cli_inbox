import { NextResponse } from "next/server";

import { subscribeInstagramAppUserToWebhooks } from "@/lib/meta/client";
import { META_WEBHOOK_FIELDS } from "@/lib/meta/config";
import { ensureInstagramAccessToken } from "@/lib/meta/token-lifecycle";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type AccountLookup = {
  id: string;
  owner_id: string;
  instagram_account_id: string;
  access_token: string;
  token_expires_at: string | null;
};

type RouteContext = {
  params: {
    accountId: string;
  };
};

export async function POST(_request: Request, context: RouteContext) {
  const accountId = context.params.accountId?.trim();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  if (!accountId) {
    return NextResponse.json({ error: "Falta la cuenta a sincronizar." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const accountResult = await admin
      .from("instagram_accounts")
      .select("id, owner_id, instagram_account_id, access_token, token_expires_at")
      .eq("id", accountId)
      .maybeSingle();
    const account = accountResult.data as AccountLookup | null;

    if (accountResult.error || !account) {
      return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });
    }

    if (account.owner_id !== user.id) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }

    const accessToken = await ensureInstagramAccessToken({
      accessToken: account.access_token,
      expiresAt: account.token_expires_at,
      persistToken: async (token) => {
        const updateResult = await admin
          .from("instagram_accounts")
          .update({
            access_token: token.accessToken,
            token_expires_at: token.expiresAt,
            updated_at: new Date().toISOString(),
          } as never)
          .eq("id", account.id);

        if (updateResult.error) {
          throw new Error(updateResult.error.message);
        }
      },
    });

    await subscribeInstagramAppUserToWebhooks({
      accessToken,
      instagramUserId: account.instagram_account_id,
      subscribedFields: META_WEBHOOK_FIELDS,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No pudimos activar la suscripcion del webhook.",
      },
      { status: 500 },
    );
  }
}
