type AccountIdentifierShape = {
  instagram_user_id?: string | null;
  instagram_account_id?: string | null;
  instagram_app_user_id?: string | null;
};

type IdentifierInput = {
  identifier: string | null | undefined;
  identifierType: string;
};

export const REQUIRED_INSTAGRAM_IDENTIFIER_MIGRATION_PATH =
  "db/migrations/20260412_add_instagram_webhook_identifier_debug_tables.sql";

export function normalizeInstagramIdentifier(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed || null;
}

export function collectInstagramAccountIdentifiers(account: AccountIdentifierShape) {
  return dedupeInstagramIdentifiers([
    {
      identifier: normalizeInstagramIdentifier(account.instagram_user_id),
      identifierType: "instagram_user_id",
    },
    {
      identifier: normalizeInstagramIdentifier(account.instagram_account_id),
      identifierType: "instagram_account_id",
    },
    {
      identifier: normalizeInstagramIdentifier(account.instagram_app_user_id),
      identifierType: "instagram_app_user_id",
    },
  ]);
}

export function dedupeInstagramIdentifiers(inputs: IdentifierInput[]) {
  const seen = new Set<string>();
  const rows: Array<{ identifier: string; identifierType: string }> = [];

  for (const input of inputs) {
    const identifier = normalizeInstagramIdentifier(input.identifier);

    if (!identifier || seen.has(identifier)) {
      continue;
    }

    seen.add(identifier);
    rows.push({
      identifier,
      identifierType: input.identifierType,
    });
  }

  return rows;
}

function buildIdentifierPersistenceErrorMessage(errorMessage: string) {
  if (
    errorMessage.includes("instagram_account_identifiers") &&
    errorMessage.includes("schema cache")
  ) {
    return `Falta la tabla requerida public.instagram_account_identifiers. Ejecuta la migracion ${REQUIRED_INSTAGRAM_IDENTIFIER_MIGRATION_PATH} en Supabase y reintenta la conexion.`;
  }

  return `No pudimos persistir los identificadores requeridos de la cuenta de Instagram. ${errorMessage}`;
}

export async function persistInstagramAccountIdentifiers(options: {
  admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
  accountId: string;
  identifiers: IdentifierInput[];
}) {
  const rows = dedupeInstagramIdentifiers(options.identifiers).map((row) => ({
    account_id: options.accountId,
    identifier: row.identifier,
    identifier_type: row.identifierType,
  }));

  if (rows.length === 0) {
    return;
  }

  const result = await options.admin.from("instagram_account_identifiers").upsert(rows as never, {
    onConflict: "identifier",
  });

  if (result.error) {
    console.error("[instagram-account-identifiers] persistence failed", {
      accountId: options.accountId,
      identifiers: rows.map((row) => ({
        identifier: row.identifier,
        identifierType: row.identifier_type,
      })),
      error: result.error.message,
    });

    throw new Error(buildIdentifierPersistenceErrorMessage(result.error.message));
  }
}
