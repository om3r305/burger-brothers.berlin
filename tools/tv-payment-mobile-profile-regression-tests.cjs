const assert = require("assert");
const fs = require("fs");
const path = require("path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const files = [
  "lib/tv/domain.ts",
  "app/tv/page.tsx",
  "app/api/orders/status/route.ts",
  "app/api/payments/profile/route.ts",
  "app/payment/center/page.tsx",
  "app/checkout/page.tsx",
];

for (const relative of files) {
  assert.ok(
    fs.existsSync(path.join(root, relative)),
    `Missing ${relative}`,
  );

  const result = ts.transpileModule(read(relative), {
    fileName: relative,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
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

function loadTvDomain(fetchStub) {
  const output = ts.transpileModule(read("lib/tv/domain.ts"), {
    fileName: "lib/tv/domain.ts",
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
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

  new Function("require", "module", "exports", "fetch", output)(
    localRequire,
    module,
    module.exports,
    fetchStub,
  );

  return module.exports;
}

async function main() {
  const active = {
    id: "ACTIVE1",
    mode: "pickup",
    channel: "web",
    status: "preparing",
    ts: Date.now(),
    customer: { name: "Active", phone: "0301" },
    items: [{ name: "Burger", price: 9.5, qty: 1 }],
    total: 9.5,
  };
  const done = {
    id: "DONE1",
    mode: "dine_in",
    channel: "schnellbestellung",
    status: "done",
    doneAt: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
    ts: Date.now() - 20 * 60 * 1000,
    customer: { name: "Nummer 6", phone: "" },
    items: [{ name: "Burger", price: 9.5, qty: 1 }],
    total: 9.5,
    meta: { customerNumber: 6 },
  };

  const domain = loadTvDomain(async (url) => {
    assert.ok(
      String(url).includes("includeDone=1"),
      "TV endpoint must request completed orders",
    );

    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          orders: [active],
          doneOrders: [done],
          allOrders: [active, done],
        };
      },
    };
  });

  const orders = await domain.fetchOrdersFromTvEndpoint();
  assert.deepStrictEqual(
    orders.map((order) => order.id).sort(),
    ["ACTIVE1", "DONE1"],
    "TV must keep both active and issued orders",
  );
  assert.strictEqual(
    orders.find((order) => order.id === "DONE1").status,
    "done",
    "Issued order status must stay done",
  );

  const now = Date.now();
  assert.strictEqual(
    domain.isDoneLocked(
      {
        status: "done",
        channel: "schnellbestellung",
        doneAt: new Date(now - 9 * 60 * 1000).toISOString(),
      },
      now,
    ),
    false,
    "A completed quick order must stay adjustable during its first 10 minutes",
  );
  assert.strictEqual(
    domain.isDoneLocked(
      {
        status: "done",
        channel: "schnellbestellung",
        doneAt: new Date(now - 11 * 60 * 1000).toISOString(),
      },
      now,
    ),
    true,
    "A completed quick order must lock after 10 minutes",
  );

  const tvPage = read("app/tv/page.tsx");
  assert.ok(
    tvPage.includes('status === "done"') &&
      tvPage.includes('setView("finished")'),
    "TV must switch to the finished tab after Ausgegeben",
  );

  const statusRoute = read("app/api/orders/status/route.ts");
  assert.ok(
    statusRoute.includes("COMPLETED_REOPEN_LOCK_MS = 10 * 60 * 1000") &&
      statusRoute.includes('"completed_order_locked"') &&
      statusRoute.includes("REOPENABLE_OPERATIONAL_STATUSES"),
    "The 10-minute completed-order lock must also be enforced by the API",
  );

  const profileRoute = read("app/api/payments/profile/route.ts");
  assert.ok(
    profileRoute.includes("normalizePaymentRecoveryToken") &&
      profileRoute.includes("paymentRecoveryValueMatches") &&
      profileRoute.includes("recoveryProfileClaim") &&
      profileRoute.includes("PAYMENT_PROFILE_SESSION_MISMATCH"),
    "Mobile profile claim must verify the signed recovery token and Stripe session",
  );
  assert.ok(
    profileRoute.includes("setPaymentProfileCookie") &&
      profileRoute.includes("methods,"),
    "Mobile claim must set the HttpOnly profile cookie and return saved methods",
  );

  const checkout = read("app/checkout/page.tsx");
  assert.ok(
    checkout.includes("bb_pending_payment_profile_claim_v1") &&
      checkout.includes("savePendingPaymentProfileClaim(recovery)") &&
      checkout.includes("retryPendingPaymentProfileClaim") &&
      checkout.includes("claimPaymentProfileFromRecovery"),
    "Checkout must recover a saved payment profile in the current PWA context",
  );
  assert.ok(
    checkout.indexOf("savePendingPaymentProfileClaim(recovery)") <
      checkout.indexOf("clearActivePaymentRecoveryStorage();", checkout.indexOf("savePendingPaymentProfileClaim(recovery)")),
    "The mobile profile claim marker must be saved before active recovery is cleared",
  );

  const center = read("app/payment/center/page.tsx");
  assert.ok(
    center.includes("checkoutSessionId,") &&
      center.includes("paymentSessionId,") &&
      center.includes("recoveryToken,"),
    "Payment Center must send the recovery token during profile registration",
  );

  console.log(
    "TV / COMPLETED LOCK / MOBILE PAYMENT PROFILE REGRESSION TESTS PASSED",
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
