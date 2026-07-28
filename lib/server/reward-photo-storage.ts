const BUCKET = "winner-temp-photos";

function storageConfig() {
  const url = String(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  )
    .trim()
    .replace(/\/$/, "");
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  return url && serviceKey ? { url, serviceKey } : null;
}

function headers(config: { serviceKey: string }, extra?: Record<string, string>) {
  return {
    apikey: config.serviceKey,
    Authorization: `Bearer ${config.serviceKey}`,
    ...extra,
  };
}

function encodePath(path: string) {
  return path
    .split("/")
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join("/");
}

async function ensureBucket() {
  const config = storageConfig();
  if (!config) throw new Error("TEMP_PHOTO_STORAGE_NOT_CONFIGURED");

  const existing = await fetch(`${config.url}/storage/v1/bucket/${BUCKET}`, {
    headers: headers(config),
    cache: "no-store",
  });
  if (existing.ok) return config;
  if (existing.status !== 404 && existing.status !== 400) {
    throw new Error(`TEMP_PHOTO_BUCKET_READ_${existing.status}`);
  }

  const response = await fetch(`${config.url}/storage/v1/bucket`, {
    method: "POST",
    headers: headers(config, { "content-type": "application/json" }),
    body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const alreadyExists = /already|exist|duplicate/i.test(detail);
    if (!alreadyExists && response.status !== 409) {
      console.error("[reward-photo] bucket create failed", response.status, detail);
      throw new Error(`TEMP_PHOTO_BUCKET_${response.status}`);
    }
  }
  return config;
}

export async function uploadTemporaryWinnerPhoto(params: {
  path: string;
  bytes: ArrayBuffer;
  mimeType: string;
}) {
  const config = await ensureBucket();
  const response = await fetch(
    `${config.url}/storage/v1/object/${BUCKET}/${encodePath(params.path)}`,
    {
      method: "POST",
      headers: headers(config, {
        "content-type": params.mimeType,
        "x-upsert": "false",
      }),
      body: params.bytes,
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("[reward-photo] upload failed", response.status, detail);
    throw new Error(`TEMP_PHOTO_UPLOAD_${response.status}`);
  }
}

export async function readTemporaryWinnerPhoto(path: string) {
  const config = storageConfig();
  if (!config) throw new Error("TEMP_PHOTO_STORAGE_NOT_CONFIGURED");
  const response = await fetch(
    `${config.url}/storage/v1/object/${BUCKET}/${encodePath(path)}`,
    {
      headers: headers(config),
      cache: "no-store",
    },
  );
  if (!response.ok) return null;
  return {
    bytes: await response.arrayBuffer(),
    contentType: response.headers.get("content-type") || "image/webp",
  };
}

export async function deleteTemporaryWinnerPhoto(path: string) {
  const config = storageConfig();
  if (!config) return false;
  const response = await fetch(
    `${config.url}/storage/v1/object/${BUCKET}/${encodePath(path)}`,
    {
      method: "DELETE",
      headers: headers(config),
    },
  );
  return response.ok || response.status === 404;
}

export function temporaryPhotoStorageConfigured() {
  return Boolean(storageConfig());
}
