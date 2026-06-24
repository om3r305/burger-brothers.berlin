// tools/db_health.ts
import { currentMode } from "@/lib/server/db";

async function main() {
  console.log("mode:", currentMode());
  console.log("DB_SQLITE_FILE:", process.env.DB_SQLITE_FILE || "(not set)");
  console.log("DATABASE_URL:", process.env.DATABASE_URL ? "(set)" : "(not set)");
}
main();
