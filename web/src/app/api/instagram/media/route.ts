import { NextResponse } from "next/server";

import {
  INSTAGRAM_AUDIO_ALLOWED_MIME_TYPES,
  INSTAGRAM_AUDIO_MAX_FILE_SIZE_BYTES,
  resolveInstagramAudioUpload,
} from "@/lib/meta/audio";
import { assertInstagramAudioUrlAccessible } from "@/lib/meta/audio-url";
import { META_MEDIA_BUCKET } from "@/lib/meta/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function ensureBucket() {
  const admin = createAdminClient();
  const buckets = await admin.storage.listBuckets();

  if (buckets.error) {
    throw new Error(buckets.error.message);
  }

  const existingBucket = buckets.data.find((bucket) => bucket.name === META_MEDIA_BUCKET);
  const desiredConfig = {
    public: true,
    fileSizeLimit: INSTAGRAM_AUDIO_MAX_FILE_SIZE_BYTES,
    allowedMimeTypes: [...INSTAGRAM_AUDIO_ALLOWED_MIME_TYPES],
  };

  if (!existingBucket) {
    const created = await admin.storage.createBucket(META_MEDIA_BUCKET, {
      public: desiredConfig.public,
      fileSizeLimit: desiredConfig.fileSizeLimit,
      allowedMimeTypes: desiredConfig.allowedMimeTypes,
    });

    if (created.error && !created.error.message.includes("already exists")) {
      throw new Error(created.error.message);
    }

    return;
  }

  const currentMimeTypes = [...(existingBucket.allowed_mime_types ?? [])].sort();
  const expectedMimeTypes = [...desiredConfig.allowedMimeTypes].sort();
  const needsUpdate =
    existingBucket.public !== desiredConfig.public ||
    existingBucket.file_size_limit !== desiredConfig.fileSizeLimit ||
    currentMimeTypes.length !== expectedMimeTypes.length ||
    currentMimeTypes.some((mimeType, index) => mimeType !== expectedMimeTypes[index]);

  if (needsUpdate) {
    const updated = await admin.storage.updateBucket(META_MEDIA_BUCKET, desiredConfig);

    if (updated.error) {
      throw new Error(updated.error.message);
    }
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No recibimos un archivo." }, { status: 400 });
  }

  const normalizedAudio = resolveInstagramAudioUpload({
    name: file.name,
    type: file.type,
  });

  if (!normalizedAudio) {
    return NextResponse.json(
      { error: "Solo se admiten audios MP3, M4A/MP4 o WAV." },
      { status: 400 },
    );
  }

  if (file.size > INSTAGRAM_AUDIO_MAX_FILE_SIZE_BYTES) {
    return NextResponse.json(
      { error: "Meta admite audios de hasta 25 MB." },
      { status: 400 },
    );
  }

  try {
    await ensureBucket();

    const admin = createAdminClient();
    const path = `${user.id}/${crypto.randomUUID()}.${normalizedAudio.extension}`;
    const upload = await admin.storage
      .from(META_MEDIA_BUCKET)
      .upload(path, file, {
        contentType: normalizedAudio.contentType,
        upsert: false,
      });

    if (upload.error) {
      throw new Error(upload.error.message);
    }

    const publicUrl = admin.storage
      .from(META_MEDIA_BUCKET)
      .getPublicUrl(path).data.publicUrl;

    try {
      await assertInstagramAudioUrlAccessible(publicUrl);
    } catch (error) {
      await admin.storage.from(META_MEDIA_BUCKET).remove([path]);
      throw error;
    }

    return NextResponse.json({
      ok: true,
      url: publicUrl,
      path,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "No pudimos subir el audio.",
      },
      { status: 500 },
    );
  }
}
