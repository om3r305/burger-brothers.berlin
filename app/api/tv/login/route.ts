// app/api/tv/login/route.ts
import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { createSessionToken } from "@/lib/server/session";
import { enforceRateLimit } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const AUTH_COOKIE = "bb_tv_auth";
const UI_COOKIE = "bb_tv_ui";
const MAX_DAYS = 30;

function isLocalTvRequest(req: Request) {
  // Loopback detection is used only for Secure-cookie compatibility.
  if (process.env.VERCEL === "1" || process.env.VERCEL_ENV) return false;

  try {
    const hostname = new URL(req.url).hostname.toLowerCase();
    return hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]";
  } catch {
    return false;
  }
}

function shouldUseSecureCookie(req: Request) {
  // HTTP localhost cannot store Secure cookies, even when NODE_ENV=production.
  return process.env.NODE_ENV === "production" && !isLocalTvRequest(req);
}

const DB_SETTING_KEYS = [
  "bb_settings_v6",
  "security",
  "tv",
  "tvPin",
  "settings",
  "app:settings",
] as const;

type PinRead = {
  pin: string;
  source: string;
};

type LoginInput = {
  pin: string;
  next: string;
};

function cleanPin(value: any) {
  return String(value ?? "").trim();
}

function safeNext(value: any) {
  const fallback = "/tv";
  const raw = String(value || "").trim();

  if (!raw.startsWith("/")) return fallback;
  if (raw.startsWith("//")) return fallback;
  if (raw.includes("://")) return fallback;

  return raw || fallback;
}

function isValidPinShape(value: string) {
  return /^\d{4,12}$/.test(value);
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) return false;

  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function maybeParseJson(value: any) {
  if (typeof value !== "string") return value;

  const text = value.trim();
  if (!text) return value;

  if (!text.startsWith("{") && !text.startsWith("[")) return value;

  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

/**
 * Bir Setting satırından yalnızca TV'ye ait PIN alanlarını okur.
 *
 * Özellikle `password` veya tek-parça ayarlardaki genel `pin` alanlarını
 * kabul etmiyoruz. Böylece admin/kurye gibi başka bir şifre yanlışlıkla
 * TV PIN'i seçilemez.
 */
function pickTvPinForSettingKey(key: string, value: any) {
  const parsed = maybeParseJson(value);

  if (key === "tvPin") {
    if (typeof parsed === "string" || typeof parsed === "number") {
      return cleanPin(parsed);
    }

    if (!isPlainObject(parsed)) return "";
    return cleanPin(parsed?.tvPin ?? parsed?.pin);
  }

  if (!isPlainObject(parsed)) return "";

  if (key === "security") {
    return cleanPin(
      parsed?.tvPin ??
        parsed?.tv?.pin ??
        parsed?.tv?.tvPin,
    );
  }

  if (key === "tv") {
    return cleanPin(parsed?.tvPin ?? parsed?.pin);
  }

  // Tam ayar kayıtlarında yalnızca açıkça TV'ye ait alanlar kabul edilir.
  return cleanPin(
    parsed?.security?.tvPin ??
      parsed?.security?.tv?.pin ??
      parsed?.security?.tv?.tvPin ??
      parsed?.tv?.tvPin ??
      parsed?.tv?.pin ??
      parsed?.tvPin,
  );
}

/**
 * DB'deki ana ayar kaydını deterministik biçimde seçer.
 *
 * - `bb_settings_v6` güncel ana kayıttır ve ilk önceliğe sahiptir.
 * - Aynı key ile eski duplicate satırlar varsa en son güncellenen satır alınır.
 * - Eski legacy key'ler yalnızca ana kayıtta TV PIN yoksa fallback olur.
 */
async function readDbPin(): Promise<PinRead | null> {
  try {
    const tenantId = await getTenantId();

    const rows = await prisma.setting.findMany({
      where: {
        tenantId,
        key: {
          in: [...DB_SETTING_KEYS],
        },
      },
      select: {
        key: true,
        value: true,
        updatedAt: true,
      },
      orderBy: [
        {
          updatedAt: "desc",
        },
        {
          key: "asc",
        },
      ],
    });

    const latestByKey = new Map<string, (typeof rows)[number]>();

    for (const row of rows) {
      if (!latestByKey.has(row.key)) {
        latestByKey.set(row.key, row);
      }
    }

    for (const key of DB_SETTING_KEYS) {
      const row = latestByKey.get(key);
      if (!row) continue;

      const pin = pickTvPinForSettingKey(key, row.value);

      if (pin) {
        return {
          pin,
          source: `db:setting.${key}`,
        };
      }
    }
  } catch (error) {
    console.error("[tv/login] DB PIN read failed:", error);
  }

  return null;
}

function addUniquePin(target: PinRead[], candidate: PinRead | null) {
  if (!candidate?.pin) return;
  if (!isValidPinShape(candidate.pin)) return;
  if (target.some((item) => item.pin === candidate.pin)) return;

  target.push(candidate);
}

/**
 * TV PIN policy:
 * - Canonical DB settings are preferred.
 * - TV_PIN is used only when the DB does not contain a valid TV PIN.
 * - No hard-coded development or localhost PIN is accepted.
 */
async function readAcceptedPins(_req: Request): Promise<PinRead[]> {
  const accepted: PinRead[] = [];
  const dbPin = await readDbPin();
  const envPin = cleanPin(process.env.TV_PIN);
  const envCandidate = envPin
    ? {
        pin: envPin,
        source: "env:TV_PIN",
      }
    : null;

  addUniquePin(accepted, dbPin || envCandidate);
  return accepted;
}

async function readInput(req: Request): Promise<LoginInput> {
  const contentType = req.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const body = await req.json().catch(() => ({} as any));

    return {
      pin: cleanPin(body?.pin ?? body?.tvPin ?? body?.code),
      next: safeNext(body?.next ?? body?.from),
    };
  }

  const form = await req.formData().catch(() => null);

  return {
    pin: cleanPin(form?.get("pin")),
    next: safeNext(form?.get("next") ?? form?.get("from")),
  };
}

function wantsJson(req: Request) {
  const contentType = req.headers.get("content-type") || "";
  const accept = req.headers.get("accept") || "";

  return contentType.includes("application/json") || accept.includes("application/json");
}

function clearTvCookies(req: Request, res: NextResponse) {
  const base = {
    sameSite: "lax" as const,
    secure: shouldUseSecureCookie(req),
    expires: new Date(0),
    path: "/",
  };

  res.cookies.set(AUTH_COOKIE, "", {
    ...base,
    httpOnly: true,
  });

  res.cookies.set(UI_COOKIE, "", {
    ...base,
    httpOnly: false,
  });

  return res;
}

async function setTvCookies(req: Request, res: NextResponse) {
  const expires = new Date(Date.now() + MAX_DAYS * 24 * 60 * 60 * 1000);

  const base = {
    sameSite: "lax" as const,
    secure: shouldUseSecureCookie(req),
    expires,
    path: "/",
  };

  const sessionToken = await createSessionToken("tv", MAX_DAYS * 24 * 60 * 60);

  res.cookies.set(AUTH_COOKIE, sessionToken, {
    ...base,
    httpOnly: true,
  });

  res.cookies.set(UI_COOKIE, "1", {
    ...base,
    httpOnly: false,
  });

  return res;
}

function redirectToLogin(req: Request, reason: string, next = "/tv") {
  const url = new URL("/tv/login", req.url);
  url.searchParams.set("err", "1");
  url.searchParams.set("reason", reason);
  url.searchParams.set("next", safeNext(next));

  const res = NextResponse.redirect(url, {
    status: 303,
  });

  return clearTvCookies(req, res);
}

function jsonError(req: Request, reason: string, status = 401) {
  const res = NextResponse.json(
    {
      ok: false,
      source: "tv-login",
      error: reason,
    },
    {
      status,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );

  return clearTvCookies(req, res);
}

async function jsonOk(req: Request, source: string, redirectTo: string) {
  const res = NextResponse.json(
    {
      ok: true,
      source: "tv-login",
      pinSource: source,
      redirectTo,
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    },
  );

  return await setTvCookies(req, res);
}

export async function POST(req: Request) {
  const rateError = await enforceRateLimit(req, "login:tv", 8, 15 * 60_000);
  if (rateError) return rateError;

  try {
    const input = await readInput(req);
    const enteredPin = input.pin;
    const next = input.next;

    const missingPin = !enteredPin;
    const invalidShape = enteredPin ? !isValidPinShape(enteredPin) : false;

    if (missingPin) {
      return wantsJson(req)
        ? jsonError(req, "missing_pin", 400)
        : redirectToLogin(req, "missing_pin", next);
    }

    if (invalidShape) {
      return wantsJson(req)
        ? jsonError(req, "invalid_pin", 401)
        : redirectToLogin(req, "invalid_pin", next);
    }

    const acceptedPins = await readAcceptedPins(req);
    const matched = acceptedPins.find((candidate) =>
      safeEqual(enteredPin, candidate.pin),
    );

    if (!acceptedPins.length) {
      return wantsJson(req)
        ? jsonError(req, "server_error", 500)
        : redirectToLogin(req, "server_error", next);
    }

    if (!matched) {
      return wantsJson(req)
        ? jsonError(req, "invalid_pin", 401)
        : redirectToLogin(req, "invalid_pin", next);
    }

    if (wantsJson(req)) {
      return jsonOk(req, matched.source, next);
    }

    const res = NextResponse.redirect(new URL(next, req.url), {
      status: 303,
    });

    return await setTvCookies(req, res);
  } catch (error) {
    console.error("[tv/login] POST failed:", error);

    return wantsJson(req)
      ? jsonError(req, "server_error", 500)
      : redirectToLogin(req, "server_error");
  }
}
