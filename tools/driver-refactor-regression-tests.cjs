const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function exists(relative) {
  return fs.existsSync(path.join(root, relative));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const requiredFiles = [
  "app/driver/page.tsx",
  "app/driver/error.tsx",
  "components/DriverLiveTracker.tsx",
  "components/driver/DriverLogin.tsx",
  "components/driver/OrderWithDetails.tsx",
  "components/driver/TimeBadge.tsx",
  "components/driver/DriverConfirmDialog.tsx",
  "components/driver/DriverToastViewport.tsx",
  "hooks/driver/use-driver-auth.ts",
  "hooks/driver/use-driver-orders.ts",
  "hooks/driver/use-driver-settings.ts",
  "hooks/driver/use-driver-route.ts",
  "hooks/driver/use-pull-to-refresh.ts",
  "lib/driver/domain.ts",
  "types/driver.ts",
];

for (const file of requiredFiles) {
  assert(exists(file), `missing driver refactor file: ${file}`);
}

const page = read("app/driver/page.tsx");
const pageLines = page.split(/\r?\n/).length;

assert(
  pageLines <= 700,
  `DriverPage is still too large: ${pageLines} lines`,
);
assert(
  !/function\s+OrderWithDetails\s*\(/.test(page),
  "OrderWithDetails must not be declared inside DriverPage",
);
assert(
  !/function\s+TimeBadge\s*\(/.test(page),
  "TimeBadge must not be declared inside DriverPage",
);
assert(
  !/\breadSettings\s*\(/.test(page),
  "DriverPage must use useDriverSettings instead of direct readSettings",
);
assert(
  /useDriverOrders/.test(page) &&
    /useDriverAuth/.test(page) &&
    /useDriverSettings/.test(page),
  "DriverPage must delegate auth/orders/settings to hooks",
);
assert(
  /<DriverLiveTracker[\s\S]*active=\{liveTrackingActive\}/.test(page),
  "DriverLiveTracker must stay mounted and receive an active prop",
);

const scopeFiles = [
  "app/driver/page.tsx",
  "components/DriverLiveTracker.tsx",
  ...fs
    .readdirSync(path.join(root, "components/driver"))
    .filter((name) => name.endsWith(".tsx"))
    .map((name) => `components/driver/${name}`),
  ...fs
    .readdirSync(path.join(root, "hooks/driver"))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `hooks/driver/${name}`),
  "lib/driver/domain.ts",
  "types/driver.ts",
];

const scopeText = scopeFiles.map(read).join("\n");

assert(
  !/\balert\s*\(/.test(scopeText),
  "native alert() remains in driver refactor scope",
);
assert(
  !/\bwindow\.confirm\s*\(/.test(scopeText),
  "native window.confirm() remains in driver refactor scope",
);
assert(
  !/\bany\b/.test(scopeText),
  "driver refactor scope must not contain explicit any",
);

const types = read("types/driver.ts");
assert(
  /type\s+DriverIdentity\s*=\s*\{[\s\S]*?id:\s*string;[\s\S]*?name:\s*string;[\s\S]*?\}/.test(
    types,
  ),
  "DriverIdentity must contain id and name",
);
assert(
  !/type\s+DriverIdentity[\s\S]{0,180}\bpassword\b/.test(types),
  "DriverIdentity must never contain password",
);

const domain = read("lib/driver/domain.ts");
assert(
  /return\s+\{\s*id,\s*name:\s*driverName\s*\}/.test(domain),
  "authenticateDriver must return only id and name",
);
assert(
  /JSON\.stringify\(\s*\{\s*id:\s*driver\.id,\s*name:\s*driver\.name/.test(
    domain,
  ),
  "localStorage driver snapshot must contain only id and name",
);
assert(
  /routePriorityFromSettings/.test(domain) &&
    /storeOriginFromSettings/.test(domain),
  "route priority and store origin must be settings-first",
);

const tracker = read("components/DriverLiveTracker.tsx");
assert(
  /active:\s*boolean/.test(tracker) &&
    /driver:\s*DriverIdentity\s*\|\s*null/.test(tracker) &&
    /orderIds:\s*string\[\]/.test(tracker),
  "DriverLiveTracker must use controlled active/driver/orderIds props",
);
assert(
  !/fetchOrdersFromDb/.test(tracker),
  "DriverLiveTracker must not start a second order polling loop",
);
assert(
  /clearWatch/.test(tracker) &&
    /active:\s*false/.test(tracker),
  "DriverLiveTracker cleanup must stop GPS and close tracking",
);

const orders = read("hooks/driver/use-driver-orders.ts");
assert(
  /refreshSequenceRef/.test(orders),
  "driver order refresh must guard stale responses",
);
assert(
  /previousOrder\s*=\s*order/.test(orders) &&
    /String\(item\.id\)\s*===\s*id\s*\?\s*previousOrder/.test(orders),
  "finish rollback must restore the immutable previous order",
);
assert(
  /busyOrderIds/.test(orders),
  "driver mutations must expose per-order busy state",
);

const errorBoundary = read("app/driver/error.tsx");
assert(
  !/\{error\.(message|stack)\}/.test(errorBoundary) &&
    !/error\?\.stack/.test(errorBoundary),
  "driver error boundary must not expose stack or raw error message",
);
assert(
  /reset/.test(errorBoundary) && /location\.reload/.test(errorBoundary),
  "driver error boundary must provide retry and reload actions",
);

const settings = read("lib/settings.ts");
assert(
  /type\s+DriverUiSettings/.test(settings) &&
    /routePlzPriority/.test(settings) &&
    /activeUnknownGraceHours/.test(settings),
  "driver runtime settings must be represented in SettingsV6 defaults",
);

console.log("Driver refactor regression tests passed.");
