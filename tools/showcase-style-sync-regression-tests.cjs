const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const cssPath = path.join(root, "components", "showcase", "ShowcaseStage.module.css");
const stagePath = path.join(root, "components", "showcase", "ShowcaseStage.tsx");

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(cssPath)) fail(`CSS bulunamadi: ${cssPath}`);
if (!fs.existsSync(stagePath)) fail(`ShowcaseStage bulunamadi: ${stagePath}`);

const css = fs.readFileSync(cssPath, "utf8");
const stage = fs.readFileSync(stagePath, "utf8");

const requiredCss = [
  ".premiumScene",
  ".premiumEyebrow",
  ".weatherScene h1",
  ".weatherEmoji",
  ".reviewScene",
  ".reviewQrScene",
  ".countdown",
  ".bestsellerScene",
  ".specialScene",
  ".special_winter",
  ".special_halloween",
  ".special_christmas",
  "@container",
  "@container (max-aspect-ratio: 4/5)",
];

for (const token of requiredCss) {
  if (!css.includes(token)) fail(`CSS selector/marker eksik: ${token}`);
}

const requiredStage = [
  'import styles from "./ShowcaseStage.module.css"',
  "styles.premiumScene",
  "styles.weatherScene",
  "styles.specialScene",
  "styles.premiumEyebrow",
];

for (const token of requiredStage) {
  if (!stage.includes(token)) fail(`ShowcaseStage baglantisi eksik: ${token}`);
}

if (css.length < 45000) {
  fail(`CSS beklenenden kisa (${css.length} karakter). Eski/kirik dosya olabilir.`);
}

console.log("PASS: Showcase premium CSS ve renderer baglantilari dogrulandi.");
