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
  "components/driver/DriverMapChooserDialog.tsx",
  "components/driver/OrderWithDetails.tsx",
  "components/driver/TimeBadge.tsx",
  "components/driver/DriverConfirmDialog.tsx",
  "components/driver/DriverToastViewport.tsx",
  "hooks/driver/use-driver-auth.ts",
  "hooks/driver/use-driver-map-preference.ts",
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

const orderDetails = read(
  "components/driver/OrderWithDetails.tsx",
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
assert(
  /finish:[\s\S]{0,260}text-white/.test(domain) &&
    !/finish:[\s\S]{0,260}text-black/.test(domain),
  "Fertig button must use a high-contrast light label",
);
assert(
  /after:absolute/.test(domain) &&
    /ring-offset-stone-950/.test(domain) &&
    /opacity-75/.test(domain),
  "active and inactive driver tabs must be visually distinct",
);
assert(
  /actionButtonClass\("finish"\)/.test(orderDetails),
  "OrderWithDetails must keep the shared finish-button variant",
);

const routeHook = read("hooks/driver/use-driver-route.ts");
const mapPreferenceHook = read(
  "hooks/driver/use-driver-map-preference.ts",
);
const mapChooser = read(
  "components/driver/DriverMapChooserDialog.tsx",
);
const routeBar = read("components/driver/DriverRouteBar.tsx");

assert(
  /useDriverMapPreference/.test(page) &&
    /<DriverMapChooserDialog/.test(page),
  "DriverPage must use the remembered map-app chooser",
);
assert(
  !/openExternalMap/.test(page),
  "DriverPage must not bypass the selected map provider",
);
assert(
  /DRIVER_MAP_PREFERENCE_KEY/.test(domain) &&
    /bb_driver_map_preference_v1/.test(domain),
  "map preference must use a dedicated device-local key",
);
assert(
  /localStorage\.getItem\(DRIVER_MAP_PREFERENCE_KEY\)/.test(
    mapPreferenceHook,
  ) &&
    /localStorage\.setItem\(DRIVER_MAP_PREFERENCE_KEY,\s*provider\)/.test(
      mapPreferenceHook,
    ),
  "selected map provider must be loaded and saved on the device",
);
assert(
  /buildGoogleMapsPreviewUrl/.test(domain) &&
    /buildAppleMapsPreviewUrl/.test(domain) &&
    /buildSystemMapPreviewUrl/.test(domain),
  "Google, Apple, and Android system map preview builders must exist",
);
assert(
  !/dir_action/.test(domain),
  "map URLs must not auto-start navigation with dir_action",
);
assert(
  !/google\.navigation:/.test(domain),
  "Android Google navigation deep link must not auto-start navigation",
);
assert(
  !/params\.set\("origin"/.test(domain),
  "route origin must remain omitted so current device location is used",
);
assert(
  /params\.append\("waypoint",\s*waypoint\)/.test(domain),
  "Apple Maps multi-stop preview must preserve intermediate stops",
);
assert(
  /params\.set\("waypoints",\s*waypoints\.join\("\|"\)\)/.test(
    domain,
  ),
  "Google Maps multi-stop preview must preserve intermediate stops",
);
assert(
  /openRoute:\s*\(/.test(routeHook) &&
    /return openRoute\(selectedOrders,\s*routePlzPriority\)/.test(
      routeHook,
    ),
  "useDriverRoute must delegate opening to the selected map provider",
);
assert(
  /Die Route wird nur als Vorschau geöffnet/.test(mapChooser) &&
    /Navigation startet/.test(mapChooser),
  "map chooser must explain that navigation starts only after driver action",
);
assert(
  /Karten-App:/.test(routeBar) &&
    /Ausgewählte Route öffnen/.test(routeBar),
  "route bar must allow changing the remembered map app and open a preview",
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
  /orderDriver\(order\)/.test(page) &&
    /normalizeStatus\(order\.status\)\s*===\s*"out_for_delivery"/.test(
      page,
    ),
  "live tracking must start only for exact server-confirmed driver assignments",
);
assert(
  /ASSIGNMENT_RETRY_DELAYS_MS/.test(tracker) &&
    /ASSIGNMENT_WARNING_AFTER_MS/.test(tracker),
  "temporary assignment propagation errors must use bounded silent retries",
);
assert(
  /requestLifecycle\s*!==\s*lifecycleRef\.current/.test(tracker) &&
    /!activeRef\.current/.test(tracker),
  "stale tracking requests must not surface errors after tracking is disabled",
);
assert(
  !/Trackingfehler:\s*\$\{/.test(tracker),
  "raw tracking error codes must not be shown directly to drivers",
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
