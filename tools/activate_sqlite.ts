// tools/activate_sqlite.ts
/**
 * Usage:
 *   export DB_SQLITE_FILE=./.data/app.sqlite
 *   npm i better-sqlite3
 *   npx ts-node tools/activate_sqlite.ts
 * 
 * This will ensure the SQLite DB is initialized and migrate /data/*.json into it.
 */
import fs from "fs";
import path from "path";
import { DBA } from "@/lib/server/db";

async function main() {
  const file = process.env.DB_SQLITE_FILE || "./.data/app.sqlite";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // Touch file so driver creates DB
  fs.closeSync(fs.openSync(file, "a"));

  const dataDir = path.resolve(process.cwd(), "data");
  const keys = ["settings.json", "orders.json", "tracking.json"];
  for (const k of keys) {
    const p = path.join(dataDir, k);
    const fallback = k === "orders.json" ? [] : {};
    const src = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf-8")) : fallback;
    await DBA.write(k, src);
    console.log("migrated:", k, "(items:", Array.isArray(src) ? src.length : Object.keys(src).length, ")");
  }
  console.log("SQLite activation complete at", file);
}

main().catch((e) => { console.error(e); process.exit(1); });
