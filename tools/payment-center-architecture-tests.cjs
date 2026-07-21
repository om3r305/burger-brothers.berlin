const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const prepare = read("app/api/payments/prepare/route.ts");
const session = read("app/api/payments/session/route.ts");
const share = read("app/api/payments/share/route.ts");
const finalize = read("lib/server/payment-finalize.ts");
const direct = read("lib/server/payment-intent.ts");
const checkoutHelper = read("lib/server/payment-checkout.ts");
const mutationLock = read("lib/server/payment-mutation-lock.ts");
const webhook = read("app/api/stripe/webhook/route.ts");
const center = read("app/payment/center/page.tsx");
const split = read("app/payment/split/page.tsx");
const action = read("app/payment/action/page.tsx");
const legacyReturn = read("app/payment/return/page.tsx");
const checkout = read("app/checkout/page.tsx");
const participant = read("app/pay/[token]/page.tsx");
const trackingLookup = read("app/api/track/lookup/route.ts");

assert(
  direct.includes("off_session: true") &&
    direct.includes("confirm: true") &&
    direct.includes("validateCustomerPaymentMethod"),
  "saved payments must be confirmed server-side and customer-bound",
);
assert(
  direct.includes("STRIPE_PAYMENT_METHOD_CUSTOMER_MISMATCH"),
  "PaymentMethod ownership mismatch protection missing",
);
assert(
  direct.includes('throw new Error("PAYMENT_AMOUNT_TOO_LOW")') &&
    checkoutHelper.includes('throw new Error("PAYMENT_AMOUNT_TOO_LOW")') &&
    !direct.includes("Math.max(50"),
  "payment amounts must be rejected below Stripe minimum, never silently increased",
);
assert(
  prepare.includes("selectedPaymentMethodId") &&
    prepare.includes("createAndConfirmSavedPayment") &&
    prepare.includes('flow: "saved_payment"'),
  "normal prepare route must attempt the selected saved method directly",
);
assert(
  prepare.includes("requestIdHash.slice(0, 32)") &&
    prepare.includes("sameRequest") &&
    prepare.includes("paymentRecoveryValueMatches"),
  "prepare route must be idempotent across concurrent browser retries",
);
assert(
  mutationLock.includes('status: "payment_starting"') &&
    session.includes("withPaymentMutationClaim") &&
    share.includes("withPaymentMutationClaim"),
  "payment attempt mutation lock is missing",
);
assert(
  session.includes('action === "action_details"') &&
    session.includes('action === "retry_saved"') &&
    session.includes('action === "checkout" || action === "other_method"'),
  "Payment Center server actions are incomplete",
);
assert(
  share.includes('action === "action_details"') &&
    share.includes("createSavedAttempt") &&
    share.includes("createCheckoutAttempt"),
  "split share direct/fallback flow is incomplete",
);
assert(
  finalize.includes("paymentMetadataMatches") &&
    finalize.includes("expectedAmountCents") &&
    finalize.includes('intent.currency === "eur"') &&
    finalize.includes('checkout.currency === "eur"'),
  "Stripe amount/currency/metadata verification missing",
);
assert(
  finalize.includes('checkout.status === "expired"') &&
    finalize.includes('intent.status === "canceled"') &&
    finalize.includes('? "expired"'),
  "payment lock must not be released before Stripe resources are actually terminal",
);
assert(
  session.includes("allClosed") &&
    session.includes("PAYMENT_TERMINATION_PENDING") &&
    session.includes("Der Checkout bleibt bis zur Stripe-Bestätigung gesperrt"),
  "manual cancellation must keep checkout locked until Stripe resources are terminal",
);
assert(
  webhook.includes('"payment_intent.succeeded"') &&
    webhook.includes('"payment_intent.payment_failed"') &&
    webhook.includes("recordPaymentIntentEvent") &&
    finalize.includes("export async function recordPaymentIntentEvent"),
  "PaymentIntent webhook closeout events missing",
);
assert(
  action.includes("handleNextAction") && action.includes("action_details"),
  "short SCA/provider action screen missing",
);
assert(
  center.includes("Payment Center") &&
    center.includes("Andere Zahlungsart") &&
    center.includes("Zahlung abbrechen") &&
    !center.includes("WhatsApp"),
  "normal Payment Center is mixed with split sharing",
);
assert(
  split.includes("Split Center") &&
    split.includes("Link kopieren") &&
    split.includes("WhatsApp") &&
    split.includes("E-Mail"),
  "Split Center sharing controls missing",
);
assert(
  legacyReturn.includes('"/payment/center"') &&
    legacyReturn.includes('"/payment/split"') &&
    !legacyReturn.includes("sendShareViaWhatsApp"),
  "legacy return page must be routing-only",
);
assert(
  checkout.includes("selectedSavedPaymentMethodId") &&
    checkout.includes("savedPaymentMethodId"),
  "checkout saved-method selection is not sent to the server",
);
assert(
  checkout.includes("Andere Zahlungsart wählen") &&
    checkout.includes('setSelectedSavedPaymentMethodId("")'),
  "checkout must let a returning customer choose PayPal or another hosted method",
);
assert(
  trackingLookup.includes(`"meta" ->> 'trackingToken'`) &&
    trackingLookup.includes(`"meta" ->> 'publicTrackingToken'`) &&
    trackingLookup.includes("matchesTrackingToken(candidate, token)"),
  "tracking token lookup must include the secure PostgreSQL JSON fallback",
);
assert(
  participant.includes("savedPaymentMethodId") &&
    participant.includes('pay("checkout")') &&
    participant.includes("shares.map"),
  "participant Split Center must show shared status and offer direct/fallback payment",
);
assert(
  !finalize.includes("(expired || failed) && paidShares.length > 0"),
  "a declined split attempt must not refund already-paid shares before session expiry",
);

console.log("PAYMENT CENTER ARCHITECTURE TESTS PASSED");
