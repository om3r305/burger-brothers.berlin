// app/api/tv/login/route.ts
import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { prisma, getTenantId } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const AUTH_COOKIE = "bb_tv_auth";
const UI_COOKIE = "bb_tv_ui";
const MAX_DAYS = 30;

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

function pickPinFromValue(value: any) {
  const parsed = maybeParseJson(value);

  if (typeof parsed === "string" || typeof parsed === "number") {
    return cleanPin(parsed);
  }

  if (!isPlainObject(parsed)) return "";

  const candidates = [
    parsed?.tvPin,
    parsed?.pin,
    parsed?.password,
    parsed?.tv?.pin,
    parsed?.tv?.tvPin,
    parsed?.security?.tvPin,
    parsed?.security?.pin,
    parsed?.security?.tv?.pin,
  ];

  const found = candidates.find((candidate) => cleanPin(candidate));
  return cleanPin(found);
}

async function readSettingValue(tenantId: string, key: string) {
  const row = await prisma.setting.findFirst({
    where: {
      tenantId,
      key,
    },
    select: {
      value: true,
    },
  });

  return row?.value ?? null;
}

async function readPin(): Promise<PinRead> {
  try {
    const tenantId = await getTenantId();

    const settingKeys = [
      "security",
      "tv",
      "settings",
      "bb_settings_v6",
      "app:settings",
      "tvPin",
    ];

    for (const key of settingKeys) {
      const value = await readSettingValue(tenantId, key);
      const pin = pickPinFromValue(value);

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

  const envPin = cleanPin(process.env.TV_PIN);

  if (envPin) {
    return {
      pin: envPin,
      source: "env:TV_PIN",
    };
  }

  if (process.env.NODE_ENV !== "production") {
    return {
      pin: "19051905",
      source: "dev:fallback",
    };
  }

  return {
    pin: "",
    source: "none",
  };
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

function clearTvCookies(res: NextResponse) {
  const base = {
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
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

function setTvCookies(res: NextResponse) {
  const expires = new Date(Date.now() + MAX_DAYS * 24 * 60 * 60 * 1000);

  const base = {
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    expires,
    path: "/",
  };

  res.cookies.set(AUTH_COOKIE, "1", {
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

  return clearTvCookies(res);
}

function jsonError(reason: string, status = 401) {
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

  return clearTvCookies(res);
}

function jsonOk(source: string, redirectTo: string) {
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

  return setTvCookies(res);
}

export async function POST(req: Request) {
  try {
    const input = await readInput(req);
    const enteredPin = input.pin;
    const next = input.next;

    const expected = await readPin();

    const missingPin = !enteredPin;
    const invalidShape = enteredPin ? !isValidPinShape(enteredPin) : false;
    const noExpectedPin = !expected.pin;

    const invalidPin =
      !missingPin &&
      !invalidShape &&
      (!expected.pin || !safeEqual(enteredPin, expected.pin));

    if (missingPin) {
      return wantsJson(req)
        ? jsonError("missing_pin", 400)
        : redirectToLogin(req, "missing_pin", next);
    }

    if (invalidShape || invalidPin || noExpectedPin) {
      const reason = noExpectedPin ? "server_error" : "invalid_pin";

      return wantsJson(req)
        ? jsonError(reason, noExpectedPin ? 500 : 401)
        : redirectToLogin(req, reason, next);
    }

    if (wantsJson(req)) {
      return jsonOk(expected.source, next);
    }

    const res = NextResponse.redirect(new URL(next, req.url), {
      status: 303,
    });

    return setTvCookies(res);
  } catch (error) {
    console.error("[tv/login] POST failed:", error);

    return wantsJson(req)
      ? jsonError("server_error", 500)
      : redirectToLogin(req, "server_error");
  }
}