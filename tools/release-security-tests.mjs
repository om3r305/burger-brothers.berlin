import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const targetArg = process.argv[2] || "";
const failures = [];

const forbiddenNames = new Set([
  ".env",
  "bootstrap.json",
  "secrets.json",
]);
const forbiddenExtensions = new Set([
  ".pem",
  ".key",
  ".crt",
  ".cer",
  ".p12",
  ".pfx",
  ".db",
  ".sqlite",
  ".sqlite3",
  ".zip",
  ".zipchunk",
  ".log",
]);
const forbiddenSegments = new Set([
  ".git",
  ".next",
  "node_modules",
  "data",
  ".burger-brothers-fallback-snapshots",
]);

function normalizedRelative(base, full) {
  return path.relative(base, full).split(path.sep).join("/");
}

function isForbidden(relative) {
  const normalized = relative.replaceAll("\\", "/").replace(/^\/+/, "");
  const lower = normalized.toLowerCase();
  const segments = lower.split("/");
  const name = segments.at(-1) || "";
  const extension = path.extname(name);

  if (name === ".env.example") return false;
  if (forbiddenNames.has(name) || name.startsWith(".env.")) return true;
  if (forbiddenExtensions.has(extension)) return true;
  if (segments.some((segment) => forbiddenSegments.has(segment))) return true;
  if (lower === "print-agent/config.json") return true;
  if (lower === "print-proxy/config.json" || lower === "print-proxy/.env") return true;
  if (name.startsWith("package-lock.json.registry-backup-")) return true;
  return false;
}

function walk(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

if (!targetArg) {
  const releaseScript = path.join(root, "tools", "create-secure-release.ps1");
  if (!fs.existsSync(releaseScript)) failures.push("secure release script missing");

  const ignored = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
  for (const marker of [
    ".env",
    "*.pem",
    "*.key",
    "*.db",
    ".next",
    "node_modules",
    ".burger-brothers-fallback-snapshots",
  ]) {
    if (!ignored.includes(marker)) failures.push(`.gitignore missing ${marker}`);
  }
} else {
  const target = path.resolve(root, targetArg);
  if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
    failures.push(`release directory missing: ${target}`);
  } else {
    const files = walk(target);

    for (const full of files) {
      const relative = normalizedRelative(target, full);
      if (isForbidden(relative)) failures.push(`forbidden release file: ${relative}`);

      const extension = path.extname(relative).toLowerCase();
      if (![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".txt", ".ps1", ".prisma", ".env"].includes(extension)) {
        continue;
      }

      const content = fs.readFileSync(full, "utf8");
      const secretPatterns = [
        /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
        /\bsk_live_[A-Za-z0-9]{16,}\b/,
        /\brk_live_[A-Za-z0-9]{16,}\b/,
        /\bwhsec_[A-Za-z0-9]{16,}\b/,
        /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/,
      ];

      if (secretPatterns.some((pattern) => pattern.test(content))) {
        failures.push(`probable secret in release file: ${relative}`);
      }
    }
  }
}

if (failures.length) {
  console.error("RELEASE SECURITY TESTS FAILED\n- " + failures.join("\n- "));
  process.exit(1);
}

console.log(
  targetArg
    ? "Release directory secret scan passed."
    : "Secure release policy tests passed.",
);
