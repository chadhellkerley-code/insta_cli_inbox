import { NextResponse } from "next/server";

import { META_MEDIA_BUCKET } from "@/lib/meta/config";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

async function ensureBucket() {
  const admin = createAdminClient();
  const buckets = await admin.storage.listBuckets();

  if (buckets.error) {
    throw new Error(buckets.error.message);
  }

  if (!buckets.data.some((bucket) => bucket.name === META_MEDIA_BUCKET)) {
    const created = await admin.storage.createBucket(META_MEDIA_BUCKET, {
      public: true,
      fileSizeLimit: "25MB",
      allowedMimeTypes: ["audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav"],
    });

    if (created.error && !created.error.message.includes("already exists")) {
      throw new Error(created.error.message);
    }
  }
}

export async function POST(request: Request) {
  const supabase = createClient();
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

  if (!file.type.startsWith("audio/")) {
    return NextResponse.json(
      { error: "Solo se admiten archivos de audio." },
      { status: 400 },
    );
  }

  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json(
      { error: "Meta admite audios de hasta 25 MB." },
      { status: 400 },
    );
  }

  try {
    await ensureBucket();

    const admin = createAdminClient();
    const extension = file.name.includes(".") ? file.name.split(".").pop() : "m4a";
    const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const upload = await admin.storage
      .from(META_MEDIA_BUCKET)
      .upload(path, file, {
        contentType: file.type,
        upsert: false,
      });

    if (upload.error) {
      throw new Error(upload.error.message);
    }

    const publicUrl = admin.storage
      .from(META_MEDIA_BUCKET)
      .getPublicUrl(path).data.publicUrl;

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
