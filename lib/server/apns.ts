import { createPrivateKey, createSign, type KeyObject } from "node:crypto";
import { connect, constants } from "node:http2";

/*
  Native iOS push (APNs) for the Burger Brothers iOS app.

  The iOS app stores its device token as a normal PushSubscription row whose
  endpoint is `apns://<hex token>`. Web Push wakes a service worker with an
  empty message; APNs has no service worker, so the alert text is sent directly.

  Required env (from the Apple Developer account → Keys → APNs key):
    APNS_KEY_ID       10-character key id
    APNS_TEAM_ID      10-character team id
    APNS_PRIVATE_KEY  contents of AuthKey_<id>.p8 (PEM, raw or base64)
  Optional:
    APNS_BUNDLE_ID    default berlin.burgerbrothers.app
    APNS_ENVIRONMENT  "production" (App Store + TestFlight, default) or "sandbox"
*/

export const APNS_ENDPOINT_PREFIX = "apns://";

export type ApnsSendResult = {
  attempted: boolean;
  ok: boolean;
  expired: boolean;
  status: number;
  error?: string;
};

export type ApnsAlert = {
  title: string;
  body: string;
  url?: string | null;
  type?: string | null;
  eventId?: string | null;
};

function cleanEnv(name: string) {
  return String(process.env[name] || "").trim();
}

function readPrivateKeyPem() {
  const raw = cleanEnv("APNS_PRIVATE_KEY").replace(/\\n/g, "\n");
  if (!raw) return "";
  if (raw.includes("BEGIN PRIVATE KEY")) return raw;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    return decoded.includes("BEGIN PRIVATE KEY") ? decoded : "";
  } catch {
    return "";
  }
}

export function getApnsConfig() {
  const keyId = cleanEnv("APNS_KEY_ID");
  const teamId = cleanEnv("APNS_TEAM_ID");
  const pem = readPrivateKeyPem();
  const bundleId = cleanEnv("APNS_BUNDLE_ID") || "berlin.burgerbrothers.app";
  const sandbox = cleanEnv("APNS_ENVIRONMENT").toLowerCase() === "sandbox";

  let key: KeyObject | null = null;
  if (pem) {
    try {
      key = createPrivateKey(pem);
    } catch {
      key = null;
    }
  }

  const configured =
    /^[A-Z0-9]{10}$/.test(keyId) && /^[A-Z0-9]{10}$/.test(teamId) && Boolean(key);

  return {
    configured,
    keyId,
    teamId,
    key,
    bundleId,
    host: sandbox ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com",
  };
}

export function isApnsConfigured() {
  return getApnsConfig().configured;
}

/** APNs device tokens are 32+ bytes of hex. */
export function normalizeApnsToken(value: unknown) {
  const token = String(value ?? "").trim().toLowerCase();
  return /^[0-9a-f]{64,200}$/.test(token) ? token : null;
}

export function apnsEndpointForToken(token: string) {
  return `${APNS_ENDPOINT_PREFIX}${token}`;
}

export function isApnsEndpoint(endpoint: unknown) {
  return String(endpoint || "").startsWith(APNS_ENDPOINT_PREFIX);
}

function base64UrlJson(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

// Apple accepts a provider token for up to an hour and rejects refreshes more
// often than every 20 minutes, so one cached token is reused for 50 minutes.
let cachedJwt: { value: string; keyId: string; expiresAt: number } | null = null;

export function providerToken(config: ReturnType<typeof getApnsConfig>) {
  const now = Date.now();
  if (cachedJwt && cachedJwt.keyId === config.keyId && cachedJwt.expiresAt > now) {
    return cachedJwt.value;
  }

  const header = base64UrlJson({ alg: "ES256", kid: config.keyId });
  const claims = base64UrlJson({ iss: config.teamId, iat: Math.floor(now / 1000) });
  const signer = createSign("SHA256");
  signer.update(`${header}.${claims}`);
  signer.end();
  const signature = signer
    .sign({ key: config.key as KeyObject, dsaEncoding: "ieee-p1363" })
    .toString("base64url");

  const value = `${header}.${claims}.${signature}`;
  cachedJwt = { value, keyId: config.keyId, expiresAt: now + 50 * 60_000 };
  return value;
}

export function buildApnsPayload(alert: ApnsAlert) {
  return {
    aps: {
      alert: {
        title: String(alert.title || "Burger Brothers").slice(0, 160),
        body: String(alert.body || "").slice(0, 600),
      },
      sound: "default",
      "thread-id": String(alert.type || "general").slice(0, 60),
    },
    // Read by the iOS AppDelegate when the notification is tapped.
    url: alert.url || "/menu",
    eventId: alert.eventId || null,
  };
}

export async function sendApnsAlert(
  endpoint: string,
  alert: ApnsAlert,
  timeoutMs = 8_000,
  /** Test-only: send to a local HTTP/2 server instead of Apple. */
  hostOverride?: string,
): Promise<ApnsSendResult> {
  const config = getApnsConfig();
  if (!config.configured) {
    return { attempted: false, ok: false, expired: false, status: 0, error: "apns_not_configured" };
  }

  const token = normalizeApnsToken(String(endpoint).slice(APNS_ENDPOINT_PREFIX.length));
  if (!token) {
    return { attempted: false, ok: false, expired: true, status: 0, error: "invalid_device_token" };
  }

  const body = JSON.stringify(buildApnsPayload(alert));

  return new Promise<ApnsSendResult>((resolve) => {
    let settled = false;
    const finish = (result: ApnsSendResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        session.close();
      } catch {}
      resolve(result);
    };

    const session = connect(hostOverride || config.host);
    const timer = setTimeout(() => {
      try {
        session.destroy();
      } catch {}
      finish({ attempted: true, ok: false, expired: false, status: 0, error: "apns_timeout" });
    }, Math.max(1_000, timeoutMs));

    session.on("error", (error) => {
      finish({ attempted: true, ok: false, expired: false, status: 0, error: String(error?.message || "apns_connection_failed").slice(0, 200) });
    });

    const request = session.request({
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
      authorization: `bearer ${providerToken(config)}`,
      "apns-topic": config.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 24 * 60 * 60),
      "content-type": "application/json",
    });

    let status = 0;
    let responseBody = "";
    request.setEncoding("utf8");
    request.on("response", (headers) => {
      status = Number(headers[constants.HTTP2_HEADER_STATUS] || 0);
    });
    request.on("data", (chunk) => {
      responseBody += chunk;
    });
    request.on("error", (error) => {
      finish({ attempted: true, ok: false, expired: false, status, error: String(error?.message || "apns_request_failed").slice(0, 200) });
    });
    request.on("end", () => {
      let reason = "";
      try {
        reason = String(JSON.parse(responseBody || "{}")?.reason || "");
      } catch {}

      const expired =
        status === 410 ||
        reason === "BadDeviceToken" ||
        reason === "Unregistered" ||
        reason === "DeviceTokenNotForTopic";

      finish({
        attempted: true,
        ok: status === 200,
        expired,
        status,
        error: status === 200 ? undefined : reason || `apns_http_${status}`,
      });
    });

    request.end(body);
  });
}
