const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();

const files = {
  dynamic: path.join(root, "app", "showcase", "[screen]", "page.tsx"),
  main: path.join(root, "app", "showcase", "page.tsx"),
  layout: path.join(root, "app", "showcase", "layout.tsx"),
  player: path.join(root, "components", "showcase", "ShowcasePlayer.tsx"),
  api: path.join(root, "app", "api", "showcase", "route.ts"),
};

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

for (const [name, file] of Object.entries(files)) {
  if (!fs.existsSync(file)) fail(`${name} dosyasi bulunamadi: ${file}`);
}

const dynamic = fs.readFileSync(files.dynamic, "utf8");
const main = fs.readFileSync(files.main, "utf8");
const player = fs.readFileSync(files.player, "utf8");
const api = fs.readFileSync(files.api, "utf8");

for (const token of [
  'import ShowcasePlayer from "@/components/showcase/ShowcasePlayer"',
  "params: Promise<{ screen: string }>",
  "screenSlug={screen}",
]) {
  if (!dynamic.includes(token)) fail(`Dinamik route token eksik: ${token}`);
}

if (!main.includes('screenSlug="main"')) {
  fail("/showcase ana route'u main ekranina sabitlenmemis.");
}

if (!player.includes('screenSlug = "main"')) {
  fail("ShowcasePlayer screenSlug destegi bulunamadi.");
}

if (!api.includes('searchParams.get("screen") || "main"')) {
  fail("Showcase API screen query destegi bulunamadi.");
}

console.log("PASS: /showcase ve /showcase/[screen] route baglantilari dogrulandi.");
