import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

type AccountLookup = {
  id: string;
  owner_id: string;
};

type RouteContext = {
  params: {
    accountId: string;
  };
};

export async function DELETE(_request: Request, context: RouteContext) {
  const accountId = context.params.accountId?.trim();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  if (!accountId) {
    return NextResponse.json({ error: "Falta la cuenta a eliminar." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const accountResult = await admin
      .from("instagram_accounts")
      .select("id, owner_id")
      .eq("id", accountId)
      .eq("owner_id", user.id)
      .maybeSingle();
    const account = accountResult.data as AccountLookup | null;

    if (accountResult.error || !account) {
      return NextResponse.json({ error: "Cuenta no encontrada." }, { status: 404 });
    }

    const deleteResult = await admin
      .from("instagram_accounts")
      .delete()
      .eq("id", account.id)
      .eq("owner_id", user.id);

    if (deleteResult.error) {
      throw new Error(deleteResult.error.message);
    }

    return NextResponse.json({
      ok: true,
      message:
        "La cuenta fue eliminada. Supabase borro tambien conversaciones y mensajes asociados.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No pudimos eliminar la cuenta.",
      },
      { status: 500 },
    );
  }
}
