// app/api/admin/coupons/route.ts
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type CouponKind = "coupons" | "issued";

const ADMIN_COOKIE = process.env.ADMIN_COOKIE_NAME || "bb_admin_sess";

function getCookie(req: Request, name: string) {
  const cookie = req.headers.get("cookie") || "";

  for (const part of cookie.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("=") || "");
  }

  return "";
}

function hasAdminSession(req: Request) {
  return getCookie(req, ADMIN_COOKIE).startsWith("ok:");
}

function requireAdmin(req: Request) {
  if (hasAdminSession(req)) return null;

  return jsonResponse(
    {
      ok: false,
      source: "db",
      error: "not_authenticated",
      message: "Nicht angemeldet.",
    },
    401,
  );
}

function cleanText(value: any, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function cleanCode(value: any) {
  return cleanText(value, "").toUpperCase();
}

function bool(value: any, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;

  const text = String(value).toLowerCase().trim();

  if (["1", "true", "yes", "ja", "on"].includes(text)) return true;
  if (["0", "false", "no", "nein", "off"].includes(text)) return false;

  return fallback;
}

function toDate(value: any): Date | null {
  if (!value && value !== 0) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value : null;
  }

  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isFinite(date.valueOf()) ? date : null;
  }

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return null;

    const asNumber = Number(text);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      const byNumber = new Date(asNumber);
      if (Number.isFinite(byNumber.valueOf())) return byNumber;
    }

    const parsed = new Date(text);
    if (Number.isFinite(parsed.valueOf())) return parsed;
  }

  return null;
}

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeKey(key: string) {
  if (!key) return false;
  if (key === "__proto__") return false;
  if (key === "prototype") return false;
  if (key === "constructor") return false;
  return true;
}

function sanitizeJson(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;

  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value.toISOString() : null;
  }

  if (value instanceof Prisma.Decimal) {
    return value.toNumber();
  }

  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return null;

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeJson(item));
  }

  if (isPlainObject(value)) {
    const out: Record<string, any> = {};

    for (const [key, item] of Object.entries(value)) {
      if (!isSafeKey(key)) continue;
      if (item === undefined) continue;

      out[key] = sanitizeJson(item);
    }

    return out;
  }

  return value;
}

function jsonForDb(value: any): Prisma.InputJsonValue {
  const cleaned = sanitizeJson(value);

  if (cleaned === null) {
    return {} as Prisma.InputJsonValue;
  }

  return cleaned as Prisma.InputJsonValue;
}

function readItems(body: any) {
  return Array.isArray(body?.items)
    ? body.items
    : Array.isArray(body?.coupons)
      ? body.coupons
      : Array.isArray(body?.issued)
        ? body.issued
        : body?.item
          ? [body.item]
          : [];
}

function readKind(body: any): CouponKind {
  return body?.kind === "issued" ? "issued" : "coupons";
}

function serializeCoupon(row: any) {
  return {
    ...row,
    code: cleanCode(row?.code),
    definition: sanitizeJson(row?.definition),
    createdAt: row?.createdAt instanceof Date ? row.createdAt.toISOString() : row?.createdAt,
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : row?.updatedAt,
  };
}

function serializeIssuedCoupon(row: any) {
  return {
    ...row,
    code: cleanCode(row?.code),
    couponCode: cleanCode(row?.couponCode),
    issuedAt: row?.issuedAt instanceof Date ? row.issuedAt.toISOString() : row?.issuedAt,
    expiresAt: row?.expiresAt instanceof Date ? row.expiresAt.toISOString() : row?.expiresAt,
    usedAt: row?.usedAt instanceof Date ? row.usedAt.toISOString() : row?.usedAt,
    createdAt: row?.createdAt instanceof Date ? row.createdAt.toISOString() : row?.createdAt,
    updatedAt: row?.updatedAt instanceof Date ? row.updatedAt.toISOString() : row?.updatedAt,
  };
}

async function saveCoupon(tx: any, tenantId: string, raw: any) {
  const code = cleanCode(raw?.code);
  if (!code) return null;

  const definition = jsonForDb(raw?.definition ?? raw);

  const existing = await tx.coupon.findFirst({
    where: {
      tenantId,
      code,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.coupon.update({
      where: {
        id: existing.id,
      },
      data: {
        definition: definition as any,
      },
    });

    await tx.coupon.deleteMany({
      where: {
        tenantId,
        code,
        id: {
          not: existing.id,
        },
      },
    });

    return code;
  }

  await tx.coupon.create({
    data: {
      tenantId,
      code,
      definition: definition as any,
    },
  });

  return code;
}

async function saveIssuedCoupon(tx: any, tenantId: string, raw: any) {
  const code = cleanCode(raw?.code);
  if (!code) return null;

  const couponId = cleanText(raw?.couponId, "");
  const couponCode = cleanCode(raw?.couponCode || raw?.baseCode);

  const data = {
    couponId,
    couponCode,
    assignedToPhone: raw?.assignedToPhone ? String(raw.assignedToPhone) : null,
    assignedToEmail: raw?.assignedToEmail ? String(raw.assignedToEmail) : null,
    issuedAt: toDate(raw?.issuedAt) || new Date(),
    expiresAt: toDate(raw?.expiresAt),
    used: bool(raw?.used, false),
    usedAt: toDate(raw?.usedAt),
    source: raw?.source ? String(raw.source) : null,
    note: raw?.note ? String(raw.note) : null,
  };

  const existing = await tx.issuedCoupon.findFirst({
    where: {
      tenantId,
      code,
    },
    select: {
      id: true,
    },
  });

  if (existing?.id) {
    await tx.issuedCoupon.update({
      where: {
        id: existing.id,
      },
      data,
    });

    await tx.issuedCoupon.deleteMany({
      where: {
        tenantId,
        code,
        id: {
          not: existing.id,
        },
      },
    });

    return code;
  }

  await tx.issuedCoupon.create({
    data: {
      tenantId,
      code,
      ...data,
      couponId: data.couponId || "",
      couponCode: data.couponCode || "",
    },
  });

  return code;
}

function jsonResponse(payload: Record<string, any>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}

function errorResponse(error: any, fallback: string, status = 500) {
  return jsonResponse(
    {
      ok: false,
      source: "db",
      error: error?.message || fallback,
    },
    status
  );
}

export async function GET(req: Request) {
  const auth = requireAdmin(req);
  if (auth) return auth;

  try {
    const tenantId = await getTenantId();
    const url = new URL(req.url);
    const includeIssued = url.searchParams.get("includeIssued") === "1";

    const couponsRaw = await prisma.coupon.findMany({
      where: {
        tenantId,
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const coupons = couponsRaw.map(serializeCoupon);

    if (!includeIssued) {
      return jsonResponse({
        ok: true,
        source: "db",
        coupons,
        items: coupons,
        count: coupons.length,
      });
    }

    const issuedRaw = await prisma.issuedCoupon.findMany({
      where: {
        tenantId,
      },
      orderBy: {
        issuedAt: "desc",
      },
    });

    const issued = issuedRaw.map(serializeIssuedCoupon);

    return jsonResponse({
      ok: true,
      source: "db",
      coupons,
      issued,
      items: coupons,
      counts: {
        coupons: coupons.length,
        issued: issued.length,
      },
    });
  } catch (error: any) {
    return errorResponse(error, "COUPONS_GET_FAILED");
  }
}

/**
 * POST supports:
 * - { kind: "coupons", items: [...] }  -> save coupon definitions by code
 * - { kind: "issued", items: [...] }   -> save issued coupons by code
 * - { replace: true, kind, items }     -> replace list, delete missing only if list is not empty
 */
export async function POST(req: Request) {
  const auth = requireAdmin(req);
  if (auth) return auth;

  try {
    const tenantId = await getTenantId();
    const body = await req.json().catch(() => ({} as any));
    const replace = body?.replace === true;
    const kind = readKind(body);
    const items = readItems(body);

    if (kind === "coupons") {
      const codes: string[] = [];

      await prisma.$transaction(async (tx) => {
        for (const raw of items) {
          const code = await saveCoupon(tx, tenantId, raw);
          if (code) codes.push(code);
        }

        if (replace && items.length > 0 && codes.length > 0) {
          await tx.coupon.deleteMany({
            where: {
              tenantId,
              code: {
                notIn: codes,
              },
            },
          });
        }
      });

      return jsonResponse({
        ok: true,
        source: "db",
        kind,
        saved: codes.length,
        codes,
      });
    }

    const issuedCodes: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const raw of items) {
        const code = await saveIssuedCoupon(tx, tenantId, raw);
        if (code) issuedCodes.push(code);
      }

      if (replace && items.length > 0 && issuedCodes.length > 0) {
        await tx.issuedCoupon.deleteMany({
          where: {
            tenantId,
            code: {
              notIn: issuedCodes,
            },
          },
        });
      }
    });

    return jsonResponse({
      ok: true,
      source: "db",
      kind,
      saved: issuedCodes.length,
      codes: issuedCodes,
    });
  } catch (error: any) {
    return errorResponse(error, "COUPONS_POST_FAILED");
  }
}

export async function PUT(req: Request) {
  return POST(req);
}

export async function DELETE(req: Request) {
  const auth = requireAdmin(req);
  if (auth) return auth;

  try {
    const tenantId = await getTenantId();
    const { searchParams } = new URL(req.url);

    const code = cleanCode(searchParams.get("code"));
    const kind = searchParams.get("kind");

    if (!code) {
      return jsonResponse(
        {
          ok: false,
          source: "db",
          error: "missing_code",
        },
        400
      );
    }

    if (kind === "issued") {
      await prisma.issuedCoupon.deleteMany({
        where: {
          tenantId,
          code,
        },
      });
    } else {
      await prisma.coupon.deleteMany({
        where: {
          tenantId,
          code,
        },
      });
    }

    return jsonResponse({
      ok: true,
      source: "db",
    });
  } catch (error: any) {
    return errorResponse(error, "COUPONS_DELETE_FAILED");
  }
}