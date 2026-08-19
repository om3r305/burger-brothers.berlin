const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

const nav = read("components/NavBar.tsx");
const layout = read("app/layout.tsx");
const middleware = read("middleware.ts");
const component = read("components/assistant/BurgerAssistant.tsx");
const route = read("app/api/assistant/chat/route.ts");
const realtime = read("app/api/assistant/realtime/route.ts");
const local = read("lib/assistant/local-engine.ts");

assert(
  layout.includes('import BurgerAssistant from "@/components/assistant/BurgerAssistant";') &&
    layout.includes("<BurgerAssistant />") &&
    !nav.includes("BurgerAssistant"),
  "Assistant is mounted once in the global app shell",
);

assert(
  middleware.includes('path === "/api/assistant/chat"') &&
    middleware.includes('path === "/api/assistant/realtime"') &&
    middleware.includes('method === "POST"'),
  "Assistant text and realtime POST routes remain reachable through middleware",
);

assert(
  route.includes("hasTrustedMutationOrigin") &&
    route.includes('"customer:assistant"') &&
    realtime.includes("hasTrustedMutationOrigin") &&
    realtime.includes('"customer:assistant:realtime"'),
  "Assistant routes keep trusted-origin and rate-limit guards",
);

assert(
  route.includes("process.env.OPENAI_API_KEY") &&
    route.includes('"gpt-5.6-luna"') &&
    route.includes("https://api.openai.com/v1/responses") &&
    route.includes("store: false") &&
    route.includes("max_output_tokens: 600"),
  "Text assistant stays server-side, Luna-based, structured and output-bounded",
);

assert(
  route.includes("runLocalAssistant") && route.includes("OPENAI_ASSISTANT_FORCE_LOCAL"),
  "Text assistant keeps deterministic local fallback",
);

assert(
  component.includes('fetch("/api/catalog"') &&
    component.includes('fetch("/api/groups"') &&
    component.includes("function normalizeGroupCatalog(") &&
    component.includes("function mergeAssistantCatalog(") &&
    component.includes('const sku = `${groupSku}-${variantId}`') &&
    component.includes('name: `${groupName} – ${variantName}`'),
  "Assistant reads both catalog and the real /api/groups variant source",
);

assert(
  component.includes('"normale Pommes"') &&
    component.includes('"Fries"') &&
    component.includes('"Patates"') &&
    component.includes('"Coca-Cola Zero"') &&
    component.includes('"Kola Zero"') &&
    component.includes("function searchMenuCatalog(") &&
    component.includes("function listMenuCategory("),
  "Local live-menu resolver understands Fries/Pommes/Patates and Cola Zero aliases",
);

assert(
  component.includes("pfandType: product.pfandType ?? product.depositType") &&
    component.includes("pfandAmount: Number(product.pfandAmount ?? product.depositAmount") &&
    component.includes("depositAmount: Number(product.depositAmount ?? product.pfandAmount"),
  "Group drink variants preserve Pfand/deposit metadata in canonical cart rows",
);

assert(
  component.includes("addToCart({") &&
    component.includes("updateExistingCartLine") &&
    component.includes("removeFromCart(currentLine.id)") &&
    component.includes("note: undefined") &&
    component.includes('router.push("/checkout")'),
  "Assistant only prepares the existing cart, updates structured extras and can navigate to checkout",
);

for (const marker of ["OPENAI_API_KEY", ["s", "k", "-"].join(""), "Bearer ${process.env"]) {
  assert(!component.includes(marker), `Client component does not contain secret marker: ${marker}`);
}

for (const marker of [
  "/api/orders/create",
  "/api/payments/prepare",
  "stripe",
  "/api/orders/status",
  "/api/orders/claim",
  "/api/orders/notification",
  "/api/print",
  "/api/drivers",
]) {
  assert(
    !component.toLowerCase().includes(marker.toLowerCase()) &&
      !route.toLowerCase().includes(marker.toLowerCase()) &&
      !realtime.toLowerCase().includes(marker.toLowerCase()) &&
      !local.toLowerCase().includes(marker.toLowerCase()),
    `Assistant does not call critical operational flow: ${marker}`,
  );
}

assert(
  realtime.includes('name: "search_menu"') &&
    realtime.includes('name: "list_category"') &&
    realtime.includes('name: "get_cart"') &&
    realtime.includes('name: "add_to_cart"') &&
    realtime.includes('name: "update_cart_item"') &&
    realtime.includes('name: "check_delivery_area"') &&
    realtime.includes('name: "go_checkout"') &&
    component.includes('event?.name === "search_menu"') &&
    component.includes('event?.name === "list_category"') &&
    component.includes('event?.name === "get_cart"'),
  "Realtime uses bounded live-menu/cart tools instead of stuffing the whole menu into the prompt",
);

const realtimeCallIndex = component.indexOf('fetch("/api/assistant/realtime"');
const realtimeCallSlice = realtimeCallIndex >= 0
  ? component.slice(realtimeCallIndex, realtimeCallIndex + 1400)
  : "";
assert(
  realtimeCallSlice.includes("sdp: localSdp") &&
    realtimeCallSlice.includes("cart: cartContext") &&
    realtimeCallSlice.includes("orderMode") &&
    !realtimeCallSlice.includes("catalog: currentCatalog") &&
    !realtime.includes("cleanCatalog(") &&
    !realtime.includes("compactCatalog("),
  "Realtime handshake sends SDP plus small cart context, not hundreds of menu rows",
);

assert(
  realtime.includes('process.env.OPENAI_REALTIME_TRANSCRIPT === "1"') &&
    realtime.includes('model: "gpt-live-transcribe"') &&
    realtime.includes("if (enableInputTranscript)") &&
    realtime.includes('envInt("OPENAI_REALTIME_MAX_OUTPUT_TOKENS", 220, 80, 400)') &&
    component.includes("60_000"),
  "Voice cost controls: optional paid input captions, short output cap and 60s idle auto-stop",
);

assert(
  route.includes("ORDER-FIRST SCOPE") &&
    route.includes("Do not offer casual conversation") &&
    realtime.includes("You are not a general chat assistant") &&
    realtime.includes("Never offer casual chat") &&
    realtime.includes("call search_menu before answering or adding it"),
  "Text and voice assistants are order-first and must verify live menu data",
);

assert(
  realtime.includes("Do not say an item is unavailable until search_menu returned zero matches") &&
    realtime.includes("resolve each requested product") &&
    realtime.includes("every unambiguous item is added"),
  "Voice assistant cannot invent missing Cola/Pommes and continues multi-item orders",
);

assert(
  route.includes("Reply as plain text only") && route.includes("Do not use Markdown markers"),
  "Text replies remain plain text",
);

if (process.exitCode) {
  console.error("\nBurger Assistant regression checks FAILED.");
  process.exit(process.exitCode);
}

console.log("\nBurger Assistant regression checks PASSED.");
