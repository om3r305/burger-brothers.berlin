// tools/migrate_json_to_db.ts
/**
 * Run with: ts-node tools/migrate_json_to_db.ts
 * Copies /data/*.json into DBA (Prisma/SQLite/JSON).
 */
import fs from "fs";
import path from "path";
import { DBA } from "@/lib/server/db";

async function main() {
  const dataDir = path.resolve(process.cwd(), "data");
  const files = ["orders.json", "settings.json", "tracking.json"];
  for (const f of files) {
    const p = path.join(dataDir, f);
    if (fs.existsSync(p)) {
      const content = JSON.parse(fs.readFileSync(p, "utf-8"));
      await DBA.write(f, content);
      console.log("migrated:", f);
    } else {
      console.log("skip (not found):", f);
    }
  }
  console.log("done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
