import {
  createHash,
  createHmac,
  randomUUID,
} from "node:crypto";

export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
  endpoint: string;
  maxUploadBytes: number;
};

function trim(value: any) {
  return String(value || "").trim();
}

function positiveNumber(value: any, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function readR2Config(): R2Config | null {
  const accountId = trim(process.env.R2_ACCOUNT_ID);
  const accessKeyId = trim(process.env.R2_ACCESS_KEY_ID);
  const secretAccessKey = trim(process.env.R2_SECRET_ACCESS_KEY);
  const bucket = trim(process.env.R2_BUCKET);
  const publicBaseUrl = trim(process.env.R2_PUBLIC_BASE_URL).replace(/\/+$/, "");

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return null;
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl,
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    maxUploadBytes: Math.round(
      positiveNumber(process.env.R2_MAX_UPLOAD_MB, 750) * 1024 * 1024,
    ),
  };
}

function sha256Hex(value: string | Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function signingKey(secret: string, dateStamp: string) {
  const dateKey = hmac(`AWS4${secret}`, dateStamp);
  const regionKey = hmac(dateKey, "auto");
  const serviceKey = hmac(regionKey, "s3");
  return hmac(serviceKey, "aws4_request");
}

function amzDate(date = new Date()) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function encode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodePath(value: string) {
  return value
    .split("/")
    .filter(Boolean)
    .map(encode)
    .join("/");
}

function canonicalQuery(params: Record<string, string>) {
  return Object.entries(params)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join("&");
}

function slugFileName(value: string) {
  const last = value.split(/[\\/]/).pop() || "datei";
  const dot = last.lastIndexOf(".");
  const rawBase = dot > 0 ? last.slice(0, dot) : last;
  const rawExt = dot > 0 ? last.slice(dot + 1) : "";
  const base = rawBase
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "datei";
  const ext = rawExt.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 10);
  return ext ? `${base}.${ext}` : base;
}

export function createR2ObjectKey(fileName: string, now = new Date()) {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `showcase/${year}/${month}/${randomUUID()}-${slugFileName(fileName)}`;
}

function objectPath(config: R2Config, key: string) {
  return `/${encode(config.bucket)}/${encodePath(key)}`;
}

export function publicR2Url(config: R2Config, key: string) {
  return `${config.publicBaseUrl}/${encodePath(key)}`;
}

export function createR2PresignedPutUrl(
  config: R2Config,
  key: string,
  expiresSeconds = 900,
  now = new Date(),
) {
  const dateTime = amzDate(now);
  const dateStamp = dateTime.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = objectPath(config, key);
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${config.accessKeyId}/${scope}`,
    "X-Amz-Date": dateTime,
    "X-Amz-Expires": String(Math.min(3_600, Math.max(60, expiresSeconds))),
    "X-Amz-SignedHeaders": "host",
  };
  const query = canonicalQuery(params);
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    query,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    dateTime,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(config.secretAccessKey, dateStamp))
    .update(stringToSign)
    .digest("hex");

  return `${config.endpoint}${canonicalUri}?${query}&X-Amz-Signature=${signature}`;
}

export async function deleteR2Object(config: R2Config, key: string) {
  const now = new Date();
  const dateTime = amzDate(now);
  const dateStamp = dateTime.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = objectPath(config, key);
  const payloadHash = sha256Hex("");
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${dateTime}`,
    "",
  ].join("\n");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "DELETE",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    dateTime,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = createHmac("sha256", signingKey(config.secretAccessKey, dateStamp))
    .update(stringToSign)
    .digest("hex");
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const response = await fetch(`${config.endpoint}${canonicalUri}`, {
    method: "DELETE",
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": dateTime,
    },
    cache: "no-store",
  });

  if (!response.ok && response.status !== 404) {
    const detail = await response.text().catch(() => "");
    throw new Error(`R2_DELETE_FAILED_${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`);
  }
}
