import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const failures = [];
const forbiddenFiles = [
  ".env",
  "localhost-key.pem",
  "localhost.pem",
  "prisma/dev.db",
  "prisma/data/burger.db",
  "print-proxy/.env",
];

let trackedFiles = [];

try {
  trackedFiles = execFileSync("git", ["ls-files"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .split(/\r?\n/)
    .filter(Boolean);
} catch {
  trackedFiles = [];
}

const forbiddenTrackedFiles = trackedFiles.filter((file) => {
  const normalized = file.replaceAll("\\", "/").toLowerCase();

  return (
    forbiddenFiles.includes(normalized) ||
    normalized === ".env" ||
    (normalized.startsWith(".env.") && normalized !== ".env.example") ||
    normalized.endsWith(".pem") ||
    normalized.endsWith(".key") ||
    normalized.endsWith(".p12") ||
    normalized.endsWith(".pfx") ||
    normalized.endsWith(".crt") ||
    normalized.endsWith(".db") ||
    normalized.endsWith(".sqlite") ||
    normalized.endsWith(".sqlite3")
  );
});

for (const file of forbiddenTrackedFiles) {
  failures.push(`forbidden file tracked by git: ${file}`);
}

const ignored = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
for (const pattern of [".env", "*.pem", "*.key", "*.db", "print-agent/config.json", "print-proxy/config.json"]) {
  if (!ignored.includes(pattern)) failures.push(`.gitignore missing: ${pattern}`);
}

const middleware = fs.readFileSync(path.join(root, "middleware.ts"), "utf8");
if (!middleware.includes('verifySessionToken')) failures.push("middleware does not verify signed sessions");
if (!middleware.includes('/api/admin')) failures.push("admin APIs are not middleware-protected");
if (!middleware.includes('bb_driver_sess') || !middleware.includes('/api/orders/list')) failures.push("operational order APIs are not session-protected");

const drivers = fs.readFileSync(path.join(root, "app/api/drivers/route.ts"), "utf8");
if (!drivers.includes('scryptSync')) failures.push("driver passwords are not scrypt hashed");
if (/password:\s*clean\(/.test(drivers)) failures.push("driver plaintext password persistence detected");
if (!drivers.includes('requireMutationRole') || !drivers.includes('export async function PUT(req: Request)')) failures.push("driver management PUT is not admin-session protected");
if (!drivers.includes('migratedPlaintext') || !drivers.includes('legacyPassword')) failures.push("legacy driver plaintext password migration missing");
if (!drivers.includes('createSessionToken("driver"') || !drivers.includes('DRIVER_COOKIE')) failures.push("signed driver session cookie missing");

const settings = fs.readFileSync(path.join(root, "app/api/settings/route.ts"), "utf8");
if (!settings.includes('publicSettingsView')) failures.push("public settings redaction missing");
if (!settings.includes('verifySessionToken')) failures.push("settings route does not verify signed sessions");
if (/function\s+hasAdminSession[\s\S]{0,1200}startsWith\("ok:"\)/.test(settings)) failures.push("settings route still accepts an unsigned admin cookie");
if (/function\s+hasTvSession[\s\S]{0,1200}(value\s*===\s*"1"|startsWith\("ok:"\))/.test(settings)) failures.push("settings route still accepts an unsigned TV cookie");


const tvLogin = fs.readFileSync(path.join(root, "app/api/tv/login/route.ts"), "utf8");
const tvPinPolicyPath = path.join(root, "lib/server/tv-pin-policy.ts");
const tvPinPolicy = fs.existsSync(tvPinPolicyPath)
  ? fs.readFileSync(tvPinPolicyPath, "utf8")
  : "";

if (!tvLogin.includes('LOCAL_DEV_FALLBACK_PIN = "19051905"')) {
  failures.push("local TV fallback PIN missing");
}

const usesSharedTvPinPolicy =
  tvLogin.includes("mayUseLocalTvPinFallback(req)");

const usesInlineTvPinPolicy =
  tvLogin.includes("isLocalTvRequest(req)") &&
  tvLogin.includes("process.env.VERCEL") &&
  tvLogin.includes('hostname === "localhost"') &&
  tvLogin.includes('hostname === "127.0.0.1"');

if (!usesSharedTvPinPolicy && !usesInlineTvPinPolicy) {
  failures.push("TV login does not apply request-aware local fallback policy");
}

if (usesSharedTvPinPolicy) {
  if (!tvPinPolicy.includes('nodeEnv !== "production"')) {
    failures.push("TV PIN development policy missing");
  }

  if (!tvPinPolicy.includes("isLoopbackTvHost")) {
    failures.push("TV PIN localhost production policy missing");
  }

  if (!tvPinPolicy.includes("process.env.VERCEL")) {
    failures.push("TV PIN fallback is not blocked on Vercel");
  }
}
if (!tvLogin.includes('"bb_settings_v6"')) failures.push("TV PIN does not prioritize the canonical DB settings record");
if (!tvLogin.includes('updatedAt: "desc"')) failures.push("TV PIN duplicate settings are not resolved by latest update");
if (/parsed\?\.password/.test(tvLogin)) failures.push("TV login still accepts a generic password field as TV PIN");
if (/parsed\?\.pin\s*[,)]/.test(tvLogin) && !tvLogin.includes('key === "tv"') && !tvLogin.includes('key === "tvPin"')) failures.push("TV login still accepts a generic top-level PIN from whole settings");

const paymentPrepare = fs.readFileSync(path.join(root, "app/api/payments/prepare/route.ts"), "utf8");
const orderPricing = fs.readFileSync(path.join(root, "lib/server/order-pricing.ts"), "utf8");
if (!paymentPrepare.includes("rebuildOrderPricingFromDatabase")) failures.push("Stripe prepare route does not rebuild prices from DB");
if (/const\s+payableCents\s*=\s*toCents\(order\?\.total\)/.test(paymentPrepare)) failures.push("Stripe still trusts the submitted order total");
if (!paymentPrepare.includes("items: rebuiltPricing.items")) failures.push("Stripe pending order does not persist canonical DB items");
if (!orderPricing.includes("prisma.product.findMany")) failures.push("DB catalog product lookup missing");
if (!orderPricing.includes("CATALOG_EXTRA_NOT_FOUND")) failures.push("DB extra validation missing");
if (!orderPricing.includes("ORDER_PRICE_CHANGED")) failures.push("submitted/canonical price mismatch protection missing");

if (failures.length) {
  console.error("SECURITY TESTS FAILED\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Security tests passed.");
