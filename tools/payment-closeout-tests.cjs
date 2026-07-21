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
assert(
  prepare.includes("recoveryTokenHash"),
  "recovery token must be hash-stored",
);
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
  session.includes("expireOpenStripeResources") &&
    session.includes("cancelPaymentIntentIfOpen") &&
    session.includes("cancelled: true"),
  "cancellation must close Checkout/PaymentIntent resources and return explicit success",
);
assert(
  session.includes("bb-checkout-resume-"),
  "secure same-session resume missing",
);

const share = read("app/api/payments/share/route.ts");
assert(
  share.includes("body?.rememberPayment === true"),
  "split payment-method saving must require explicit opt-in",
);

const paymentReturn = read("app/payment/return/page.tsx");
const paymentCenter = read("app/payment/center/page.tsx");
const splitCenter = read("app/payment/split/page.tsx");
assert(
  paymentReturn.includes('"/payment/split"') &&
    paymentReturn.includes('"/payment/center"') &&
    !paymentReturn.includes("WhatsApp"),
  "legacy return page must only route to the dedicated payment centers",
);
assert(
  paymentCenter.includes("rememberCustomerTracking") &&
    paymentCenter.includes("Bestellung verfolgen") &&
    paymentCenter.includes("etaLabel") &&
    !paymentCenter.includes("WhatsApp"),
  "normal Payment Center must show secure tracking/ETA without split sharing",
);
assert(
  splitCenter.includes("Link kopieren") &&
    splitCenter.includes("WhatsApp") &&
    splitCenter.includes("E-Mail") &&
    splitCenter.includes("Alle Zahlungen abgeschlossen"),
  "Split Center must keep payment and sharing status in one place",
);

const trackPanel = read("components/ui/TrackPanel.tsx");
assert(
  trackPanel.includes("resolveCustomerTrackingToken") &&
    trackPanel.includes("Bestellnummer oder Tracking-Code"),
  "tracking panel must resolve the visible order number through the device-bound token",
);

const trackIndex = read("app/track/page.tsx");
assert(
  trackIndex.includes("<TrackPanel") &&
    trackIndex.includes("Bestellung verfolgen"),
  "the /track index must render a usable tracking screen instead of a blank page",
);

const checkoutPage = read("app/checkout/page.tsx");
assert(
  checkoutPage.includes("Die offene Zahlung konnte nicht storniert werden"),
  "failed cancellation must keep recovery access visible",
);
assert(
  checkoutPage.includes(
    "Solange diese Zahlung offen ist, bleibt der Checkout gesperrt",
  ),
  "active payment must lock the whole checkout",
);
assert(
  checkoutPage.includes("Boolean(activePaymentRecovery)") &&
    checkoutPage.includes(
      "Bitte zuerst die offene Zahlung fortsetzen oder stornieren",
    ),
  "cash and all other submit paths must respect the active-payment lock",
);
assert(
  !checkoutPage.includes("setOrderMode(saved.orderMode)"),
  "checkout must not overwrite the cart-selected pickup/delivery mode",
);
assert(
  checkoutPage.includes("rememberLastDeliveryTrackId(trackingToken, id)") &&
    !checkoutPage.includes(
      'orderMode === "delivery" && !emergencyMode && trackingToken',
    ),
  "cash tracking must be remembered for pickup and delivery",
);

assert(
  paymentCenter.includes("Zahlung abbrechen") &&
    paymentCenter.includes(
      'window.location.assign("/checkout?payment=cancelled")',
    ),
  "Payment Center must allow real server-side cancellation",
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
    finalize.includes("expireStripeCheckoutIfOpen") &&
    finalize.includes("paymentIntents.retrieve") &&
    finalize.includes("paymentMetadataMatches"),
  "finalization must verify both Checkout and direct PaymentIntent flows",
);

const publicOrder = read("lib/server/public-order.ts");
assert(
  publicOrder.includes("const candidates = [") &&
    publicOrder.includes(".find(Boolean)") &&
    !publicOrder.includes("header ??\n      query"),
  "tracking-token lookup must accept a non-empty query parameter when headers are absent",
);

const transition = read("components/AppRouteTransition.tsx");
assert(
  transition.includes('window.addEventListener("pageshow"'),
  "pageshow restore missing",
);
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
