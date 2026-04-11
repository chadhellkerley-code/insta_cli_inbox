import { createHash } from "crypto";

import type { NextRequest, NextResponse } from "next/server";

import { META_OAUTH_CALLBACK_PATH } from "@/lib/meta/config";

const META_OAUTH_RESULT_COOKIE = "meta_oauth_result";
const META_OAUTH_RESULT_MAX_AGE_SECONDS = 10 * 60;

export type MetaOauthCompletionPayload = {
  status: "success" | "error";
  message: string;
  username?: string;
  helpUrl?: string;
};

type MetaOauthStoredResult = MetaOauthCompletionPayload & {
  codeHash: string;
  createdAt: string;
};

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("base64url");
}

function encodeStoredResult(value: MetaOauthStoredResult) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeStoredResult(value: string) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function isStoredResult(value: unknown): value is MetaOauthStoredResult {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MetaOauthStoredResult>;

  return (
    (candidate.status === "success" || candidate.status === "error") &&
    typeof candidate.message === "string" &&
    candidate.message.length > 0 &&
    typeof candidate.codeHash === "string" &&
    candidate.codeHash.length > 0 &&
    typeof candidate.createdAt === "string" &&
    candidate.createdAt.length > 0 &&
    (typeof candidate.username === "undefined" || typeof candidate.username === "string") &&
    (typeof candidate.helpUrl === "undefined" || typeof candidate.helpUrl === "string")
  );
}

export function readStoredMetaOauthResult(
  request: NextRequest,
  code: string,
): MetaOauthCompletionPayload | null {
  const rawCookieValue = request.cookies.get(META_OAUTH_RESULT_COOKIE)?.value;

  if (!rawCookieValue) {
    return null;
  }

  const decoded = decodeStoredResult(rawCookieValue);

  if (!isStoredResult(decoded)) {
    return null;
  }

  if (decoded.codeHash !== hashCode(code)) {
    return null;
  }

  return {
    status: decoded.status,
    message: decoded.message,
    username: decoded.username,
    helpUrl: decoded.helpUrl,
  };
}

export function attachStoredMetaOauthResult(
  response: NextResponse,
  code: string,
  payload: MetaOauthCompletionPayload,
) {
  const value: MetaOauthStoredResult = {
    ...payload,
    codeHash: hashCode(code),
    createdAt: new Date().toISOString(),
  };

  response.cookies.set({
    name: META_OAUTH_RESULT_COOKIE,
    value: encodeStoredResult(value),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: META_OAUTH_CALLBACK_PATH,
    maxAge: META_OAUTH_RESULT_MAX_AGE_SECONDS,
  });
}
