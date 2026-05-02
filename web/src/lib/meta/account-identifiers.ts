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

function buildConflictingIdentifierErrorMessage(identifier: string) {
  return `El identificador de Instagram ${identifier} ya esta asociado a otra cuenta. Revisa las conexiones antes de continuar.`;
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

  for (const row of rows) {
    const existingResult = await options.admin
      .from("instagram_account_identifiers")
      .select("id, account_id")
      .eq("identifier", row.identifier)
      .maybeSingle();
    const existing = existingResult.data as { id: string; account_id: string } | null;

    if (existingResult.error) {
      console.error("[instagram-account-identifiers] lookup failed", {
        accountId: options.accountId,
        identifier: row.identifier,
        identifierType: row.identifier_type,
        error: existingResult.error.message,
      });

      throw new Error(buildIdentifierPersistenceErrorMessage(existingResult.error.message));
    }

    if (existing && existing.account_id !== options.accountId) {
      const message = buildConflictingIdentifierErrorMessage(row.identifier);

      console.error("[instagram-account-identifiers] conflicting identifier skipped", {
        accountId: options.accountId,
        existingAccountId: existing.account_id,
        identifier: row.identifier,
        identifierType: row.identifier_type,
      });

      throw new Error(message);
    }

    if (existing) {
      const updateResult = await options.admin
        .from("instagram_account_identifiers")
        .update({ identifier_type: row.identifier_type } as never)
        .eq("id", existing.id);

      if (updateResult.error) {
        console.error("[instagram-account-identifiers] update failed", {
          accountId: options.accountId,
          identifier: row.identifier,
          identifierType: row.identifier_type,
          error: updateResult.error.message,
        });

        throw new Error(buildIdentifierPersistenceErrorMessage(updateResult.error.message));
      }

      continue;
    }

    const insertResult = await options.admin
      .from("instagram_account_identifiers")
      .insert(row as never);

    if (insertResult.error) {
      console.error("[instagram-account-identifiers] insert failed", {
        accountId: options.accountId,
        identifier: row.identifier,
        identifierType: row.identifier_type,
        error: insertResult.error.message,
      });

      throw new Error(buildIdentifierPersistenceErrorMessage(insertResult.error.message));
    }
  }
}
