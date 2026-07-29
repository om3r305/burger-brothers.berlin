const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const checkoutPath = path.join(root, "app/checkout/page.tsx");
const checkout = fs.readFileSync(checkoutPath, "utf8");

const transpiled = ts.transpileModule(checkout, {
  fileName: "app/checkout/page.tsx",
  reportDiagnostics: true,
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    jsx: ts.JsxEmit.Preserve,
  },
});

const syntaxErrors = (transpiled.diagnostics || []).filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
);

assert.deepStrictEqual(
  syntaxErrors.map((diagnostic) =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
  ),
  [],
  "Checkout syntax must remain valid",
);

const syncStart = checkout.indexOf(
  "const syncActivePaymentRecovery = useCallback(",
);
const syncEnd = checkout.indexOf(
  "\n\n  useEffect(() => {\n    const restore = () => {",
  syncStart,
);
assert(syncStart >= 0 && syncEnd > syncStart, "Recovery sync block missing");

const syncBlock = checkout.slice(syncStart, syncEnd);
const fetchIndex = syncBlock.indexOf("await fetch(");
const confirmedSetIndex = syncBlock.indexOf(
  "setActivePaymentRecovery(nextRecovery)",
);

assert(fetchIndex >= 0, "Recovery sync must verify against the server");
assert(
  confirmedSetIndex > fetchIndex,
  "The blocking recovery state may only be set after server verification",
);
assert(
  !syncBlock.slice(0, fetchIndex).includes(
    "setActivePaymentRecovery(recovery)",
  ),
  "A localStorage recovery candidate must not open the modal eagerly",
);
assert(
  checkout.includes(
    '["open", "pending", "processing"].includes(payload.status)',
  ) &&
    syncBlock.includes(
      "paymentRecoveryIsConfirmedOpen(response.ok, payload)",
    ),
  "Only server-confirmed open states may display the recovery modal",
);
assert(
  syncBlock.includes("response.status === 429 || response.status >= 500"),
  "Temporary server/rate-limit errors must not be treated as terminal payments",
);
assert(
  syncBlock.includes("setPaymentRecoveryUnverified(true)") &&
    syncBlock.includes('return "unverified"'),
  "Temporary verification failure must keep duplicate-order protection",
);
assert(
  syncBlock.includes("clearActivePaymentRecoveryStorage()") &&
    syncBlock.includes('return "terminal"'),
  "Terminal recovery records must be cleared silently",
);

assert(
  checkout.includes(
    "{activePaymentRecovery && (\n        <div className=\"fixed inset-0",
  ),
  "The full-screen modal must require a server-confirmed active recovery",
);
assert(
  checkout.includes("paymentRecoveryChecking ||") &&
    checkout.includes("paymentRecoveryUnverified ||"),
  "Final order submission must stay blocked while recovery is checking or unverified",
);
assert(
  checkout.includes("Zahlungsstatus wird geprüft") &&
    checkout.includes("Zahlungsstatus noch nicht bestätigt") &&
    checkout.includes("Erneut prüfen"),
  "Checkout must show only compact non-blocking verification feedback",
);

const startCheckoutIndex = checkout.indexOf(
  "async function startStripeCheckout(",
);
const submitCashIndex = checkout.indexOf(
  "async function submitOrderWithPayment(",
);
assert(startCheckoutIndex >= 0 && submitCashIndex > startCheckoutIndex);

const startBlock = checkout.slice(startCheckoutIndex, submitCashIndex);
const submitBlock = checkout.slice(submitCashIndex);

assert(
  startBlock.includes("await syncActivePaymentRecovery(existingRecovery)") &&
    !startBlock.includes("setActivePaymentRecovery(existingRecovery)"),
  "Online payment start must verify stale local recovery before blocking",
);
assert(
  submitBlock.includes("await syncActivePaymentRecovery(existingRecovery)") &&
    !submitBlock.includes("setActivePaymentRecovery(existingRecovery)"),
  "Cash/order submission must verify stale local recovery before blocking",
);

console.log("STALE OPEN PAYMENT SCREEN REGRESSION TESTS PASSED");
