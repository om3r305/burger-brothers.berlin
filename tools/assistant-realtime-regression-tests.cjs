const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const wrapper = read("components/assistant/BurgerAssistant.tsx");
const component = read("components/assistant/BurgerAssistantCore.tsx");
const route = read("app/api/assistant/realtime/route.ts");
const v2Config = read("lib/assistant/realtime-v2-config.ts");
const middleware = read("middleware.ts");
const kitchenNote = read("lib/assistant/kitchen-note.ts");

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

assert(
  route.includes('fetch("https://api.openai.com/v1/realtime/calls"') &&
    route.includes('authorization: `Bearer ${apiKey}`') &&
    !wrapper.includes("OPENAI_API_KEY") &&
    !component.includes("OPENAI_API_KEY") &&
    !component.includes("api.openai.com"),
  "OpenAI secret and upstream connection stay server-side",
);

assert(
  wrapper.includes("BurgerAssistantCore") && wrapper.includes("dynamic("),
  "Customer shell lazy-loads the heavy assistant core",
);

assert(
  route.includes('form.set("sdp", sdp)') &&
    route.includes('form.set("session", JSON.stringify(session))') &&
    !route.includes('form.set("sdp", new Blob') &&
    !route.includes('form.set("session", new Blob'),
  "Realtime unified multipart sends sdp/session as text fields",
);

assert(
  route.includes("const MAX_SDP_CHARS = 120_000") &&
    route.includes("rawSdp.replace(/\\r?\\n/g, \"\\r\\n\")") &&
    route.includes('sdp.startsWith("v=0\\r\\n")') &&
    component.includes('peer.localDescription?.sdp || offer.sdp || ""'),
  "Safari/WebRTC SDP integrity protection remains active",
);

assert(
  route.includes("buildRealtimeV2Config") &&
    v2Config.includes('"gpt-realtime-2.1"') &&
    v2Config.includes("maxOutputTokens") &&
    v2Config.includes('type: "semantic_vad"') &&
    v2Config.includes("interrupt_response: interruptResponse"),
  "Realtime uses the bounded v2 model/VAD configuration",
);

assert(
  route.includes('name: "search_menu"') &&
    route.includes('name: "list_category"') &&
    route.includes('name: "get_cart"') &&
    route.includes('name: "add_to_cart"') &&
    route.includes('name: "update_cart_item"') &&
    route.includes('name: "check_delivery_area"') &&
    route.includes('name: "go_checkout"') &&
    route.includes("SEARCH_MENU_TOOL") &&
    route.includes("LIST_CATEGORY_TOOL") &&
    route.includes("GET_CART_TOOL") &&
    route.includes("parallel_tool_calls: false"),
  "Realtime exposes only bounded live menu/cart/delivery preparation tools",
);

assert(
  !route.includes("cleanCatalog(") &&
    !route.includes("MAX_PRODUCTS") &&
    route.includes("const MAX_BODY_BYTES = 220_000") &&
    route.includes("Never rely on memory for Burger Brothers products") &&
    route.includes("call search_menu before answering or adding it"),
  "Realtime prompt no longer carries the full menu catalog",
);

assert(
  component.includes('fetch("/api/groups"') &&
    component.includes("function normalizeGroupCatalog(") &&
    component.includes('const sku = `${groupSku}-${variantId}`') &&
    component.includes("function searchMenuCatalog(") &&
    component.includes("function listMenuCategory(") &&
    component.includes('"normale Pommes"') &&
    component.includes('"Coca-Cola Zero"'),
  "Client resolves real Getränke/Extras group variants and customer aliases locally",
);

assert(
  component.includes('event?.name === "search_menu"') &&
    component.includes('event?.name === "list_category"') &&
    component.includes('event?.name === "get_cart"') &&
    component.includes("searchMenuCatalog(") &&
    component.includes("listMenuCategory(") &&
    component.includes("readLiveCartContext()"),
  "Client executes live menu lookup and returns compact tool results/current cart",
);

const realtimeCallIndex = component.indexOf('fetch("/api/assistant/realtime"');
const realtimeCallSlice = realtimeCallIndex >= 0
  ? component.slice(realtimeCallIndex, realtimeCallIndex + 1800)
  : "";
assert(
  realtimeCallSlice.includes("sdp: localSdp") &&
    realtimeCallSlice.includes("cart: cartContext") &&
    !realtimeCallSlice.includes("catalog: currentCatalog"),
  "WebRTC setup no longer uploads the full menu to OpenAI session creation",
);

assert(
  component.includes("voiceIdleTimerRef") &&
    component.includes("window.clearTimeout(voiceIdleTimerRef.current)"),
  "Voice session keeps bounded idle-timer cleanup",
);

assert(
  component.includes('event?.name === "update_cart_item"') &&
    component.includes("updateExistingCartLine") &&
    component.includes("removeFromCart(currentLine.id)") &&
    component.includes("resolveKitchenNote(currentLine.note, note)") &&
    component.includes('hasOwnProperty.call(args || {}, "note")') &&
    route.includes('note: { type: "string", maxLength: 200 }') &&
    !route.includes('required: ["lineId", "productId", "extraIds", "remove", "note"]'),
  "Item notes are bounded and optional updates preserve existing kitchen notes",
);

assert(
  kitchenNote.includes("if (requestedNote === undefined)") &&
    kitchenNote.includes("sanitizeKitchenNote(currentNote)") &&
    kitchenNote.includes("sanitizeKitchenNote(requestedNote)") &&
    component.includes("note: resolveKitchenNote(currentLine.note, note)") &&
    route.includes('Send note="" only for an explicit reversal/clear') &&
    route.includes("Important removals must ALSO appear"),
  "Omitted note preserves Fleisch gut durch while explicit empty/replacement remains intentional",
);

assert(
  component.includes("bb-voice-orb") &&
    component.includes("prefers-reduced-motion") &&
    component.includes("Warenkorb") &&
    component.includes("Beenden"),
  "Immersive voice UI has an animated reduced-motion orb and minimal controls",
);

assert(
  middleware.includes('path === "/api/assistant/realtime"') && middleware.includes('method === "POST"'),
  "Realtime endpoint remains reachable through middleware",
);

if (process.exitCode) {
  console.error("\nBurger Assistant realtime regression checks FAILED.");
  process.exit(process.exitCode);
}

console.log("\nBurger Assistant realtime regression checks PASSED.");
