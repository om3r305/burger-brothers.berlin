// tools/project-doctor.mjs
import fs from "fs";
import path from "path";

function exists(p){ return fs.existsSync(p); }
function ok(x){ return x ? "✅" : "❌"; }

const checks = [];

// Temel lib dosyaları
const libs = [
  "lib/orders.ts",
  "lib/settings.ts",
  "lib/driver_runs.ts",
  "lib/device.ts",
];
checks.push(["lib/orders.ts", exists("lib/orders.ts")]);
checks.push(["lib/settings.ts", exists("lib/settings.ts")]);
checks.push(["lib/driver_runs.ts (şoför run’ları)", exists("lib/driver_runs.ts")]);
checks.push(["lib/device.ts (cihaz kaydı)", exists("lib/device.ts")]);

// TV, Dashboard, Tracking, Barcode, QR detail
const pages = [
  "app/tv/page.tsx",
  "app/dashboard/page.tsx",
  "app/track/page.tsx",
  "app/print/barcode/[id]/page.tsx",     // barcode/QR çıktısı
  "app/qr/[id]/page.tsx",                // sürücü QR detail (PIN + butonlar)
  "app/api/qr/[id]/route.ts",            // QR read-only API (opsiyonel)
];
for (const p of pages) checks.push([p, exists(p)]);

// Ses dosyaları
const sounds = [
  "public/sounds/apollo.mp3",
  "public/sounds/lifa.mp3",
];
for (const s of sounds) checks.push([s, exists(s)]);

// Ayarlarda gerekli alanlar
let settingsSample = "";
if (exists("lib/settings.ts")) {
  const t = fs.readFileSync("lib/settings.ts", "utf8");
  settingsSample = t.slice(0,5000);
}
const needs = [
  ["LS_SETTINGS v6+", /export\s+const\s+LS_SETTINGS/.test(settingsSample)],
  ["hours.avgPickupMinutes", /avgPickupMinutes/.test(settingsSample)],
  ["hours.avgDeliveryMinutes", /avgDeliveryMinutes/.test(settingsSample)],
  ["printing.showQR|showBarcode", /printing[^]*showQR[^]*showBarcode|showBarcode[^]*showQR/s.test(settingsSample)],
];

// Rapor
console.log("=== FILE PRESENCE ===");
for (const [name, okk] of checks) console.log(`${ok(okk)} ${name}`);

console.log("\n=== SETTINGS FIELDS ===");
for (const [label, found] of needs) console.log(`${ok(found)} ${label}`);

// Dinamik rota çakışması yeniden (özet)
console.log("\n=== DYNAMIC PARAM CONFLICTS (summary) ===");
const dynRx = /\[(.+?)\]/g;
const map = new Map();
function walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const p = path.join(dir, ent.name);
    const m = [...ent.name.matchAll(dynRx)].map(x => x[1]);
    const parent = path.dirname(p);
    if (m.length) {
      const key = parent.replaceAll("\\","/");
      const set = map.get(key) ?? new Set();
      m.forEach(s=>set.add(s));
      map.set(key,set);
    }
    walk(p);
  }
}
walk("app");
let conflict = false;
for (const [parent, set] of map.entries()) {
  if (set.size > 1) {
    conflict = true;
    console.log(`⚠️  ${parent}: ${[...set].join(", ")}`);
  }
}
if (!conflict) console.log("✅ None");

// Ek: muhtemel duplicate rota adaylarını bas
console.log("\n=== POSSIBLE DUPLICATE ROUTES (same level) ===");
function listDirs(dir) {
  if (!exists(dir)) return [];
  return fs.readdirSync(dir, {withFileTypes:true})
    .filter(d=>d.isDirectory())
    .map(d=>path.join(dir, d.name));
}
for (const base of ["app/order","app/orders","app/print","app/track","app/api"]) {
  if (!exists(base)) continue;
  const children = listDirs(base).map(p => path.basename(p)).filter(n=>/^\[.+\]$/.test(n));
  if (children.length > 1) console.log(`⚠️  ${base}: ${children.join(", ")}`);
}
