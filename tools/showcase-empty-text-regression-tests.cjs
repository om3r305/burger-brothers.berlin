const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

function transpile(file, compilerOptions = {}) {
  const source = read(file);
  const result = ts.transpileModule(source, {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
      ...compilerOptions,
    },
  });

  const errors = (result.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert(
    errors.length === 0,
    `${file} syntax error: ${errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      .join(" | ")}`,
  );

  return result.outputText;
}

function loadShowcaseConfig() {
  const output = transpile("lib/showcase/config.ts");
  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require(request) {
      if (request === "./runtime") {
        return { normalizeShowcaseCategory(value) { return String(value || "").trim().toLowerCase(); } };
      }
      if (request === "./editor") {
        return { canonicalSceneType(value) {
          return ({ "review-qr": "qr", "social-video": "video", countdown: "campaign", "special-day": "message" })[value] || value;
        } };
      }
      if (request === "./presets") {
        return { specialDayPresetIsActive() { return true; } };
      }
      throw new Error(`Unexpected require in showcase config test: ${request}`);
    },
    console,
    URL,
    Date,
    Math,
    Set,
    Map,
    Array,
    Object,
    Number,
    String,
    Boolean,
  };

  vm.runInNewContext(output, sandbox, {
    filename: "lib/showcase/config.js",
  });

  return module.exports;
}

for (const file of [
  "lib/showcase/config.ts",
  "components/showcase/ShowcaseStage.tsx",
  "app/admin/showcase/page.tsx",
]) {
  transpile(file);
}

const config = loadShowcaseConfig();

const scene = config.normalizeShowcaseScene({
  id: "blank-copy",
  type: "video",
  name: "Blank",
  enabled: true,
  durationSeconds: 15,
  transition: "fade",
  title: "",
  subtitle: "",
  body: "",
  badge: "",
  qrLabel: "",
});

for (const key of ["title", "subtitle", "body", "badge", "qrLabel"]) {
  assert(
    scene[key] === "",
    `Explicit blank scene field must remain blank: ${key}`,
  );
}

const document = config.normalizeShowcaseDocument({
  schemaVersion: 1,
  version: "test",
  enabled: true,
  updatedAt: new Date().toISOString(),
  settings: {
    name: "Test",
    defaultDurationSeconds: 45,
    refreshSeconds: 3,
    showClock: true,
    showProgress: true,
    showConnectionState: false,
    qrUrl: "https://www.burger-brothers.berlin/menu",
    qrLabel: "",
    ticker: "",
    background: "black",
  },
  scenes: [scene],
});

assert(document.settings.ticker === "", "Blank ticker must remain blank");
assert(document.settings.qrLabel === "", "Blank global QR label must remain blank");

const stage = read("components/showcase/ShowcaseStage.tsx");
for (const forbidden of [
  'scene.title || "JETZT ONLINE BESTELLEN"',
  'scene.subtitle || "QR-Code scannen und direkt zur Speisekarte"',
  'scene.title || product?.name || "Frisch für Sie zubereitet"',
  'scene.body || "Jetzt online bestellen"',
  'scene.title || "UNSERE SPEISEKARTE"',
  'scene.badge || campaign?.badgeText || "LIMITIERTE AKTION"',
  'scene.title || snapshot.branding.shopName',
  'title || (hasCustomCopy ? null : "WICHTIGE MITTEILUNG")',
]) {
  assert(!stage.includes(forbidden), `Display fallback still exists: ${forbidden}`);
}

assert(
  stage.includes(
    "{visibleLabel ? <div className={styles.qrLabel}>{visibleLabel}</div> : null}",
  ),
  "Blank QR label must not render an empty/default label",
);
assert(
  stage.includes(
    "{snapshot.document.settings.ticker ? (",
  ),
  "Ticker visibility guard must remain present",
);

const admin = read("app/admin/showcase/page.tsx") + read("components/showcase/admin/SceneBasicsEditor.tsx") + read("components/showcase/admin/ShowcasePreviewSidebar.tsx");
assert(
  admin.includes("Boş bırakırsan ekranda başlık gösterilmez."),
  "Admin title blank behavior hint is missing",
);
assert(
  admin.includes("Boş bırakırsan kayan yazı tamamen gizlenir."),
  "Admin ticker blank behavior hint is missing",
);
assert(
  admin.includes("Boş bırakırsan QR kodunun altında açıklama gösterilmez."),
  "Admin QR label blank behavior hint is missing",
);

console.log("Showcase boş metin regresyon testleri geçti.");
