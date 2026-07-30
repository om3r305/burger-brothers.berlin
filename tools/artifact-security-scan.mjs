import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || ".");
const failures = [];
const ignoredDirs = new Set(["node_modules", ".next", ".git"]);
const forbiddenNames = [
  /(^|\/)\.env$/i,
  /\.(db|sqlite|sqlite3|rar|7z|zip)$/i,
  /\.(bak|backup|old|orig)(-|$|\.)/i,
  /(^|\/)bootstrap\.json$/i,
  /(^|\/)print-(agent|proxy)\/config\.json$/i,
  /(^|\/)\.burger-brothers-fallback-snapshots(\/|$)/i,
  /(^|\/)\.showcase-empty-text-backups(\/|$)/i,
  /(^|\/)public\/middleware\.ts$/i,
];
const secretPatterns = [
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
  /\bwhsec_[A-Za-z0-9]{16,}\b/,
  /\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(root, absolute).split(path.sep).join("/");
    if (forbiddenNames.some((pattern) => pattern.test(relative))) {
      failures.push(`yasak dosya: ${relative}`);
      continue;
    }
    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }
    if (!entry.isFile() || entry.name.endsWith(".map")) continue;
    const stat = fs.statSync(absolute);
    if (stat.size > 2_000_000) continue;
    const sample = fs.readFileSync(absolute);
    if (sample.includes(0)) continue;
    const text = sample.toString("utf8");
    for (const pattern of secretPatterns) {
      if (pattern.test(text)) {
        failures.push(`secret kalıbı: ${relative}`);
        break;
      }
    }
  }
}

if (!fs.existsSync(path.join(root, "middleware.ts"))) {
  failures.push("kök middleware.ts eksik");
}
walk(root);

if (failures.length) {
  for (const failure of failures) console.error(`[artifact] HATA ${failure}`);
  process.exit(1);
}
console.log("[artifact] Dosya/secret/artifact güvenlik taraması temiz.");
