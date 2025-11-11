// app/api/brian/learn/route.ts
import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * Özellikler:
 * - Sokakları normalize + tekilleştirir
 * - JSONL olarak data/brian/learn_log.jsonl dosyasına ekler
 * - allowedHosts filtresi (sadece gerçek domainlerde öğren)
 * - UA/Host/IP’yi loglar
 * - Girdi sağlamlaştırma (maks. sokak sayısı/uzunluğu)
 * - Basit dosya rotasyonu (5 MB üstü -> .1)
 *
 * NOT: Vercel gibi serverless ortamlarda disk kalıcı değildir.
 * Kalıcı öğrenme istiyorsan KV/Postgres/Blob’a yazmak gerekir.
 */

const DATA_DIR = path.join(process.cwd(), "data", "brian");
const LOG_FILE = path.join(DATA_DIR, "learn_log.jsonl");

// .env’dan konfigurasyon (opsiyonel)
const ALLOWED_HOSTS =
  (process.env.BRIAN_ALLOWED_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

const FORCE_LEARN = (process.env.BRIAN_FORCE_LEARN || "").toLowerCase() === "on";
const MAX_STREETS = Number(process.env.BRIAN_MAX_STREETS || 20);
const MAX_STREET_LEN = Number(process.env.BRIAN_MAX_STREET_LEN || 120);
const ROTATE_BYTES = Number(process.env.BRIAN_ROTATE_BYTES || 5 * 1024 * 1024); // 5MB

// basit normalizer (unicode/diacritics/kısaltmalar/numara temizleme)
function normalizeStreet(s: string) {
  const x = (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, ""); // diacritics
  return x
    .split(",")[0]                 // "straße, berlin" -> "straße"
    .replace(/strasse/g, "straße") // Almanca varyant
    .replace(/\s+\d+[a-z]?\b/gi, "") // sondaki kapı noyu sil (12 / 12a)
    .replace(/\s+/g, " ")
    .trim();
}

function clampStreets(raw: any): string[] {
  const arr = Array.isArray(raw) ? raw : [];
  const cleaned = arr
    .map((s) => String(s || "").slice(0, MAX_STREET_LEN))
    .map(normalizeStreet)
    .filter(Boolean);
  // unique
  const uniq = Array.from(new Set(cleaned));
  // limit
  return uniq.slice(0, MAX_STREETS);
}

function hostAllowed(reqHost: string | null): boolean {
  if (FORCE_LEARN) return true; // test override
  if (!ALLOWED_HOSTS.length) return true; // ayarlanmamışsa serbest
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

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const mode: "pickup" | "delivery" =
      body?.mode === "pickup" || body?.mode === "delivery" ? body.mode : "delivery";

    // domain filtresi
    const reqHost = req.headers.get("host");
    if (!hostAllowed(reqHost)) {
      return NextResponse.json(
        { ok: false, error: "host_not_allowed", host: reqHost, allowed: ALLOWED_HOSTS },
        { status: 403 }
      );
    }

    // sokaklar
    const streets = clampStreets(body?.streets);
    if (streets.length < 1) {
      return NextResponse.json({ ok: false, error: "streets_required" }, { status: 400 });
    }

    // occurredAt
    let occurredAt: string;
    if (body?.occurredAt) {
      const d = new Date(body.occurredAt);
      occurredAt = isNaN(+d) ? new Date().toISOString() : d.toISOString();
    } else {
      occurredAt = new Date().toISOString();
    }

    // metadata
    const ua = req.headers.get("user-agent") || "";
    const ip =
      (req.headers.get("x-forwarded-for") || "")
        .split(",")[0]
        ?.trim() ||
      req.headers.get("x-real-ip") ||
      "";

    const entry = {
      occurredAt,
      mode,
      host: reqHost || "",
      ip,
      ua,
      streets,
    };

    // klasörü hazırla + rotasyon
    fs.mkdirSync(DATA_DIR, { recursive: true });
    rotateIfLarge();

    // yaz
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n", "utf8");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "fail" }, { status: 500 });
  }
}
