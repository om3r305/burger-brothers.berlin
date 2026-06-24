// app/api/print/test/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import net from "net";

/* ───────── Defaults ───────── */
const DEFAULT_PRINTER_IP = "192.168.0.150";
const DEFAULT_PRINTER_PORT = 9100;

// Varsayılan print-proxy URL (localhost’ta çalışan)
const DEFAULT_PROXY =
  process.env.PRINT_PROXY_URL?.trim() || "https://www.burger-brothers.berlin";

/* ───────── CORS helper ───────── */
function withCORS(res: NextResponse, req: Request) {
  const origin = req.headers.get("origin") || "*";
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Vary", "Origin");
  res.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, X-Requested-With"
  );
  res.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  return res;
}

/* ───────── Public handlers ───────── */
export async function OPTIONS(req: Request) {
  return withCORS(
    NextResponse.json({ ok: true, preflight: true }, { status: 200 }),
    req
  );
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

/* ───────── Core ───────── */
async function handle(req: Request) {
  try {
    // Ortak inputları topla
    const url = new URL(req.url);
    const q = url.searchParams;

    // mode: 'proxy' | 'direct'  (default: 'proxy')
    let mode =
      (q.get("mode") as "proxy" | "direct" | null) || ("proxy" as const);

    // type: 'text' | 'barcode' (default: 'text')
    let type = (q.get("type") as "text" | "barcode" | null) || "text";

    // proxy base
    let proxyBase = q.get("proxy") || DEFAULT_PROXY;

    // ESC/POS raw için ip/port ve text
    let ip = q.get("ip") || DEFAULT_PRINTER_IP;
    let port = Number(q.get("port") || DEFAULT_PRINTER_PORT);
    let text = q.get("text") || "Burger Brothers • TEST";

    // barcode için code/orderId
    let code = q.get("code") || q.get("orderId") || "0000";

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({} as any));
      if (body?.mode) mode = body.mode === "direct" ? "direct" : "proxy";
      if (body?.type) type = body.type === "barcode" ? "barcode" : "text";
      if (body?.proxy) proxyBase = String(body.proxy);

      if (body?.ip) ip = String(body.ip);
      if (body?.port) port = Number(body.port);
      if (body?.text) text = String(body.text);
      if (body?.code || body?.orderId) code = String(body.code || body.orderId);
    }

    if (mode === "proxy") {
      // print-proxy’ye yönlendir
      const endpoint =
        type === "barcode"
          ? `${proxyBase.replace(/\/+$/, "")}/print/barcode`
          : `${proxyBase.replace(/\/+$/, "")}/print/text`;

      // Gövde: text için lines/text, barcode için code/orderId.
      const payload =
        type === "barcode"
          ? { code, orderId: code }
          : { lines: [text] };

      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!resp.ok) {
        const msg = await resp.text().catch(() => "");
        throw new Error(`proxy ${resp.status}: ${msg}`);
      }

      const out = NextResponse.json(
        { ok: true, via: "proxy", endpoint, type, code, text },
        { status: 200 }
      );
      return withCORS(out, req);
    }

    // mode === 'direct' → yazıcıya raw ESC/POS gönder (sadece hızlı test için)
    await sendEscPos(ip, port, type === "barcode" ? `#${code}` : text);
    const out = NextResponse.json(
      { ok: true, via: "direct", ip, port, type, code, text },
      { status: 200 }
    );
    return withCORS(out, req);
  } catch (err: any) {
    const out = NextResponse.json(
      { ok: false, error: String(err?.message || err) },
      { status: 500 }
    );
    return out;
  }
}

/* ───────── ESC/POS helpers (direct mode) ───────── */
function buildEscPos(text: string) {
  const ESC = 0x1b;
  const GS = 0x1d;
  const enc = new TextEncoder();
  const bytes: number[] = [];

  // init
  bytes.push(ESC, 0x40);
  // center title
  bytes.push(ESC, 0x61, 0x01);
  bytes.push(...enc.encode("*** TEST DRUCK ***\n"));
  // left
  bytes.push(ESC, 0x61, 0x00);
  bytes.push(...enc.encode(text + "\n"));
  // space + partial cut
  bytes.push(...enc.encode("\n\n"));
  bytes.push(GS, 0x56, 0x01);

  return Buffer.from(bytes);
}

function sendEscPos(ip: string, port: number, text: string) {
  return new Promise<void>((resolve, reject) => {
    const sock = new net.Socket();
    sock.setTimeout(5000);
    sock.once("error", reject);
    sock.once("timeout", () => {
      sock.destroy();
      reject(new Error("socket timeout"));
    });
    sock.connect(port, ip, () => {
      sock.write(buildEscPos(text));
      sock.end();
      resolve();
    });
  });
}
