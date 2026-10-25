import { createHash, createSign } from "node:crypto";

export type AndroidAppKind = "main" | "driver" | "schnell";
export type NativeAlert = {
  title: string;
  body: string;
  url?: string | null;
  type?: string;
  eventId?: string;
  ttlSeconds?: number;
};
export function normalizeFcmToken(value: unknown): string | null {
  return typeof value === "string" &&
    value.trim() === value &&
    /^[A-Za-z0-9:_-]{20,4096}$/.test(value)
    ? value
    : null;
}
export function fcmEndpointForToken(value: unknown, kind: AndroidAppKind) {
  const token = normalizeFcmToken(value);
  if (!token || !["main", "driver", "schnell"].includes(kind))
    throw new Error("invalid_native_device");
  return `fcm://${kind}/${token}`;
}
export function parseFcmEndpoint(value: unknown) {
  const match =
    typeof value === "string" && value.trim() === value
      ? /^fcm:\/\/(main|driver|schnell)\/([A-Za-z0-9:_-]{20,4096})$/.exec(value)
      : null;
  return match ? { kind: match[1] as AndroidAppKind, token: match[2] } : null;
}
function credentials() {
  try {
    const raw = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "{}");
    if (
      !/^[a-z][a-z0-9-]{4,62}$/.test(raw.project_id || "") ||
      !/^[^@]+@[^@]+\.gserviceaccount\.com$/.test(raw.client_email || "") ||
      !String(raw.private_key || "").includes("BEGIN PRIVATE KEY")
    )
      return null;
    return {
      projectId: String(raw.project_id),
      email: String(raw.client_email),
      key: String(raw.private_key).replace(/\\n/g, "\n"),
    };
  } catch {
    return null;
  }
}
export function isFcmConfigured() {
  return credentials() !== null;
}
let accessCache: { key: string; token: string; expires: number } | null = null;
let inFlight: { key: string; promise: Promise<string> } | null = null;
async function accessToken(
  config: NonNullable<ReturnType<typeof credentials>>,
  signal: AbortSignal,
) {
  const key = createHash("sha256")
    .update(config.projectId + config.email + config.key)
    .digest("hex");
  if (accessCache?.key === key && accessCache.expires > Date.now() + 60_000)
    return accessCache.token;
  if (inFlight?.key === key) return inFlight.promise;
  const promise = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString("base64url");
    const input = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: config.email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
    const assertion = `${input}.${createSign("RSA-SHA256").update(input).sign(config.key, "base64url")}`;
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal,
      redirect: "error",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || typeof payload.access_token !== "string")
      throw new Error("fcm_auth_failed");
    accessCache = {
      key,
      token: payload.access_token,
      expires:
        Date.now() + Math.min(3600, Number(payload.expires_in) || 3600) * 1000,
    };
    return payload.access_token as string;
  })();
  inFlight = { key, promise };
  try {
    return await promise;
  } finally {
    if (inFlight?.promise === promise) inFlight = null;
  }
}
export function nativeNotificationPath(value: unknown, kind: AndroidAppKind) {
  const fallback =
    kind === "driver"
      ? "/driver"
      : kind === "schnell"
        ? "/schnellbestellung"
        : "/menu";
  const raw = typeof value === "string" ? value : "";
  if (!raw.startsWith("/") || raw.startsWith("//") || /[\\\r\n]/.test(raw))
    return fallback;
  if (kind === "driver" && raw !== "/driver" && !raw.startsWith("/driver/"))
    return fallback;
  if (
    kind === "schnell" &&
    raw !== "/schnellbestellung" &&
    !raw.startsWith("/schnellbestellung/") &&
    !raw.startsWith("/schnellbestellung?")
  )
    return fallback;
  return raw.slice(0, 1000);
}
export async function sendFcmAlert(
  endpoint: unknown,
  alert: NativeAlert,
  timeoutMs = 8000,
) {
  const target = parseFcmEndpoint(endpoint);
  const config = credentials();
  if (!target || !config)
    return {
      attempted: false,
      ok: false,
      expired: false,
      status: 0,
      error: "fcm_not_configured",
    };
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Math.min(15000, timeoutMs)),
  );
  try {
    const token = await accessToken(config, controller.signal);
    const eventId = String(
      alert.eventId ||
        createHash("sha256")
          .update(alert.type + "|" + alert.url + "|" + alert.body)
          .digest("hex"),
    ).slice(0, 160);
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${config.projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        redirect: "error",
        signal: controller.signal,
        body: JSON.stringify({
          message: {
            token: target.token,
            notification: {
              title: alert.title.slice(0, 160),
              body: alert.body.slice(0, 600),
            },
            data: {
              url: nativeNotificationPath(alert.url, target.kind),
              type: String(alert.type || "order"),
              eventId,
              appKind: target.kind,
            },
            android: {
              priority: "HIGH",
              ttl: `${Math.max(30, Math.min(86400, alert.ttlSeconds || 300))}s`,
              notification: {
                channel_id: "bb_orders",
                tag: eventId,
                icon: "ic_notification",
              },
            },
          },
        }),
      },
    );
    const payload = await response.json().catch(() => ({}));
    const codes = Array.isArray(payload?.error?.details)
      ? payload.error.details.map((d: any) => String(d.errorCode || ""))
      : [];
    const expired = codes.includes("UNREGISTERED");
    if (response.status === 401) accessCache = null;
    return {
      attempted: true,
      ok: response.ok,
      expired,
      status: response.status,
      error: response.ok ? undefined : `fcm_${codes[0] || response.status}`,
    };
  } catch {
    return {
      attempted: true,
      ok: false,
      expired: false,
      status: 0,
      error: "fcm_transport_failed",
    };
  } finally {
    clearTimeout(timeout);
  }
}
