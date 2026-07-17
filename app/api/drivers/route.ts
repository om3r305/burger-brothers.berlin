import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { createSessionToken } from "@/lib/server/session";
import {
  enforceRateLimit,
  forbiddenResponse,
  hasTrustedMutationOrigin,
  requireMutationRole,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const KEY = "drivers";
const DRIVER_COOKIE = "bb_driver_sess";

type DriverRole = "fahrer" | "admin";
type StoredDriver = {
  id: string;
  name: string;
  passwordHash: string;
  role: DriverRole;
};

function clean(value: any) {
  return String(value ?? "").trim();
}

function json(data: any, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function isScryptHash(value: string) {
  return /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/i.test(value);
}

function verifyPassword(password: string, encoded: string) {
  try {
    if (!isScryptHash(encoded)) return false;

    const [, salt, expected] = encoded.split("$");
    const actual = scryptSync(password, salt, 64);
    const target = Buffer.from(expected, "hex");

    return actual.length === target.length && timingSafeEqual(actual, target);
  } catch {
    return false;
  }
}

function normalizeStoredDrivers(value: any) {
  const list = Array.isArray(value)
    ? value
    : Array.isArray(value?.items)
      ? value.items
      : Array.isArray(value?.drivers)
        ? value.drivers
        : [];

  const drivers = new Map<string, StoredDriver>();
  let migratedPlaintext = false;

  for (const raw of list) {
    const id = clean(raw?.id || raw?.name);
    const name = clean(raw?.name);
    const role: DriverRole = raw?.role === "admin" ? "admin" : "fahrer";
    const storedHash = clean(raw?.passwordHash);
    const legacyPassword = clean(raw?.password ?? raw?.pin ?? raw?.code);

    if (!id || !name) continue;

    let passwordHash = isScryptHash(storedHash) ? storedHash : "";

    if (!passwordHash && legacyPassword) {
      passwordHash = hashPassword(legacyPassword);
      migratedPlaintext = true;
    }

    if (!passwordHash) continue;

    drivers.set(id, {
      id,
      name,
      passwordHash,
      role,
    });
  }

  return {
    items: Array.from(drivers.values()),
    migratedPlaintext,
  };
}

async function save(items: StoredDriver[]) {
  const tenantId = await getTenantId();

  await prisma.$transaction(async (tx: any) => {
    const existing = await tx.setting.findFirst({
      where: { tenantId, key: KEY },
      orderBy: { updatedAt: "desc" },
      select: { id: true },
    });

    if (existing?.id) {
      await tx.setting.update({
        where: { id: existing.id },
        data: { value: items as any },
      });

      await tx.setting.deleteMany({
        where: {
          tenantId,
          key: KEY,
          id: { not: existing.id },
        },
      });
      return;
    }

    await tx.setting.create({
      data: {
        tenantId,
        key: KEY,
        value: items as any,
      },
    });
  });
}

async function load(): Promise<StoredDriver[]> {
  const tenantId = await getTenantId();
  const row = await prisma.setting.findFirst({
    where: { tenantId, key: KEY },
    orderBy: { updatedAt: "desc" },
    select: { value: true },
  });
  const normalized = normalizeStoredDrivers(row?.value);

  // Eski düz şifreler ilk başarılı okumada kayıpsız biçimde scrypt'e çevrilir.
  if (normalized.migratedPlaintext) {
    await save(normalized.items);
  }

  return normalized.items;
}

function publicItems(items: StoredDriver[]) {
  return items.map(({ id, name, role }) => ({
    id,
    name,
    role,
    // Eski admin/driver tipleriyle uyumluluk; gerçek şifre veya hash dönmez.
    password: "",
  }));
}

export async function GET() {
  try {
    const items = publicItems(await load());
    return json({ ok: true, source: "db", items, drivers: items });
  } catch (error: any) {
    return json(
      { ok: false, error: error?.message || "DRIVERS_GET_FAILED" },
      500,
    );
  }
}

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) return forbiddenResponse("origin_not_allowed");

  const rateError = enforceRateLimit(req, "login:driver", 8, 15 * 60_000);
  if (rateError) return rateError;

  try {
    const body = await req.json().catch(() => ({}));

    if (body?.action !== "login") {
      return json({ ok: false, error: "unsupported_action" }, 400);
    }

    const name = clean(body?.name);
    const password = String(body?.password ?? "");
    const driver = (await load()).find((item: any) => item.name === name);

    if (!driver || !verifyPassword(password, driver.passwordHash)) {
      return json({ ok: false, error: "invalid_credentials" }, 401);
    }

    const remember = body?.remember === true;
    const maxAge = remember ? 60 * 60 * 24 * 30 : 60 * 60 * 12;
    const response = json({
      ok: true,
      driver: {
        id: driver.id,
        name: driver.name,
        role: driver.role,
        password: "",
      },
    });
    const token = await createSessionToken("driver", maxAge, driver.id);

    response.cookies.set(DRIVER_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      ...(remember ? { maxAge } : {}),
    });

    return response;
  } catch (error: any) {
    return json(
      { ok: false, error: error?.message || "DRIVER_LOGIN_FAILED" },
      500,
    );
  }
}

export async function PUT(req: Request) {
  const authError = await requireMutationRole(req, ["admin"]);
  if (authError) return authError;

  try {
    const body = await req.json().catch(() => ({}));
    const incoming = Array.isArray(body)
      ? body
      : Array.isArray(body?.items)
        ? body.items
        : Array.isArray(body?.drivers)
          ? body.drivers
          : [];
    const current = new Map((await load()).map((driver) => [driver.id, driver]));
    const next = new Map<string, StoredDriver>();

    for (const raw of incoming) {
      const id = clean(raw?.id || raw?.name);
      const name = clean(raw?.name);
      const password = String(raw?.password ?? raw?.pin ?? raw?.code ?? "").trim();
      const old = current.get(id);

      if (!id || !name) continue;

      const passwordHash = password
        ? hashPassword(password)
        : old?.passwordHash || "";

      if (!passwordHash) continue;

      next.set(id, {
        id,
        name,
        passwordHash,
        role: raw?.role === "admin" ? "admin" : "fahrer",
      });
    }

    const stored = Array.from(next.values());
    await save(stored);
    const items = publicItems(stored);

    return json({
      ok: true,
      source: "db",
      saved: items.length,
      items,
      drivers: items,
    });
  } catch (error: any) {
    return json(
      { ok: false, error: error?.message || "DRIVERS_PUT_FAILED" },
      500,
    );
  }
}

export async function DELETE(req: Request) {
  if (!hasTrustedMutationOrigin(req)) return forbiddenResponse("origin_not_allowed");

  const response = json({ ok: true });
  response.cookies.set(DRIVER_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
