import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

export type CloudinaryResourceType = "image" | "video";

export type CloudinaryConfig = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  folderPrefix: string;
  maxUploadBytes: number;
};

type SignableValue = string | number | boolean | Array<string | number>;
type SignableParams = Record<string, SignableValue | null | undefined>;

function text(value: unknown) {
  return String(value ?? "").trim();
}

function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function cleanFolder(value: unknown) {
  const folder = text(value)
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, ""))
    .filter(Boolean)
    .join("/");
  return folder || "burger-brothers/showcase";
}

function slugFileName(value: string) {
  const last = value.split(/[\\/]/).pop() || "medya";
  const dot = last.lastIndexOf(".");
  const base = (dot > 0 ? last.slice(0, dot) : last)
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
  return base || "medya";
}

export function readCloudinaryConfig(): CloudinaryConfig | null {
  const cloudName = text(process.env.CLOUDINARY_CLOUD_NAME);
  const apiKey = text(process.env.CLOUDINARY_API_KEY);
  const apiSecret = text(process.env.CLOUDINARY_API_SECRET);

  if (!cloudName || !apiKey || !apiSecret) return null;

  // Direct browser Upload API calls support files up to 100 MB. Keep a small
  // safety margin so the admin gets a clear error before Cloudinary rejects it.
  const maxUploadMb = Math.min(
    95,
    positiveNumber(process.env.CLOUDINARY_MAX_UPLOAD_MB, 95),
  );

  return {
    cloudName,
    apiKey,
    apiSecret,
    folderPrefix: cleanFolder(process.env.CLOUDINARY_SHOWCASE_FOLDER),
    maxUploadBytes: Math.round(maxUploadMb * 1024 * 1024),
  };
}

function valueForSignature(value: SignableValue) {
  if (Array.isArray(value)) return value.join(",");
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function serializeCloudinaryParams(params: SignableParams) {
  return Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && valueForSignature(value as SignableValue) !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${valueForSignature(value as SignableValue)}`)
    .join("&");
}

export function signCloudinaryParams(
  params: SignableParams,
  apiSecret: string,
) {
  return createHash("sha1")
    .update(`${serializeCloudinaryParams(params)}${apiSecret}`)
    .digest("hex");
}

export function createCloudinaryPublicId(
  config: CloudinaryConfig,
  fileName: string,
  now = new Date(),
) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${config.folderPrefix}/${year}/${month}/${randomUUID()}-${slugFileName(fileName)}`;
}

export function createCloudinaryUploadSignature(
  config: CloudinaryConfig,
  publicId: string,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const fields = {
    overwrite: "false",
    public_id: publicId,
    timestamp,
  } as const;

  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/auto/upload`,
    fields: {
      api_key: config.apiKey,
      ...fields,
      signature: signCloudinaryParams(fields, config.apiSecret),
    },
    publicId,
    expiresAt: timestamp + 10 * 60,
  };
}

function safeEqualHex(left: string, right: string) {
  if (!/^[a-f0-9]+$/i.test(left) || !/^[a-f0-9]+$/i.test(right)) return false;
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function verifyCloudinaryUploadResponse(
  config: CloudinaryConfig,
  payload: {
    publicId: string;
    version: number | string;
    signature: string;
  },
) {
  const publicId = text(payload.publicId);
  const version = text(payload.version);
  const signature = text(payload.signature);
  if (!publicId || !version || !signature) return false;

  const expected = signCloudinaryParams(
    { public_id: publicId, version },
    config.apiSecret,
  );
  return safeEqualHex(expected, signature);
}

export function isAllowedCloudinaryPublicId(
  config: CloudinaryConfig,
  publicId: string,
) {
  return publicId.startsWith(`${config.folderPrefix}/`);
}

export function isCloudinaryDeliveryUrl(
  config: CloudinaryConfig,
  value: string,
) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (url.hostname !== "res.cloudinary.com") return false;
    const prefix = `/${config.cloudName}/`;
    return url.pathname.startsWith(prefix);
  } catch {
    return false;
  }
}

export async function deleteCloudinaryAsset(
  config: CloudinaryConfig,
  publicId: string,
  resourceType: CloudinaryResourceType,
) {
  if (!isAllowedCloudinaryPublicId(config, publicId)) {
    throw new Error("CLOUDINARY_PUBLIC_ID_NOT_ALLOWED");
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const fields = {
    invalidate: "true",
    public_id: publicId,
    timestamp,
    type: "upload",
  } as const;
  const form = new URLSearchParams();
  const requestFields = {
    api_key: config.apiKey,
    ...fields,
    signature: signCloudinaryParams(fields, config.apiSecret),
  };
  Object.entries(requestFields).forEach(([key, value]) => {
    form.set(key, String(value));
  });

  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${encodeURIComponent(config.cloudName)}/${resourceType}/destroy`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      cache: "no-store",
    },
  );
  const result = await response.json().catch(() => ({}));

  if (!response.ok || !["ok", "not found"].includes(String(result?.result || ""))) {
    throw new Error(
      `CLOUDINARY_DELETE_FAILED_${response.status}:${String(result?.error?.message || result?.result || "unknown").slice(0, 300)}`,
    );
  }

  return result;
}
