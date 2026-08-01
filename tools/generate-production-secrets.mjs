#!/usr/bin/env node
import { randomBytes } from "node:crypto";

const secret = (bytes = 32) => randomBytes(bytes).toString("base64url");

const output = {
  SESSION_SECRET: secret(),
  BOOTSTRAP_MIGRATION_TOKEN: secret(),
  CRON_SECRET: secret(),
  ANALYTICS_IP_SECRET: secret(),
  PAYMENT_FINALIZE_SECRET: secret(),
  PAYMENT_SHARE_SECRET: secret(),
  PRINT_AGENT_TOKEN: secret(),
  PRINT_PROXY_TOKEN: secret(),
  BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
};

for (const [name, value] of Object.entries(output)) {
  console.log(`${name}=${value}`);
}

console.error(
  "\nBu değerleri yalnız Vercel/yerel secret store'a kaydedin; ZIP veya GitHub'a eklemeyin.",
);
