import {
  createPrivateKey,
  createSign,
} from "node:crypto";

export type StoredSchnellPushSubscription = {
  endpoint: string;
  expirationTime: number | null;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
  createdAt?: string;
  userAgent?: string;
};

export type SchnellPushSendResult = {
  attempted: boolean;
  ok: boolean;
  expired: boolean;
  status: number;
  error?: string;
};

function base64UrlToBuffer(value: string) {
  return Buffer.from(value, "base64url");
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function cleanEnv(name: string) {
  return String(process.env[name] || "").trim();
}

export function getSchnellPushConfig() {
  const publicKey = cleanEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  const privateKey = cleanEnv("VAPID_PRIVATE_KEY");
  const subject = cleanEnv("VAPID_SUBJECT");

  const publicBytes = publicKey ? base64UrlToBuffer(publicKey) : Buffer.alloc(0);
  const privateBytes = privateKey ? base64UrlToBuffer(privateKey) : Buffer.alloc(0);
  const configured =
    publicBytes.length === 65 &&
    publicBytes[0] === 4 &&
    privateBytes.length === 32 &&
    /^(mailto:|https:\/\/)/i.test(subject);

  return {
    configured,
    publicKey: configured ? publicKey : "",
    privateKey: configured ? privateKey : "",
    subject: configured ? subject : "",
  };
}

export function normalizeSchnellPushSubscription(
  value: unknown,
): StoredSchnellPushSubscription | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  const endpoint = String(raw.endpoint || "").trim().slice(0, 2200);

  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return null;
  } catch {
    return null;
  }

  const rawKeys =
    raw.keys && typeof raw.keys === "object" && !Array.isArray(raw.keys)
      ? (raw.keys as Record<string, unknown>)
      : {};
  const p256dh = String(rawKeys.p256dh || "").trim().slice(0, 512);
  const auth = String(rawKeys.auth || "").trim().slice(0, 256);
  const expirationTime =
    raw.expirationTime === null || raw.expirationTime === undefined
      ? null
      : Number(raw.expirationTime);

  return {
    endpoint,
    expirationTime:
      expirationTime !== null && Number.isFinite(expirationTime)
        ? expirationTime
        : null,
    keys: p256dh || auth ? { p256dh, auth } : undefined,
    createdAt: String(raw.createdAt || "").trim().slice(0, 80) || undefined,
    userAgent: String(raw.userAgent || "").trim().slice(0, 300) || undefined,
  };
}

function createVapidJwt(endpoint: string, publicKey: string, privateKey: string, subject: string) {
  const endpointUrl = new URL(endpoint);
  const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
  const publicBytes = base64UrlToBuffer(publicKey);
  const privateBytes = base64UrlToBuffer(privateKey);

  const x = publicBytes.subarray(1, 33).toString("base64url");
  const y = publicBytes.subarray(33, 65).toString("base64url");
  const d = privateBytes.toString("base64url");
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x,
      y,
      d,
    },
    format: "jwk",
  });

  const encodedHeader = base64UrlJson({ typ: "JWT", alg: "ES256" });
  const encodedPayload = base64UrlJson({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: subject,
  });
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const signer = createSign("SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign({ key, dsaEncoding: "ieee-p1363" });

  return `${unsigned}.${signature.toString("base64url")}`;
}

export async function sendEmptySchnellPush(
  subscriptionValue: unknown,
  timeoutMs = 4_000,
): Promise<SchnellPushSendResult> {
  const subscription = normalizeSchnellPushSubscription(subscriptionValue);
  const config = getSchnellPushConfig();

  if (!subscription || !config.configured) {
    return { attempted: false, ok: false, expired: false, status: 0 };
  }

  const token = createVapidJwt(
    subscription.endpoint,
    config.publicKey,
    config.privateKey,
    config.subject,
  );
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1_500, Math.min(8_000, Number(timeoutMs) || 4_000)),
  );

  try {
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${token}, k=${config.publicKey}`,
        "Crypto-Key": `p256ecdsa=${config.publicKey}`,
        TTL: "300",
        Urgency: "high",
      },
      body: null,
      redirect: "manual",
      signal: controller.signal,
    });

    return {
      attempted: true,
      ok: response.ok,
      expired: response.status === 404 || response.status === 410,
      status: response.status,
      error: response.ok ? undefined : `push_http_${response.status}`,
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      expired: false,
      status: 0,
      error: error instanceof Error ? error.message : "push_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}
