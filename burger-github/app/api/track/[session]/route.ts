import { NextResponse } from "next/server";
import { DBA } from "@/lib/server/db";
import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "tracking.json");

type TrackPoint = { lat: number; lng: number; ts: number; speed?: number; heading?: number };
type Session = {
  id: string;
  createdAt: number;
  active: boolean;
  last?: TrackPoint;
  history: TrackPoint[];
  orders: string[];        // order ids attached
  driverId?: string;       // optional device/driver id
};

type DB = {
  sessions: Record<string, Session>;
  orderToSession: Record<string, string>; // orderId -> sessionId (latest)
};

async function ensureFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try { await fs.access(FILE); }
  catch {
    const init: DB = { sessions: {}, orderToSession: {} };
    await fs.writeFile(FILE, JSON.stringify(init, null, 2), "utf-8");
  }
}

async function readDB(): Promise<DB> {
  await ensureFile();
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    return JSON.parse(raw || "{}");
  } catch {
    return { sessions: {}, orderToSession: {} };
  }
}

async function writeDB(db: DB) {
  await fs.writeFile(FILE, JSON.stringify(db, null, 2), "utf-8");
}

export async function GET(_: Request, { params }: { params: { session: string } }) {
  const { session } = params;
  const db = await readDB();
  const s = db.sessions[session];
  if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(s);
}

export async function POST(req: Request, { params }: { params: { session: string } }) {
  const { session } = params;
  const body = await req.json().catch(() => ({} as any));
  const { lat, lng, speed, heading, orderIds, driverId, active } = body || {};
  if (typeof lat !== "number" || typeof lng !== "number") {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const now = Date.now();
  const db = await readDB();
  const prev = db.sessions[session];
  const point: TrackPoint = { lat, lng, ts: now };
  if (typeof speed === "number") point.speed = speed;
  if (typeof heading === "number") point.heading = heading;

  const s: Session = prev || {
    id: session,
    createdAt: now,
    active: true,
    history: [],
    orders: [],
  };
  s.last = point;
  s.active = active === false ? false : true;
  if (driverId && !s.driverId) s.driverId = String(driverId);
  // keep last 200 points
  s.history.push(point);
  if (s.history.length > 200) s.history = s.history.slice(-200);

  if (Array.isArray(orderIds)) {
    for (const oid of orderIds.map(String)) {
      if (!s.orders.includes(oid)) s.orders.push(oid);
      db.orderToSession[oid] = session;
    }
  }

  db.sessions[session] = s;
  await writeDB(db);
  return NextResponse.json({ ok: true });
}
