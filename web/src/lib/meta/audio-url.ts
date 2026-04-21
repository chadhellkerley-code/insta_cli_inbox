import "server-only";

import {
  INSTAGRAM_AUDIO_MAX_FILE_SIZE_BYTES,
  normalizeInstagramAudioMimeType,
  resolveInstagramAudioUpload,
} from "@/lib/meta/audio";

const AUDIO_PROBE_TIMEOUT_MS = 10_000;

function normalizeMediaUrl(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized || null;
}

function isPrivateIpv4(hostname: string) {
  const segments = hostname.split(".").map((segment) => Number(segment));

  if (segments.length !== 4 || segments.some((segment) => !Number.isInteger(segment))) {
    return false;
  }

  const [first, second] = segments;

  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();

  return (
    normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized.endsWith(".local") ||
    isPrivateIpv4(normalized)
  );
}

function parseContentLength(response: Response) {
  const contentLength = response.headers.get("content-length");
  const contentRange = response.headers.get("content-range");

  if (contentLength) {
    const parsed = Number(contentLength);

    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  if (contentRange?.includes("/")) {
    const total = Number(contentRange.split("/").pop());

    if (Number.isFinite(total) && total >= 0) {
      return total;
    }
  }

  return null;
}

async function fetchAudioProbe(url: string, method: "HEAD" | "GET") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUDIO_PROBE_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method,
      headers: method === "GET" ? { Range: "bytes=0-0" } : undefined,
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function probeAudioUrl(url: string) {
  let headResponse: Response | null = null;

  try {
    headResponse = await fetchAudioProbe(url, "HEAD");
  } catch {
    headResponse = null;
  }

  if (headResponse?.ok) {
    return headResponse;
  }

  const getResponse = await fetchAudioProbe(url, "GET");

  if (!getResponse.ok) {
    throw new Error("La URL del audio no es publica o no responde correctamente.");
  }

  return getResponse;
}

export async function assertInstagramAudioUrlAccessible(value: unknown) {
  const normalizedUrl = normalizeMediaUrl(value);

  if (!normalizedUrl) {
    throw new Error("Cada audio necesita una URL publica.");
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error("La URL del audio no es valida.");
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("La URL del audio debe usar http o https.");
  }

  if (isPrivateHostname(parsedUrl.hostname)) {
    throw new Error("La URL del audio debe ser publica para que Meta pueda descargarla.");
  }

  const response = await probeAudioUrl(parsedUrl.toString());
  const contentTypeHeader = response.headers.get("content-type");
  const normalizedMimeType = normalizeInstagramAudioMimeType(contentTypeHeader);

  if (contentTypeHeader && !normalizedMimeType) {
    throw new Error("La URL no devuelve un audio compatible con Meta.");
  }

  const resolvedUpload = resolveInstagramAudioUpload({
    name: new URL(response.url || parsedUrl.toString()).pathname,
    type: normalizedMimeType ?? contentTypeHeader,
  });

  if (!resolvedUpload) {
    throw new Error("La URL no apunta a un audio MP3, M4A/MP4 o WAV valido.");
  }

  const contentLength = parseContentLength(response);

  if (contentLength !== null && contentLength > INSTAGRAM_AUDIO_MAX_FILE_SIZE_BYTES) {
    throw new Error("Meta admite audios de hasta 25 MB.");
  }

  return {
    url: parsedUrl.toString(),
    resolvedUrl: response.url || parsedUrl.toString(),
    contentType: resolvedUpload.contentType,
    extension: resolvedUpload.extension,
    contentLength,
  };
}
