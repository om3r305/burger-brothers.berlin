import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "orders.json");

async function ensure() { await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {}); }
async function readSafe() {
  try { const raw = await fs.readFile(FILE, "utf8"); const js = JSON.parse(raw); return Array.isArray(js) ? js : []; }
  catch { return []; }
}

export async function GET() {
  await ensure();
  const items = await readSafe();
  return NextResponse.json({ ok: true, items });
}

export async function PUT(req: Request) {
  await ensure();
  try {
    const body = await req.json();
    const items = Array.isArray(body) ? body : (Array.isArray(body?.items) ? body.items : []);
    await fs.writeFile(FILE, JSON.stringify(items, null, 2), "utf8");
    return NextResponse.json({ ok: true, saved: items.length });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }
}
