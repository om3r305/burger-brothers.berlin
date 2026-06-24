// app/api/catalog/route.ts
import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE_PRODUCTS = path.join(DATA_DIR, "products.json");
const FILE_CAMPAIGNS = path.join(DATA_DIR, "campaigns.json");

async function ensureFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(FILE_PRODUCTS); } catch {
    await fs.writeFile(FILE_PRODUCTS, JSON.stringify([], null, 2), "utf-8");
  }
  try { await fs.access(FILE_CAMPAIGNS); } catch {
    await fs.writeFile(FILE_CAMPAIGNS, JSON.stringify([], null, 2), "utf-8");
  }
}

export async function GET() {
  await ensureFiles();
  const [pRaw, cRaw] = await Promise.all([
    fs.readFile(FILE_PRODUCTS, "utf-8"),
    fs.readFile(FILE_CAMPAIGNS, "utf-8"),
  ]);
  const products = JSON.parse(pRaw || "[]");
  const campaigns = JSON.parse(cRaw || "[]");
  return NextResponse.json({ products, campaigns });
}

export async function PUT(req: Request) {
  await ensureFiles();
  const body = await req.json().catch(() => ({}));
  const products = Array.isArray(body?.products) ? body.products : [];
  const campaigns = Array.isArray(body?.campaigns) ? body.campaigns : [];
  await Promise.all([
    fs.writeFile(FILE_PRODUCTS, JSON.stringify(products, null, 2), "utf-8"),
    fs.writeFile(FILE_CAMPAIGNS, JSON.stringify(campaigns, null, 2), "utf-8"),
  ]);
  return NextResponse.json({ products, campaigns });
}
