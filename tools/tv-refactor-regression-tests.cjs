const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function exists(relative) {
  assert.ok(fs.existsSync(path.join(root, relative)), `Missing ${relative}`);
}

const requiredFiles = [
  "app/tv/page.tsx",
  "app/tv/error.tsx",
  "app/tv/tv.css",
  "types/tv.ts",
  "lib/tv/domain.ts",
  "hooks/tv/use-tv-orders.ts",
  "hooks/tv/use-tv-sound.ts",
  "hooks/tv/use-tv-clock.ts",
  "hooks/tv/use-tv-settings.ts",
  "hooks/tv/use-tv-brian.ts",
  "hooks/tv/use-tv-print.ts",
  "components/tv/OrderCard.tsx",
  "components/tv/AcceptOrderOverlay.tsx",
  "components/tv/OrderDetailsModal.tsx",
  "components/tv/TvConfirmDialog.tsx",
  "components/tv/TvToastViewport.tsx",
];

requiredFiles.forEach(exists);

const page = read("app/tv/page.tsx");
const pageLines = page.split(/\r?\n/).length;

assert.ok(pageLines <= 900, `TV page is still too large: ${pageLines} lines`);
assert.ok(!/\balert\s*\(/.test(page), "TV page still uses alert()");
assert.ok(!/\bconfirm\s*\(/.test(page), "TV page still uses native confirm()");
assert.ok(!/<style\s+jsx/.test(page), "TV page still contains styled-jsx");
assert.ok(page.includes('import "./tv.css"'), "TV CSS is not imported");
assert.ok(page.includes("useTvOrders"), "useTvOrders is not wired");
assert.ok(page.includes("useTvSound"), "useTvSound is not wired");
assert.ok(page.includes("useTvPrint"), "useTvPrint is not wired");
assert.ok(page.includes("useTvSettings"), "useTvSettings is not wired");
assert.ok(page.includes("useTvBrian"), "useTvBrian is not wired");
assert.ok(page.includes("useTvClock"), "useTvClock is not wired");

const ordersHook = read("hooks/tv/use-tv-orders.ts");
assert.ok(
  ordersHook.includes("etaBusyRef.current.has(order.id)"),
  "Per-order ETA mutation lock is missing",
);
assert.ok(
  ordersHook.includes("refreshSequenceRef"),
  "Stale refresh response guard is missing",
);
assert.ok(
  ordersHook.includes("window.clearInterval(timerId)"),
  "Order polling cleanup is missing",
);

const soundHook = read("hooks/tv/use-tv-sound.ts");
assert.ok(
  soundHook.includes("knownOrdersRef.current = currentKeys"),
  "Sound known-order set is not replaced",
);
assert.ok(
  soundHook.includes("knownOrdersRef.current?.clear()"),
  "Sound cleanup is missing",
);

const feedbackHook = read("hooks/tv/use-tv-feedback.ts");
assert.ok(
  feedbackHook.includes("pendingConfirmRef"),
  "Confirm cleanup ref is missing",
);
assert.ok(
  feedbackHook.includes("timerIdsRef.current.clear()"),
  "Toast timer cleanup is missing",
);

const errorBoundary = read("app/tv/error.tsx");
assert.ok(
  !errorBoundary.includes("error.stack"),
  "TV error boundary exposes stack traces",
);
assert.ok(
  errorBoundary.includes("Erneut versuchen"),
  "TV error boundary retry action is missing",
);

const refactorFiles = [
  "app/tv/page.tsx",
  "app/tv/error.tsx",
  "types/tv.ts",
  "lib/tv/domain.ts",
  ...fs
    .readdirSync(path.join(root, "components/tv"))
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => `components/tv/${name}`),
  ...fs
    .readdirSync(path.join(root, "hooks/tv"))
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => `hooks/tv/${name}`),
];

let anyCount = 0;

for (const relative of refactorFiles) {
  const source = read(relative);
  anyCount += (source.match(/\bany\b/g) || []).length;

  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
    reportDiagnostics: true,
    fileName: relative,
  });

  const errors = (result.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );

  assert.deepStrictEqual(
    errors.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    ),
    [],
    `Syntax error in ${relative}`,
  );
}

assert.strictEqual(anyCount, 0, `TV refactor still contains ${anyCount} any tokens`);

function loadDomain() {
  const source = read("lib/tv/domain.ts");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
    fileName: "lib/tv/domain.ts",
  }).outputText;

  const module = { exports: {} };
  const localRequire = (request) => {
    if (request === "@/lib/brian") {
      return {
        normalizeStreet(value) {
          return String(value || "")
            .toLowerCase()
            .trim()
            .replace(/\s+/g, " ");
        },
      };
    }
    throw new Error(`Unexpected domain dependency: ${request}`);
  };

  new Function("require", "module", "exports", output)(
    localRequire,
    module,
    module.exports,
  );

  return module.exports;
}

const domain = loadDomain();

const normalized = domain.normalizeOrders({
  orders: [
    {
      id: "WS8HTG",
      mode: "pickup",
      status: "new",
      etaMin: 15,
      customer: {
        name: "Test Kunde",
        phone: "030123456",
      },
      items: [
        {
          name: "Test Burger",
          price: "9,90",
          qty: 2,
          add: [{ name: "Käse", price: "1,00" }],
        },
      ],
      total: 21.8,
      paymentMethod: "stripe",
    },
  ],
});

assert.strictEqual(normalized.length, 1, "Order normalization lost the order");
assert.strictEqual(normalized[0].id, "WS8HTG");
assert.strictEqual(normalized[0].mode, "pickup");
assert.strictEqual(normalized[0].status, "new");
assert.strictEqual(normalized[0].etaMin, 15);
assert.strictEqual(normalized[0].customer.name, "Test Kunde");
assert.strictEqual(normalized[0].items[0].qty, 2);
assert.strictEqual(normalized[0].items[0].add[0].price, 1);

assert.strictEqual(
  domain.getPaymentKind({
    ...normalized[0],
    paymentMethod: "stripe",
  }),
  "online",
  "Online payment badge detection regressed",
);

assert.strictEqual(
  domain.getPaymentKind({
    ...normalized[0],
    paymentMethod: "barzahlung",
  }),
  "cash",
  "Cash payment badge detection regressed",
);

const totals = domain.getOrderTotals(normalized[0]);
assert.strictEqual(totals.total, 21.8, "Order total changed during refactor");

const products = domain.normalizeTvProducts({
  data: {
    products: [
      {
        id: "burger-1",
        name: "Classic",
        category: "burger",
        price: "8,50",
      },
    ],
  },
});

assert.strictEqual(products.length, 1, "Product normalization regressed");
assert.strictEqual(products[0].price, 8.5);

console.log(
  `TV refactor regression tests passed (${pageLines} page lines, ${refactorFiles.length} checked files).`,
);
