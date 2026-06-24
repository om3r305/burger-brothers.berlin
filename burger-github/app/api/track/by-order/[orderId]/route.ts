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
  orders: string[];
  driverId?: string;
};

type DB = {
  sessions: Record<string, Session>;
  orderToSession: Record<string, string>;
};

async function readDB(): Promise<DB> {
  try {
    const raw = await fs.readFile(FILE, "utf-8");
    return JSON.parse(raw || "{}");
  } catch {
    return { sessions: {}, orderToSession: {} };
  }
}

export async function GET(_: Request, { params }: { params: { orderId: string } }) {
  const { orderId } = params;
  const db = await readDB();
  const sid = db.orderToSession[orderId];
  if (!sid) return NextResponse.json({ error: "no_session" }, { status: 404 });
  const s = db.sessions[sid];
  if (!s) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ sessionId: sid, session: s });
}
