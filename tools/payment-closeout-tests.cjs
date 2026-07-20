const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const prepare = read("app/api/payments/prepare/route.ts");
assert(
  prepare.includes("surcharges: fromCents(rebuiltPricing.surchargesCents)"),
  "split fee must not alter canonical order surcharges",
);
assert(
  prepare.includes("total: fromCents(payableCents)"),
  "split fee must not alter canonical order total",
);
assert(
  prepare.includes("collectedTotal: fromCents(paidTotalCents)"),
  "collected split total must stay separate",
);
assert(prepare.includes("recoveryTokenHash"), "recovery token must be hash-stored");
assert(
  prepare.includes("body?.rememberPayment === true"),
  "payment-method saving must require explicit opt-in",
);

const session = read("app/api/payments/session/route.ts");
assert(
  session.includes("paymentRecoveryValueMatches"),
  "recovery access must verify an unpredictable token",
);
assert(session.includes('action === "cancel"'), "server cancellation missing");
assert(session.includes("bb-checkout-resume-"), "secure same-session resume missing");


const share = read("app/api/payments/share/route.ts");
assert(
  share.includes("body?.rememberPayment === true"),
  "split payment-method saving must require explicit opt-in",
);

const paymentReturn = read("app/payment/return/page.tsx");
assert(
  paymentReturn.includes("window.location.assign(String(state.nextUrl))"),
  "split next-share navigation must remain direct",
);

const checkoutPage = read("app/checkout/page.tsx");
assert(
  checkoutPage.includes("Die offene Zahlung konnte nicht verworfen werden"),
  "failed cancellation must keep recovery access visible",
);

const checkout = read("lib/server/payment-checkout.ts");
assert(
  checkout.includes("params.rememberPayment && customerId"),
  "saved customer must only be reused after opt-in",
);
assert(checkout.includes("setup_future_usage"), "future usage missing");

const transition = read("components/AppRouteTransition.tsx");
assert(transition.includes('window.addEventListener("pageshow"'), "pageshow restore missing");
assert(
  transition.includes('document.addEventListener("visibilitychange"'),
  "visibility restore missing",
);

const receipt = read("print-proxy/index.cjs");
for (const label of [
  "ONLINE BEZAHLT",
  "NICHTS KASSIEREN",
  "BARZAHLUNG",
  "GETRENNT ZAHLEN OFFEN",
  "RESTBETRAG",
]) {
  assert(receipt.includes(label), `receipt label missing: ${label}`);
}

const middleware = read("middleware.ts");
assert(
  middleware.includes('method === "GET" || method === "POST"'),
  "payment resume POST route access missing",
);

const vercel = JSON.parse(read("vercel.json"));
assert(
  vercel.crons.some((cron) => cron.path === "/api/admin/cron/expire-payments"),
  "payment expiry cron missing",
);

console.log("PAYMENT CLOSEOUT TESTS PASSED");
