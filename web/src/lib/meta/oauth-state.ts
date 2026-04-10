import { createHmac, randomUUID, timingSafeEqual } from "crypto";

import { getMetaServerEnv } from "@/lib/meta/config";

const STATE_TTL_SECONDS = 10 * 60;

type MetaOauthStatePayload = {
  v: 1;
  uid: string;
  nonce: string;
  exp: number;
};

export type VerifiedMetaOauthState = {
  userId: string;
};

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function getStateSecret() {
  return process.env.META_OAUTH_STATE_SECRET?.trim() || getMetaServerEnv().appSecret;
}

function signPayload(encodedPayload: string) {
  return createHmac("sha256", getStateSecret()).update(encodedPayload).digest("base64url");
}

function signaturesMatch(a: string, b: string) {
  const aBuffer = Buffer.from(a);
  const bBuffer = Buffer.from(b);

  return aBuffer.length === bBuffer.length && timingSafeEqual(aBuffer, bBuffer);
}

function isPayload(value: unknown): value is MetaOauthStatePayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<MetaOauthStatePayload>;

  return (
    payload.v === 1 &&
    typeof payload.uid === "string" &&
    payload.uid.length > 0 &&
    typeof payload.nonce === "string" &&
    payload.nonce.length > 0 &&
    typeof payload.exp === "number"
  );
}

export function createMetaOauthState(userId: string) {
  const payload: MetaOauthStatePayload = {
    v: 1,
    uid: userId,
    nonce: randomUUID(),
    exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);

  return `${encodedPayload}.${signature}`;
}

export function verifyMetaOauthState(state: string | null): VerifiedMetaOauthState | null {
  if (!state) {
    return null;
  }

  const [encodedPayload, signature, extra] = state.split(".");

  if (!encodedPayload || !signature || extra) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload);

  if (!signaturesMatch(signature, expectedSignature)) {
    return null;
  }

  let payload: unknown;

  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return null;
  }

  if (!isPayload(payload)) {
    return null;
  }

  if (payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }

  return {
    userId: payload.uid,
  };
}
