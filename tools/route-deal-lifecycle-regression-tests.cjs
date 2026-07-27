const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf8");

const eligibility = read("lib/server/route-deal-eligibility.ts");
const lifecycle = read("lib/server/route-deal-lifecycle.ts");
const client = read("lib/client/route-deal.ts");
const createRoute = read("app/api/orders/create/route.ts");
const pricing = read("lib/server/order-pricing.ts");
const checkout = read("app/checkout/page.tsx");
const cart = read("components/CartSummary.tsx");
const pushClient = read("lib/client/general-push.ts");
const pushServer = read("lib/server/general-push.ts");
const bootstrap = read("components/CustomerAppBootstrap.tsx");
const install = read("app/install/page.tsx");
const layout = read("app/layout.tsx");
const middleware = read("middleware.ts");
const manifest = read("app/manifest.webmanifest");

assert(
  eligibility.includes("Fırsatı oluşturan ilk müşteri") &&
    eligibility.includes("sameIdentity(candidateIdentity, identity(sourceOrder))"),
  "Source customer exclusion is missing",
);
assert(
  eligibility.includes("routeDealWasApplied(order, dealId)") &&
    eligibility.includes("if (consumed) continue"),
  "Per-customer route deal consumption is missing",
);
assert(
  createRoute.includes("Bir rota fırsatını kullanan ikinci müşterinin siparişi") &&
    createRoute.includes("order: created"),
  "Second order can still create a replacement route deal",
);
assert(
  pricing.includes("findEligibleRouteDealForCustomer") &&
    pricing.includes("tenantId: params.tenantId"),
  "Canonical pricing does not enforce route deal eligibility",
);
assert(
  checkout.includes("loadEligibleRouteDeal") &&
    checkout.includes("markRouteDealConsumedOnDevice"),
  "Checkout does not revalidate or immediately consume route deal",
);
assert(
  cart.includes("useEligibleRouteDeal") &&
    cart.includes("checkoutEmail"),
  "Cart does not use customer-aware route deal eligibility",
);
assert(
  client.includes('fetch("/api/route-deals/eligible"') &&
    client.includes("ROUTE_DEAL_CHANGED_EVENT"),
  "Route deal client eligibility refresh is missing",
);
assert(
  lifecycle.includes("refreshRouteDealOpportunityForOrder") &&
    pushServer.includes("refreshRouteDealOpportunityForOrder"),
  "Underwegs does not refresh the opportunity window",
);
assert(
  pushClient.includes("repairGeneralPushOrderBindingFromLastOrder") &&
    pushClient.includes("readLastCustomerTracking"),
  "Existing customer app cannot repair push identity binding",
);
assert(
  bootstrap.includes("Benachrichtigungen aktivieren?") &&
    bootstrap.includes("repairCustomerPushInBackground") &&
    layout.includes("<CustomerAppBootstrap />") &&
    layout.includes("bb-customer-app-legacy-launch") &&
    layout.includes('location.pathname !== "/install"'),
  "Direct-home one-time notification prompt or early legacy redirect is missing",
);
assert(
  JSON.parse(manifest).start_url === "/",
  "Installed customer app still starts on /install",
);
assert(
  install.includes("window.location.replace(HOME_URL)") &&
    !install.includes("Burger Brothers wird geöffnet"),
  "Legacy /install launch still waits on the loading screen",
);
assert(
  middleware.includes('path === "/api/route-deals/eligible"') &&
    middleware.includes("CUSTOMER_NOTIFICATION_DECISION_COOKIE"),
  "Middleware route-deal access or legacy app redirect is missing",
);

console.log("Route deal + nearby push + PWA lifecycle regression tests: OK");
