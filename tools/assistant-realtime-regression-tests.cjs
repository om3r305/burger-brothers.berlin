const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const component = read("components/assistant/BurgerAssistant.tsx");
const route = read("app/api/assistant/realtime/route.ts");
const middleware = read("middleware.ts");

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
    !component.includes("OPENAI_API_KEY") &&
    !component.includes("api.openai.com"),
  "OpenAI secret and upstream connection stay server-side",
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
  route.includes('"gpt-realtime-2.1-mini"') &&
    route.includes('process.env.OPENAI_REALTIME_VOICE || "marin"') &&
    route.includes('envInt("OPENAI_REALTIME_MAX_OUTPUT_TOKENS", 220, 80, 400)') &&
    route.includes("max_output_tokens: maxOutputTokens") &&
    route.includes('process.env.OPENAI_REALTIME_TRANSCRIPT === "1"'),
  "Realtime stays on 2.1 mini/Marin with bounded replies and opt-in paid captions",
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
    route.includes("You do NOT have the whole menu in your prompt") &&
    route.includes("call search_menu before answering or adding it"),
  "Realtime prompt no longer carries the full menu catalog",
);

assert(
  component.includes('fetch("/api/groups"') &&
    component.includes("function normalizeVariantGroups(") &&
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
    component.includes("matches = searchMenuCatalog(") &&
    component.includes("listing = listMenuCategory(") &&
    component.includes("cart: readLiveCartContext()"),
  "Client executes live menu lookup and returns compact tool results/current cart",
);

const realtimeCallIndex = component.indexOf('fetch("/api/assistant/realtime"');
const realtimeCallSlice = realtimeCallIndex >= 0
  ? component.slice(realtimeCallIndex, realtimeCallIndex + 1400)
  : "";
assert(
  realtimeCallSlice.includes("sdp: localSdp") &&
    realtimeCallSlice.includes("cart: cartContext") &&
    !realtimeCallSlice.includes("catalog: currentCatalog"),
  "WebRTC setup no longer uploads the full menu to OpenAI session creation",
);

assert(
  component.includes("voiceIdleTimerRef") &&
    component.includes("armVoiceIdleStop") &&
    component.includes("60_000") &&
    component.includes("window.clearTimeout(voiceIdleTimerRef.current)"),
  "Voice session automatically stops after inactivity",
);

assert(
  component.includes('event?.name === "update_cart_item"') &&
    component.includes("updateExistingCartLine") &&
    component.includes("removeFromCart(currentLine.id)") &&
    component.includes("note === undefined") &&
    route.includes('note: { type: "string", maxLength: 200 }') &&
    route.includes('required: ["lineId", "productId", "extraIds", "remove", "note"]'),
  "Existing-line extras remain structured and realtime tools carry a bounded replaceable Hinweis",
);

assert(
  route.includes("Put removals in BOTH remove and note") &&
    route.includes('"Fleisch gut durch."') &&
    route.includes('"Ohne Salz."') &&
    route.includes("Scope doneness to its burger") &&
    route.includes("doch mit Salz") &&
    component.includes("note: sanitizeKitchenNote(line?.note) || undefined") &&
    component.includes("note: sanitizeKitchenNote(args?.note)"),
  "Realtime understands multilingual kitchen requests, scopes multi-item notes, handles reversals and exposes notes in cart context",
);

assert(
  component.includes('event?.type === "response.output_audio_transcript.done"') &&
    component.includes('event?.type === "conversation.item.input_audio_transcription.completed"'),
  "UI still handles assistant transcript and optional input-caption events",
);

assert(
  component.includes("bb-voice-orb") &&
    component.includes("prefers-reduced-motion") &&
    component.includes("Warenkorb") &&
    component.includes("Beenden") &&
    !component.includes("emergency-looking STOP"),
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
