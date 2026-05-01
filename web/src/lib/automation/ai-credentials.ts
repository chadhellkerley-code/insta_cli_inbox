import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

import { createAdminClient } from "@/lib/supabase/admin";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
export const AUTOMATION_AI_PROVIDER = "openai";
export const AUTOMATION_AI_MODEL = "gpt-4o-mini";

export type AiCredentialProvider = typeof AUTOMATION_AI_PROVIDER;

export type AiCredentialRow = {
  id: string;
  owner_id: string;
  provider: AiCredentialProvider;
  model: string;
  api_key_ciphertext: string;
  api_key_iv: string;
  api_key_auth_tag: string;
  api_key_last4: string;
  created_at: string | null;
  updated_at: string | null;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function ensureOpenAiApiKey(value: unknown) {
  const normalizedApiKey = normalizeString(value);

  if (!normalizedApiKey) {
    throw new Error("La API key de OpenAI es obligatoria.");
  }

  if (!normalizedApiKey.startsWith("sk-") || normalizedApiKey.length < 20) {
    throw new Error("La API key no parece ser una credencial valida de OpenAI.");
  }

  return normalizedApiKey;
}

function getEncryptionKey() {
  const rawKey = normalizeString(process.env.AI_CREDENTIALS_ENCRYPTION_KEY);

  if (!rawKey) {
    throw new Error("AI_CREDENTIALS_ENCRYPTION_KEY no esta configurada.");
  }

  const candidates: Buffer[] = [];

  if (/^[a-f0-9]{64}$/i.test(rawKey)) {
    candidates.push(Buffer.from(rawKey, "hex"));
  }

  candidates.push(Buffer.from(rawKey, "base64"));
  candidates.push(Buffer.from(rawKey, "utf8"));

  const key = candidates.find((candidate) => candidate.length === 32);

  if (!key) {
    throw new Error("AI_CREDENTIALS_ENCRYPTION_KEY debe tener 32 bytes.");
  }

  return key;
}

export function encryptApiKey(apiKey: string) {
  const normalizedApiKey = ensureOpenAiApiKey(apiKey);

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(normalizedApiKey, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return {
    api_key_ciphertext: ciphertext.toString("base64"),
    api_key_iv: iv.toString("base64"),
    api_key_auth_tag: authTag.toString("base64"),
    api_key_last4: normalizedApiKey.slice(-4),
  };
}

export function decryptApiKey(row: AiCredentialRow) {
  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(row.api_key_iv, "base64"),
  );

  decipher.setAuthTag(Buffer.from(row.api_key_auth_tag, "base64"));

  return Buffer.concat([
    decipher.update(Buffer.from(row.api_key_ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export async function saveAiCredential(
  ownerId: string,
  apiKey: string,
) {
  const normalizedOwnerId = normalizeString(ownerId);

  if (!normalizedOwnerId) {
    throw new Error("Owner invalido.");
  }

  const payload = {
    owner_id: normalizedOwnerId,
    provider: AUTOMATION_AI_PROVIDER,
    model: AUTOMATION_AI_MODEL,
    ...encryptApiKey(apiKey),
  };
  const admin = createAdminClient();
  const result = await admin
    .from("automation_ai_credentials")
    .upsert(payload as never, { onConflict: "owner_id" })
    .select("*")
    .maybeSingle();

  if (result.error || !result.data) {
    throw new Error(result.error?.message ?? "No pudimos guardar la credencial de IA.");
  }

  return result.data as AiCredentialRow;
}

export async function loadAiCredential(ownerId: string) {
  const normalizedOwnerId = normalizeString(ownerId);

  if (!normalizedOwnerId) {
    return null;
  }

  const admin = createAdminClient();
  const result = await admin
    .from("automation_ai_credentials")
    .select("*")
    .eq("owner_id", normalizedOwnerId)
    .maybeSingle();

  if (result.error) {
    throw new Error(result.error.message);
  }

  return (result.data as AiCredentialRow | null) ?? null;
}
