type AccountIdentifierShape = {
  instagram_user_id?: string | null;
  instagram_account_id?: string | null;
  instagram_app_user_id?: string | null;
};

type IdentifierInput = {
  identifier: string | null | undefined;
  identifierType: string;
};

type ExistingIdentifierRow = {
  id?: string;
  account_id: string;
  identifier: string;
  identifier_type: string;
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

async function loadExistingInstagramIdentifierRows(options: {
  admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
  identifiers: string[];
}) {
  if (options.identifiers.length === 0) {
    return [] as ExistingIdentifierRow[];
  }

  const result = await options.admin
    .from("instagram_account_identifiers")
    .select("id, account_id, identifier, identifier_type")
    .in("identifier", options.identifiers);
  const rows = (result.data as ExistingIdentifierRow[] | null) ?? [];

  if (result.error) {
    throw new Error(buildIdentifierPersistenceErrorMessage(result.error.message));
  }

  return rows;
}

export async function assertInstagramIdentifierOwnership(options: {
  admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
  accountId?: string | null;
  identifiers: string[];
}) {
  const existingRows = await loadExistingInstagramIdentifierRows(options);
  const conflictingRows = existingRows.filter(
    (row) => !options.accountId || row.account_id !== options.accountId,
  );

  if (conflictingRows.length > 0) {
    const conflictingIdentifiers = conflictingRows
      .map((row) => `${row.identifier} -> ${row.account_id}`)
      .join(", ");

    throw new Error(
      `Identificadores de Instagram ya asignados a otra cuenta. account_id=${options.accountId ?? "new"}. conflicts=${conflictingIdentifiers}`,
    );
  }
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

  await assertInstagramIdentifierOwnership({
    admin: options.admin,
    accountId: options.accountId,
    identifiers: rows.map((row) => row.identifier),
  });
  const result = await options.admin.from("instagram_account_identifiers").upsert(rows as never, {
    onConflict: "account_id,identifier",
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

export async function syncInstagramAccountIdentifiers(options: {
  admin: ReturnType<typeof import("@/lib/supabase/admin").createAdminClient>;
  accountId: string;
  identifiers: IdentifierInput[];
}) {
  const rows = dedupeInstagramIdentifiers(options.identifiers).map((row) => ({
    account_id: options.accountId,
    identifier: row.identifier,
    identifier_type: row.identifierType,
  }));
  const nextIdentifiers = rows.map((row) => row.identifier);

  await assertInstagramIdentifierOwnership({
    admin: options.admin,
    accountId: options.accountId,
    identifiers: nextIdentifiers,
  });

  const existingResult = await options.admin
    .from("instagram_account_identifiers")
    .select("id, account_id, identifier, identifier_type")
    .eq("account_id", options.accountId);
  const existingRows = (existingResult.data as ExistingIdentifierRow[] | null) ?? [];

  if (existingResult.error) {
    throw new Error(buildIdentifierPersistenceErrorMessage(existingResult.error.message));
  }

  const identifiersToDelete = existingRows
    .filter((row) => !nextIdentifiers.includes(row.identifier))
    .map((row) => row.id)
    .filter(Boolean) as string[];

  if (identifiersToDelete.length > 0) {
    const deletion = await options.admin
      .from("instagram_account_identifiers")
      .delete()
      .in("id", identifiersToDelete);

    if (deletion.error) {
      throw new Error(buildIdentifierPersistenceErrorMessage(deletion.error.message));
    }
  }

  if (rows.length === 0) {
    return;
  }

  const upsert = await options.admin.from("instagram_account_identifiers").upsert(rows as never, {
    onConflict: "account_id,identifier",
  });

  if (upsert.error) {
    throw new Error(buildIdentifierPersistenceErrorMessage(upsert.error.message));
  }
}
