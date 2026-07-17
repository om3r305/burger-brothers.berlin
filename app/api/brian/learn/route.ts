// app/api/brian/learn/route.ts
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { prisma, getTenantId } from "@/lib/db";
import { enforceRateLimit, requireMutationRole } from "@/lib/server/request-security";

export const runtime = "nodejs";

const brianDb = prisma as any;

/**
 * Brian Learn API — DB-first
 *
 * Çalışma mantığı:
 * - Sokakları normalize + tekilleştirir
 * - Önce PostgreSQL / Prisma BrianLearnLog tablosuna yazar
 * - DB hata verirse eski JSONL dosyasına fallback yazar
 * - DB başarılı olursa JSONL backup sessiz denenir, hata verirse akışı bozmaz
 *
 * Önemli:
 * - Bu dosya çalışmadan önce schema.prisma içindeki BrianLearnLog modeli migrate edilmiş olmalı.
 */

const DATA_DIR = path.join(process.cwd(), "data", "brian");
const LOG_FILE = path.join(DATA_DIR, "learn_log.jsonl");

const ALLOWED_HOSTS =
  (process.env.BRIAN_ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const FORCE_LEARN = (process.env.BRIAN_FORCE_LEARN || "").toLowerCase() === "on";
const MAX_STREETS = Number(process.env.BRIAN_MAX_STREETS || 20);
const MAX_STREET_LEN = Number(process.env.BRIAN_MAX_STREET_LEN || 120);
const ROTATE_BYTES = Number(process.env.BRIAN_ROTATE_BYTES || 5 * 1024 * 1024);

function normalizeStreet(s: string) {
  const x = (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");

  return x
    .split(",")[0]
    .replace(/strasse/g, "straße")
    .replace(/\s+\d+[a-z]?\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function clampStreets(raw: any): string[] {
  const arr = Array.isArray(raw) ? raw : [];

  const cleaned = arr
    .map((s) => String(s || "").slice(0, MAX_STREET_LEN))
    .map(normalizeStreet)
    .filter(Boolean);

  return Array.from(new Set(cleaned)).slice(0, MAX_STREETS);
}

function hostAllowed(reqHost: string | null): boolean {
  if (FORCE_LEARN) return true;
  if (!ALLOWED_HOSTS.length) return true;

  const h = (reqHost || "").toLowerCase();
  return ALLOWED_HOSTS.includes(h);
}

function rotateIfLarge() {
  try {
    if (!fs.existsSync(LOG_FILE)) return;

    const st = fs.statSync(LOG_FILE);
    if (st.size >= ROTATE_BYTES) {
      const rotated = LOG_FILE.replace(/\.jsonl$/, `.1.jsonl`);

      try {
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
      } catch {}

      fs.renameSync(LOG_FILE, rotated);
    }
  } catch {}
}

function writeJsonlBackup(entry: Record<string, any>) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    rotateIfLarge();
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

function safeString(v: any, max = 180) {
  return String(v ?? "").trim().slice(0, max);
}

function parseOccurredAt(v: any) {
  if (!v) return new Date();

  const d = new Date(v);
  return isNaN(+d) ? new Date() : d;
}

function pickDriver(body: any) {
  const driver = body?.driver || body?.meta?.driver || {};

  return {
    driverId: safeString(
      body?.driverId ||
        body?.meta?.driverId ||
        driver?.id ||
        "",
      120
    ),
    driverName: safeString(
      body?.driverName ||
        body?.meta?.driverName ||
        driver?.name ||
        "",
      160
    ),
  };
}

export async function POST(req: Request) {
  const authError = await requireMutationRole(req, ["admin", "tv"]);
  if (authError) return authError;

  const rateError = await enforceRateLimit(req, "brian:learn", 30, 60_000);
  if (rateError) return rateError;

  const reqHost = req.headers.get("host");

  try {
    const body = await req.json().catch(() => ({}));

    if (!hostAllowed(reqHost)) {
      return NextResponse.json(
        {
          ok: false,
          error: "host_not_allowed",
          host: reqHost,
        },
        { status: 403 }
      );
    }

    const mode: "pickup" | "delivery" =
      body?.mode === "pickup" || body?.mode === "delivery"
        ? body.mode
        : "delivery";

    const streets = clampStreets(body?.streets);

    if (streets.length < 1) {
      return NextResponse.json(
        {
          ok: false,
          error: "streets_required",
        },
        { status: 400 }
      );
    }

    const occurredAtDate = parseOccurredAt(body?.occurredAt);
    const occurredAt = occurredAtDate.toISOString();

    const orderId = safeString(
      body?.orderId || body?.id || body?.order?.id || "",
      160
    );

    const source = safeString(body?.source || "brian_learn_api", 80);
    const status = safeString(body?.status || body?.orderStatus || "", 80);

    const { driverId, driverName } = pickDriver(body);

    const primaryStreet = normalizeStreet(
      body?.primaryStreet || body?.street || streets[0] || ""
    );

    const peerStreets = clampStreets(
      Array.isArray(body?.peerStreets)
        ? body.peerStreets
        : streets.filter((s) => s !== primaryStreet)
    );

    const entry = {
      occurredAt,
      mode,
      host: reqHost || "",
      orderId,
      driverId,
      driverName,
      primaryStreet,
      streets,
      peerStreets,
      status,
      source,
    };

    try {
      const tenantId = await getTenantId();

      const saved = await brianDb.brianLearnLog.create({
        data: {
          tenantId,
          orderId: orderId || null,
          driverId: driverId || null,
          driverName: driverName || null,
          primaryStreet: primaryStreet || null,
          streets,
          peerStreets,
          status: status || null,
          source,
          raw: entry,
          occurredAt: occurredAtDate,
        },
        select: {
          id: true,
          occurredAt: true,
        },
      });

      writeJsonlBackup(entry);

      return NextResponse.json({
        ok: true,
        storage: "db",
        id: saved.id,
        occurredAt: saved.occurredAt,
      });
    } catch (dbError: any) {
      console.error("❌ Brian learn DB write failed:", dbError);

      const fallbackOk = writeJsonlBackup({
        ...entry,
        dbError: dbError?.message || "db_write_failed",
      });

      if (fallbackOk) {
        return NextResponse.json({
          ok: true,
          storage: "file_fallback",
          warning: "db_write_failed",
          error: dbError?.message || "db_write_failed",
        });
      }

      return NextResponse.json(
        {
          ok: false,
          error: dbError?.message || "db_write_failed",
        },
        { status: 500 }
      );
    }
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.message || "fail",
      },
      { status: 500 }
    );
  }
}