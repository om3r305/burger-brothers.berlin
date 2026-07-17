import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  readSessionToken,
  verifySessionToken,
  type SessionRole,
} from "@/lib/server/session";

const ADMIN_COOKIE = process.env.ADMIN_COOKIE_NAME || "bb_admin_sess";
const TV_COOKIE = "bb_tv_auth";
const DRIVER_COOKIE = "bb_driver_sess";

const COOKIE_BY_ROLE: Record<SessionRole, string> = {
  admin: ADMIN_COOKIE,
  tv: TV_COOKIE,
  driver: DRIVER_COOKIE,
};

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

type RateBucket = {
  count: number;
  resetAt: number;
};

type RateStore = Map<string, RateBucket>;

declare global {
  // eslint-disable-next-line no-var
  var __bbRateLimitStore: RateStore | undefined;
}

function rateStore() {
  if (!globalThis.__bbRateLimitStore) {
    globalThis.__bbRateLimitStore = new Map<string, RateBucket>();
  }

  return globalThis.__bbRateLimitStore;
}

function decodeCookieValue(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function readRequestCookie(req: Request, name: string) {
  const cookieHeader = req.headers.get("cookie") || "";

  for (const entry of cookieHeader.split(";")) {
    const part = entry.trim();
    if (!part) continue;

    const separator = part.indexOf("=");
    const key = separator >= 0 ? part.slice(0, separator).trim() : part;
    if (key !== name) continue;

    return decodeCookieValue(separator >= 0 ? part.slice(separator + 1).trim() : "");
  }

  return "";
}

export async function hasSessionRole(req: Request, role: SessionRole) {
  return verifySessionToken(readRequestCookie(req, COOKIE_BY_ROLE[role]), role);
}

export async function getSessionSubject(req: Request, role: SessionRole) {
  const payload = await readSessionToken(
    readRequestCookie(req, COOKIE_BY_ROLE[role]),
    role,
  );

  return payload?.sub || "";
}

export async function hasAnySessionRole(
  req: Request,
  roles: readonly SessionRole[],
) {
  for (const role of roles) {
    if (await hasSessionRole(req, role)) return true;
  }

  return false;
}

export function securityJson(
  payload: Record<string, any>,
  status = 200,
  extraHeaders?: HeadersInit,
) {
  return NextResponse.json(payload, {
    status,
    headers: {
      ...NO_STORE_HEADERS,
      ...(extraHeaders || {}),
    },
  });
}

export function unauthorizedResponse(error = "unauthorized") {
  return securityJson(
    {
      ok: false,
      error,
    },
    401,
  );
}

export function forbiddenResponse(error = "forbidden") {
  return securityJson(
    {
      ok: false,
      error,
    },
    403,
  );
}

export async function requireSessionRole(
  req: Request,
  role: SessionRole,
) {
  return (await hasSessionRole(req, role)) ? null : unauthorizedResponse();
}

export async function requireAnySessionRole(
  req: Request,
  roles: readonly SessionRole[],
) {
  return (await hasAnySessionRole(req, roles))
    ? null
    : unauthorizedResponse();
}

function normalizeOrigin(value: string) {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return "";
  }
}

function configuredOrigins() {
  const values = [
    process.env.NEXT_PUBLIC_BASE_URL,
    process.env.SITE_URL,
    process.env.APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  ];

  return new Set(
    values
      .map((value) => normalizeOrigin(String(value || "").trim()))
      .filter(Boolean),
  );
}

/**
 * Browser tabanlı cookie mutation'larında cross-site istekleri reddeder.
 * Server-to-server istemciler Origin/Sec-Fetch-Site göndermeyebilir; bunlar
 * yine session veya özel token doğrulamasından geçmek zorundadır.
 */
export function hasTrustedMutationOrigin(req: Request) {
  const method = req.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;

  const fetchSite = String(req.headers.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return false;
  }

  const originHeader = String(req.headers.get("origin") || "").trim();
  if (!originHeader) return true;

  const requestOrigin = normalizeOrigin(req.url);
  const origin = normalizeOrigin(originHeader);
  if (!origin) return false;
  if (origin === requestOrigin) return true;

  return configuredOrigins().has(origin);
}

export async function requireMutationRole(
  req: Request,
  roles: readonly SessionRole[],
) {
  const authError = await requireAnySessionRole(req, roles);
  if (authError) return authError;
  if (!hasTrustedMutationOrigin(req)) return forbiddenResponse("origin_not_allowed");
  return null;
}

export function getClientIp(req: Request) {
  const forwarded = String(req.headers.get("x-forwarded-for") || "");
  const real = String(req.headers.get("x-real-ip") || "");
  const candidate = (forwarded.split(",")[0] || real || "unknown").trim();

  return candidate.slice(0, 96) || "unknown";
}

export function enforceRateLimit(
  req: Request,
  scope: string,
  limit: number,
  windowMs: number,
  identity?: string,
) {
  const now = Date.now();
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindow = Math.max(1_000, Math.floor(windowMs));
  const key = `${scope}:${identity || getClientIp(req)}`;
  const store = rateStore();
  const current = store.get(key);

  if (!current || current.resetAt <= now) {
    store.set(key, {
      count: 1,
      resetAt: now + safeWindow,
    });
    return null;
  }

  current.count += 1;
  store.set(key, current);

  if (current.count <= safeLimit) return null;

  const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1_000));

  return securityJson(
    {
      ok: false,
      error: "rate_limited",
      retryAfterSeconds,
    },
    429,
    {
      "Retry-After": String(retryAfterSeconds),
    },
  );
}

export function secretMatches(leftRaw: string, rightRaw: string) {
  const left = Buffer.from(String(leftRaw || ""));
  const right = Buffer.from(String(rightRaw || ""));

  if (!left.length || left.length !== right.length) return false;

  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function readBearerOrHeaderToken(
  req: Request,
  headerName: string,
  queryName?: string,
) {
  const authorization = req.headers.get("authorization") || "";
  const bearer = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : "";

  let query = "";
  if (queryName) {
    try {
      query = new URL(req.url).searchParams.get(queryName) || "";
    } catch {}
  }

  return String(req.headers.get(headerName) || bearer || query || "").trim();
}

export function verifyRequestSecret(
  req: Request,
  expectedRaw: string | undefined,
  headerName: string,
  queryName?: string,
) {
  const expected = String(expectedRaw || "").trim();
  const received = readBearerOrHeaderToken(req, headerName, queryName);

  return Boolean(expected && secretMatches(received, expected));
}
