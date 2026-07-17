// app/api/print/test/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

import { NextResponse } from "next/server";
import net from "net";
import { enforceRateLimit, requireMutationRole, securityJson } from "@/lib/server/request-security";

/* ───────── Defaults ───────── */
const DEFAULT_PRINTER_IP = process.env.PRINT_PRINTER_IP?.trim() || "192.168.0.150";
const DEFAULT_PRINTER_PORT = Number(process.env.PRINT_PRINTER_PORT || 9100);

const DEFAULT_PROXY =
  process.env.PRINT_PROXY_URL?.trim() || "https://www.burger-brothers.berlin";

const SOCKET_TIMEOUT_MS = Number(process.env.PRINT_SOCKET_TIMEOUT_MS || 5000);

const DIRECT_ENABLED =
  process.env.PRINT_DIRECT_ENABLED === "1" ||
  String(process.env.PRINT_DIRECT_ENABLED || "").toLowerCase() === "true" ||
  process.env.NODE_ENV !== "production";

const ALLOW_PROXY_OVERRIDE =
  process.env.PRINT_TEST_ALLOW_PROXY_OVERRIDE === "1" ||
  String(process.env.PRINT_TEST_ALLOW_PROXY_OVERRIDE || "").toLowerCase() === "true" ||
  process.env.NODE_ENV !== "production";

const ALLOW_ANY_PRINTER_IP =
  process.env.PRINT_TEST_ALLOW_ANY_PRINTER_IP === "1" ||
  String(process.env.PRINT_TEST_ALLOW_ANY_PRINTER_IP || "").toLowerCase() === "true" ||
  process.env.NODE_ENV !== "production";

const ALLOWED_PROXY_ORIGINS = new Set(
  [DEFAULT_PROXY, ...String(process.env.PRINT_TEST_ALLOWED_PROXY_ORIGINS || "").split(",")]
    .map((value) => {
      try { return new URL(String(value || "").trim()).origin; } catch { return ""; }
    })
    .filter(Boolean),
);

const ALLOWED_CORS_ORIGINS = String(process.env.PRINT_CORS_ORIGINS || "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

/* ───────── Types ───────── */
type PrintMode = "proxy" | "direct";
type PrintType = "text" | "barcode";

type PrintInput = {
  mode: PrintMode;
  type: PrintType;
  proxyBase: string;
  ip: string;
  port: number;
  text: string;
  code: string;
};

/* ───────── CORS / response helpers ───────── */
function isLocalhost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isAllowedOrigin(origin: string | null, req: Request) {
  if (!origin) return true;

  try {
    const requestUrl = new URL(req.url);
    const originUrl = new URL(origin);

    if (originUrl.origin === requestUrl.origin) return true;
    if (process.env.NODE_ENV !== "production" && isLocalhost(originUrl.hostname)) return true;

    return ALLOWED_CORS_ORIGINS.includes(originUrl.origin);
  } catch {
    return false;
  }
}

function withCORS(res: NextResponse, req: Request) {
  const origin = req.headers.get("origin");

  if (isAllowedOrigin(origin, req)) {
    res.headers.set("Access-Control-Allow-Origin", origin || "*");
  }

  res.headers.set("Vary", "Origin");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, X-Requested-With");
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");

  return res;
}

function json(req: Request, payload: Record<string, any>, status = 200) {
  return withCORS(NextResponse.json(payload, { status }), req);
}

function errorJson(req: Request, error: any, status = 500) {
  return json(
    req,
    {
      ok: false,
      error: String(error?.message || error || "PRINT_TEST_FAILED"),
    },
    status,
  );
}

/* ───────── Validators ───────── */
function cleanText(value: any, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function cleanCode(value: any) {
  const code = String(value || "")
    .trim()
    .replace(/[^\x20-\x7E]/g, "")
    .slice(0, 64);

  return code || "0000";
}

function normalizeMode(value: any): PrintMode {
  return String(value || "").toLowerCase().trim() === "direct" ? "direct" : "proxy";
}

function normalizeType(value: any): PrintType {
  return String(value || "").toLowerCase().trim() === "barcode" ? "barcode" : "text";
}

function normalizePort(value: any) {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return DEFAULT_PRINTER_PORT;
  }

  return port;
}

function normalizeProxyBase(value: any) {
  const raw = cleanText(value, DEFAULT_PROXY);

  try {
    const url = new URL(raw);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return DEFAULT_PROXY;
    }

    if (process.env.NODE_ENV === "production" && !ALLOWED_PROXY_ORIGINS.has(url.origin)) {
      return DEFAULT_PROXY;
    }

    return url.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_PROXY;
  }
}

function validateDirectTarget(ip: string, port: number) {
  if (!DIRECT_ENABLED) {
    throw new Error("Direct print mode is disabled. Set PRINT_DIRECT_ENABLED=true.");
  }

  if (!net.isIP(ip)) {
    throw new Error(`Invalid printer IP: ${ip}`);
  }

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid printer port: ${port}`);
  }

  if (!ALLOW_ANY_PRINTER_IP && ip !== DEFAULT_PRINTER_IP) {
    throw new Error("Printer IP override is disabled.");
  }
}

async function readInput(req: Request): Promise<PrintInput> {
  const url = new URL(req.url);
  const q = url.searchParams;

  let mode = normalizeMode(q.get("mode"));
  let type = normalizeType(q.get("type"));
  let proxyBase = normalizeProxyBase(DEFAULT_PROXY);

  if (ALLOW_PROXY_OVERRIDE && q.get("proxy")) {
    proxyBase = normalizeProxyBase(q.get("proxy"));
  }

  let ip = cleanText(q.get("ip"), DEFAULT_PRINTER_IP);
  let port = normalizePort(q.get("port") || DEFAULT_PRINTER_PORT);
  let text = cleanText(q.get("text"), "Burger Brothers • TEST");
  let code = cleanCode(q.get("code") || q.get("orderId") || "0000");

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({} as any));

    mode = normalizeMode(body?.mode ?? mode);
    type = normalizeType(body?.type ?? type);

    if (ALLOW_PROXY_OVERRIDE && body?.proxy) {
      proxyBase = normalizeProxyBase(body.proxy);
    }

    if (body?.ip) ip = cleanText(body.ip, ip);
    if (body?.port) port = normalizePort(body.port);
    if (body?.text) text = cleanText(body.text, text);
    if (body?.code || body?.orderId) code = cleanCode(body.code || body.orderId);
  }

  return {
    mode,
    type,
    proxyBase,
    ip,
    port,
    text,
    code,
  };
}

/* ───────── Public handlers ───────── */
export async function OPTIONS(req: Request) {
  return json(req, { ok: true, preflight: true }, 200);
}

export async function GET(req: Request) {
  const authError = await requireMutationRole(req, ["admin", "tv"]);
  if (authError) return authError;
  return json(req, { ok: false, error: "method_not_allowed", message: "Use POST for print tests." }, 405);
}

export async function POST(req: Request) {
  return handle(req);
}

/* ───────── Core ───────── */
async function handle(req: Request) {
  const authError = await requireMutationRole(req, ["admin", "tv"]);
  if (authError) return authError;

  const rateError = await enforceRateLimit(req, "print:test", 10, 60_000);
  if (rateError) return rateError;

  const production = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
  const enabled = String(process.env.PRINT_TEST_ENABLED || "").toLowerCase();
  if (production && !["1", "true", "yes", "on"].includes(enabled)) {
    return securityJson({ ok: false, error: "print_test_disabled" }, 404);
  }

  try {
    const input = await readInput(req);

    if (input.mode === "proxy") {
      const endpoint =
        input.type === "barcode"
          ? `${input.proxyBase}/print/barcode`
          : `${input.proxyBase}/print/text`;

      const payload =
        input.type === "barcode"
          ? {
              code: input.code,
              orderId: input.code,
            }
          : {
              text: input.text,
              lines: [input.text],
            };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), SOCKET_TIMEOUT_MS);

      try {
        const resp = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-print-proxy-token":
              process.env.PRINT_PROXY_TOKEN ||
              process.env.PRINT_AGENT_TOKEN ||
              "",
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!resp.ok) {
          const message = await resp.text().catch(() => "");
          throw new Error(`Proxy ${resp.status}: ${message}`);
        }
      } finally {
        clearTimeout(timeout);
      }

      return json(req, {
        ok: true,
        via: "proxy",
        endpoint,
        type: input.type,
        code: input.code,
        text: input.text,
      });
    }

    validateDirectTarget(input.ip, input.port);

    await sendEscPos({
      ip: input.ip,
      port: input.port,
      type: input.type,
      code: input.code,
      text: input.text,
    });

    return json(req, {
      ok: true,
      via: "direct",
      ip: input.ip,
      port: input.port,
      type: input.type,
      code: input.code,
      text: input.text,
    });
  } catch (error: any) {
    return errorJson(req, error, 500);
  }
}

/* ───────── ESC/POS helpers ───────── */
function pushText(bytes: number[], text: string) {
  bytes.push(...Buffer.from(text, "utf8"));
}

function buildEscPos(input: { type: PrintType; text: string; code: string }) {
  const ESC = 0x1b;
  const GS = 0x1d;
  const bytes: number[] = [];

  bytes.push(ESC, 0x40); // init

  bytes.push(ESC, 0x61, 0x01); // center
  bytes.push(ESC, 0x45, 0x01); // bold on
  pushText(bytes, "*** TEST DRUCK ***\n");
  bytes.push(ESC, 0x45, 0x00); // bold off

  bytes.push(ESC, 0x61, 0x00); // left
  pushText(bytes, "Burger Brothers\n");
  pushText(bytes, new Date().toLocaleString("de-DE") + "\n");
  pushText(bytes, "------------------------------\n");

  if (input.type === "barcode") {
    const safeCode = cleanCode(input.code);
    pushText(bytes, `Barcode: ${safeCode}\n\n`);

    const barcodeData = Buffer.from(`{B${safeCode}`, "ascii");

    bytes.push(GS, 0x48, 0x02); // HRI below barcode
    bytes.push(GS, 0x68, 0x64); // barcode height
    bytes.push(GS, 0x77, 0x02); // barcode width
    bytes.push(GS, 0x6b, 0x49, barcodeData.length); // CODE128
    bytes.push(...barcodeData);
    pushText(bytes, "\n");
  } else {
    pushText(bytes, input.text + "\n");
  }

  pushText(bytes, "\n\n");
  bytes.push(GS, 0x56, 0x01); // partial cut

  return Buffer.from(bytes);
}

function sendEscPos(input: {
  ip: string;
  port: number;
  type: PrintType;
  code: string;
  text: string;
}) {
  return new Promise<void>((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (error?: Error) => {
      if (settled) return;
      settled = true;

      try {
        socket.destroy();
      } catch {}

      if (error) reject(error);
      else resolve();
    };

    socket.setTimeout(SOCKET_TIMEOUT_MS);

    socket.once("error", (error) => done(error));
    socket.once("timeout", () => done(new Error("Printer socket timeout")));
    socket.once("close", () => done());

    socket.connect(input.port, input.ip, () => {
      socket.write(buildEscPos(input), (error) => {
        if (error) {
          done(error);
          return;
        }

        socket.end();
      });
    });
  });
}