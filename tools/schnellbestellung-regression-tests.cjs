const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), "utf8");

const requiredFiles = [
  "app/schnellbestellung/page.tsx",
  "app/schnellbestellung/enter/page.tsx",
  "app/schnellbestellung/access-display/page.tsx",
  "app/api/schnellbestellung/access-token/route.ts",
  "app/api/schnellbestellung/orders/route.ts",
  "lib/server/schnellbestellung.ts",
];

for (const relativePath of requiredFiles) {
  assert(
    fs.existsSync(path.join(root, relativePath)),
    `missing ${relativePath}`,
  );
}

const core = read("lib/server/schnellbestellung.ts");
const accessRoute = read(
  "app/api/schnellbestellung/access-token/route.ts",
);
const accessDisplay = read(
  "app/schnellbestellung/access-display/page.tsx",
);
const client = read("components/schnellbestellung/SchnellClient.tsx");
const adminRoute = read("app/api/admin/schnellbestellung/route.ts");
const tvDomain = read("lib/tv/domain.ts");
const tvSoundHook = read("hooks/tv/use-tv-sound.ts");

assert(core.includes("Serializable"));
assert(core.includes('mode:"dine_in"'));
assert(core.includes('channel:"schnellbestellung"'));
assert(core.includes("idempotencyKey"));
assert(!client.includes("alert("));
assert(!client.includes("confirm("));

assert(
  tvDomain.includes("dine_in:"),
  "TV sound sources must include dine_in",
);
assert(
  tvDomain.includes('if (order.mode === "dine_in") return "dine_in"'),
  "dine-in orders must use the dine_in TV sound kind",
);
assert(
  tvDomain.includes('if (kind === "dine_in") return "Vor Ort"'),
  "dine-in TV sound title must be explicit",
);
assert(
  tvSoundHook.includes("dine_in: 0"),
  "TV sound source indexes must include dine_in",
);
assert(
  tvSoundHook.includes('["delivery", "pickup", "dine_in"]'),
  "new-order sound dispatch must include dine_in",
);

assert(
  adminRoute.includes('requireMutationRole(req, ["admin"])'),
  "admin PUT must pass an admin role array to requireMutationRole",
);
assert(
  !adminRoute.includes('requireMutationRole(req, "admin")'),
  "admin PUT must not pass a plain string to requireMutationRole",
);

assert(
  accessRoute.includes('unavailable("disabled")'),
  "access-token route must report disabled state",
);
assert(
  accessRoute.includes('unavailable("paused")'),
  "access-token route must reject paused state",
);
assert(
  accessRoute.includes('"configuration_missing"'),
  "access-token route must report missing session secret",
);
assert(
  accessRoute.includes("console.error"),
  "access-token failures must be logged server-side",
);

assert(
  accessDisplay.includes("Schnellbestellung ist noch nicht aktiviert"),
  "QR display must explain disabled state",
);
assert(
  accessDisplay.includes("Erneut versuchen"),
  "QR display must provide an inline retry action",
);
assert(
  accessDisplay.includes("Lokaler Test:"),
  "QR display must warn when localhost cannot be opened by a phone",
);
assert(
  !accessDisplay.includes("animate-pulse bg-stone-200"),
  "QR display must not remain on an endless blank skeleton",
);

console.log("schnellbestellung regression tests: OK");
