type AccountIdentifierShape = {
  instagram_user_id?: string | null;
  instagram_account_id?: string | null;
  instagram_app_user_id?: string | null;
};

type IdentifierInput = {
  identifier: string | null | undefined;
  identifierType: string;
};

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
    ignoreDuplicates: true,
  });

  if (result.error) {
    console.warn("[instagram-account-identifiers] persistence skipped", {
      accountId: options.accountId,
      identifiers: rows.map((row) => ({
        identifier: row.identifier,
        identifierType: row.identifier_type,
      })),
      error: result.error.message,
    });
  }
}
