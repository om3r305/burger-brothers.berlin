const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const checkout = read("app/checkout/page.tsx");
const store = read("components/store.ts");
const runtime = read("lib/checkout/runtime.ts");
const types = read("types/checkout.ts");
const toast = read("components/checkout/CheckoutToastViewport.tsx");

for (const [name, source, jsx] of [
  ["app/checkout/page.tsx", checkout, true],
  ["components/store.ts", store, false],
  ["lib/checkout/runtime.ts", runtime, false],
  ["types/checkout.ts", types, false],
  ["components/checkout/CheckoutToastViewport.tsx", toast, true],
]) {
  const result = ts.transpileModule(source, {
    fileName: name,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      ...(jsx ? { jsx: ts.JsxEmit.ReactJSX } : {}),
    },
  });

  const errors = (result.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.strictEqual(
    errors.length,
    0,
    `${name} syntax failed: ${errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      .join(" | ")}`,
  );
}

assert(!/\bany\b/.test(checkout), "Checkout must not contain explicit any");
assert(!/\bany\b/.test(store), "Cart store must not contain explicit any");
assert(!/\balert\s*\(/.test(checkout), "Checkout must not use native alert");
assert(
  checkout.includes("const addToCart = useCart((state) => state.addToCart)"),
  "Checkout must consume the typed addToCart selector",
);
assert(
  store.includes("export type CartState") &&
    store.includes("export type CartItemFixed") &&
    store.includes("export type AddPayload"),
  "Cart store public types must be exported",
);
assert(
  checkout.includes("parsePaymentPrepareResponse") &&
    checkout.includes("parsePaymentSessionResponse") &&
    checkout.includes("parseOrderCreateEnvelope"),
  "Checkout API responses must pass runtime parsers",
);
assert(
  checkout.includes("isAllowedNavigationUrl(destination)"),
  "External payment navigation must be URL validated",
);
assert(
  checkout.includes("<CheckoutToastViewport") &&
    toast.includes('role={toast.tone === "error" ? "alert" : "status"}'),
  "Checkout toast viewport must be wired with accessible status roles",
);
assert(
  checkout.includes("function Field({") &&
    checkout.includes("htmlFor={htmlFor}") &&
    checkout.includes("function FieldGroup({") &&
    checkout.includes("<fieldset"),
  "Checkout fields must use htmlFor and fieldset semantics",
);
assert(
  checkout.includes("const slotConfig = useMemo(") &&
    !checkout.includes("const buildSlotConfig ="),
  "Slot configuration must have stable memoized dependencies",
);
assert(
  checkout.includes("const selectedValue: unknown = payments[key]") &&
    checkout.includes("isRecord(selectedValue) ? selectedValue.enabled : undefined"),
  "Optional payment settings must be narrowed before reading enabled",
);
assert(
  checkout.includes("This is only a split-distribution weight"),
  "The 0.01 split weight compatibility rule must be documented",
);

const runtimeJs = ts.transpileModule(runtime, {
  fileName: "lib/checkout/runtime.ts",
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
  },
}).outputText;
const sandboxModule = { exports: {} };
vm.runInNewContext(runtimeJs, {
  module: sandboxModule,
  exports: sandboxModule.exports,
  require,
  URL,
  window: { location: { origin: "https://www.burger-brothers.berlin" } },
});
const helpers = sandboxModule.exports;

const recovery = {
  paymentSessionId: "ps_123",
  recoveryToken: "secret-token",
  manageUrl: "https://www.burger-brothers.berlin/payment/center?id=ps_123",
  paymentKind: "online",
  expiresAt: null,
};
assert.strictEqual(helpers.isActivePaymentRecovery(recovery), true);
assert.strictEqual(
  helpers.isActivePaymentRecovery({ ...recovery, paymentKind: "cash" }),
  false,
);
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(helpers.parsePaymentProfileResponse({
    ok: true,
    remembered: true,
    methods: [
      { id: "pm_1", type: "card", label: "Visa •••• 4242" },
      { id: 12, label: "invalid" },
    ],
  }))),
  {
    ok: true,
    remembered: true,
    methods: [{ id: "pm_1", type: "card", label: "Visa •••• 4242" }],
  },
);
const orderEnvelope = helpers.parseOrderCreateEnvelope({
  ok: true,
  orderId: "ABC123",
  order: { etaMin: 35, meta: { trackingToken: "track-secret" } },
});
assert.strictEqual(orderEnvelope.orderId, "ABC123");
assert.strictEqual(orderEnvelope.order.etaMin, 35);

console.log("Checkout safety regression tests passed");
