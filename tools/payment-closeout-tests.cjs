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
  prepare.includes("pendingExpiryMinutes") &&
    prepare.includes("paymentRecoveryExpiresAtMinutes"),
  "pending online/split payments must use a bounded minute expiry",
);
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
assert(
  session.includes("expireOpenCheckoutSessions") &&
    session.includes("cancelled: true"),
  "cancellation must expire Stripe Checkout and return explicit success",
);
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
  checkoutPage.includes("Die offene Zahlung konnte nicht storniert werden"),
  "failed cancellation must keep recovery access visible",
);
assert(
  checkoutPage.includes("Solange diese Zahlung offen ist, bleibt der Checkout gesperrt"),
  "active payment must lock the whole checkout",
);
assert(
  checkoutPage.includes("Boolean(activePaymentRecovery)") &&
    checkoutPage.includes("Bitte zuerst die offene Zahlung fortsetzen oder stornieren"),
  "cash and all other submit paths must respect the active-payment lock",
);
assert(
  !checkoutPage.includes("setOrderMode(saved.orderMode)"),
  "checkout must not overwrite the cart-selected pickup/delivery mode",
);

assert(
  paymentReturn.includes("Bestellung und Zahlung stornieren") &&
    paymentReturn.includes('window.location.assign("/checkout?payment=cancelled")'),
  "payment return page must allow checkout return and real cancellation",
);

const checkout = read("lib/server/payment-checkout.ts");
assert(
  checkout.includes("customerId") &&
    checkout.includes("customer: customerId") &&
    checkout.includes("setup_future_usage") &&
    checkout.includes("params.rememberPayment"),
  "returning customer reuse must stay device-profile-bound while new saving requires opt-in",
);
assert(checkout.includes("setup_future_usage"), "future usage missing");

const finalize = read("lib/server/payment-finalize.ts");
assert(
  finalize.includes("recoveryExpired") &&
    finalize.includes("expireStripeCheckoutIfOpen"),
  "lazy expiry must close unpaid Stripe Checkout sessions",
);

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
