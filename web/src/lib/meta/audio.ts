const INSTAGRAM_AUDIO_EXTENSION_TO_MIME_TYPE = {
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  mp4: "audio/mp4",
  wav: "audio/wav",
} as const;

const INSTAGRAM_AUDIO_MIME_TYPE_ALIASES = {
  "audio/m4a": "audio/mp4",
  "audio/mp3": "audio/mpeg",
  "audio/vnd.wave": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/x-m4a": "audio/mp4",
  "audio/x-wav": "audio/wav",
} as const;

export const INSTAGRAM_AUDIO_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const INSTAGRAM_AUDIO_ALLOWED_MIME_TYPES = Object.freeze(
  Array.from(new Set(Object.values(INSTAGRAM_AUDIO_EXTENSION_TO_MIME_TYPE))),
);
export const INSTAGRAM_AUDIO_ACCEPT_ATTRIBUTE = [
  ".m4a",
  ".mp3",
  ".mp4",
  ".wav",
  ...INSTAGRAM_AUDIO_ALLOWED_MIME_TYPES,
  ...Object.keys(INSTAGRAM_AUDIO_MIME_TYPE_ALIASES),
].join(",");
export const INSTAGRAM_AUDIO_ACCEPT_HELPER_TEXT = "Acepta MP3, M4A/MP4 o WAV";

type InstagramAudioMimeType = (typeof INSTAGRAM_AUDIO_ALLOWED_MIME_TYPES)[number];

function normalizeMimeType(value: string | null | undefined): InstagramAudioMimeType | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().split(";")[0];

  if (!normalized) {
    return null;
  }

  if (normalized in INSTAGRAM_AUDIO_MIME_TYPE_ALIASES) {
    return INSTAGRAM_AUDIO_MIME_TYPE_ALIASES[
      normalized as keyof typeof INSTAGRAM_AUDIO_MIME_TYPE_ALIASES
    ];
  }

  if (INSTAGRAM_AUDIO_ALLOWED_MIME_TYPES.includes(normalized as InstagramAudioMimeType)) {
    return normalized as InstagramAudioMimeType;
  }

  return null;
}

function normalizeExtension(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim().toLowerCase();

  if (!trimmed) {
    return null;
  }

  const extension = trimmed.includes(".") ? trimmed.split(".").pop() ?? "" : trimmed;

  return extension || null;
}

export function resolveInstagramAudioUpload(input: {
  name?: string | null;
  type?: string | null;
}) {
  const extension = normalizeExtension(input.name);
  const mimeType =
    normalizeMimeType(input.type) ??
    (extension
      ? INSTAGRAM_AUDIO_EXTENSION_TO_MIME_TYPE[
          extension as keyof typeof INSTAGRAM_AUDIO_EXTENSION_TO_MIME_TYPE
        ] ?? null
      : null);

  if (!mimeType) {
    return null;
  }

  const normalizedExtension =
    extension && extension in INSTAGRAM_AUDIO_EXTENSION_TO_MIME_TYPE
      ? extension
      : Object.entries(INSTAGRAM_AUDIO_EXTENSION_TO_MIME_TYPE).find(
          ([, candidateMimeType]) => candidateMimeType === mimeType,
        )?.[0] ?? "m4a";

  return {
    contentType: mimeType,
    extension: normalizedExtension,
  };
}
