import { NextResponse } from "next/server";
import { currentMode, usingSQLite } from "@/lib/server/db";
import fs from "fs";

export async function GET() {
  const mode = currentMode();
  const info: any = { mode };
  if (mode === "sqlite") {
    info.sqliteFile = process.env.DB_SQLITE_FILE || "./.data/app.sqlite";
    try { info.sqliteExists = fs.existsSync(info.sqliteFile); } catch { info.sqliteExists = false; }
  }
  if (mode === "prisma") {
    info.databaseUrl = process.env.DATABASE_URL ? "set" : "missing";
  }
  return NextResponse.json(info);
}
