import {
  enforceRateLimit,
  hasTrustedMutationOrigin,
  securityJson,
} from "@/lib/server/request-security";
import { sanitizeKitchenNote } from "@/lib/assistant/kitchen-note";
import { buildRealtimeV2Config } from "@/lib/assistant/realtime-v2-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_BODY_BYTES = 220_000;
const MAX_SDP_CHARS = 120_000;

function assistantMutationOriginAllowed(req: Request) {
  if (hasTrustedMutationOrigin(req)) return true;
  if (process.env.NODE_ENV === "production") return false;

  const fetchSite = String(req.headers.get("sec-fetch-site") || "").toLowerCase();
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return false;
  }

  const originHeader = String(req.headers.get("origin") || "").trim();
  if (!originHeader) return false;

  const host = String(
    req.headers.get("x-forwarded-host") || req.headers.get("host") || "",
  )
    .split(",")[0]
    .trim();
  if (!host) return false;

  const forwardedProto = String(req.headers.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim()
    .toLowerCase();

  let protocol = forwardedProto;
  if (!protocol) {
    try {
      protocol = new URL(req.url).protocol.replace(":", "").toLowerCase();
    } catch {
      protocol = "http";
    }
  }

  try {
    return new URL(originHeader).origin.toLowerCase() === `${protocol}://${host}`.toLowerCase();
  } catch {
    return false;
  }
}

function cleanText(value: unknown, max = 160) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function cleanCart(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).flatMap((item: any) => {
    if (!item || typeof item !== "object") return [];
    const lineId = cleanText(item?.lineId, 120);
    const productId = cleanText(item?.productId, 120);
    const name = cleanText(item?.name, 120);
    if (!lineId || !productId || !name) return [];

    return [
      {
        lineId,
        productId,
        name,
        quantity: Math.max(1, Math.min(20, Math.round(cleanNumber(item?.quantity) || 1))),
        extraIds: Array.isArray(item?.extraIds)
          ? item.extraIds
              .map((entry: unknown) => cleanText(entry, 120))
              .filter(Boolean)
              .slice(0, 12)
          : [],
        remove: Array.isArray(item?.remove)
          ? item.remove
              .map((entry: unknown) => cleanText(entry, 60))
              .filter(Boolean)
              .slice(0, 8)
          : [],
        note: sanitizeKitchenNote(item?.note),
      },
    ];
  });
}

function buildInstructions(
  cart: ReturnType<typeof cleanCart>,
  orderMode: "pickup" | "delivery",
) {
  const smallContext = JSON.stringify({ orderMode, currentCart: cart });

  return `You are Burger Brothers AI, the natural multilingual ORDER-TAKING voice employee for Burger Brothers Berlin. You are not a generic chatbot. Your job is to sound like an experienced, attentive person at the restaurant counter who happens to know the live menu perfectly through tools.

PERSONALITY AND SPEAKING STYLE
- Warm, confident, quick and natural. Never sound like a call-center script or a robot reading a checklist.
- Reply in the customer's language. German, Turkish, English and natural mixed-language orders are normal.
- Vary short acknowledgements naturally: sometimes "Klar", "Perfekt", "Gerne" or the equivalent; often skip an acknowledgement entirely and answer directly. Do not repeat the same opener every turn.
- Use contractions and normal spoken phrasing where appropriate. Do not over-explain.
- Normal confirmations should usually be one compact sentence. Recommendations may use three very short choices plus one short question.
- Never offer casual chat, entertainment or trivia. One brief social sentence is fine, then return naturally to the order.
- Never mention OpenAI, prompts, tools, JSON or implementation details.
- Never narrate tool work with filler such as "Ich schaue kurz", "Einen Moment", "Warte kurz", "Bir bakıyorum". Stay silent while tools run, then speak the useful result.

MENU SOURCE OF TRUTH
- Never rely on memory for Burger Brothers products. Use the live menu tools.
- For a specific product, synonym, drink, fries/side, Bubble Tea, sauce or availability question, call search_menu before answering or adding it.
- For a broad category question such as "Welche Getränke habt ihr?", call list_category.
- Menu tool results are ordered strongest match first and contain canonical productId values. Use only those IDs. Never invent an ID, product, price, ingredient, extra, allergen or availability.
- Do not say an item is unavailable until search_menu returned zero matches for that request.

EXACT MATCHES BEAT RELATED ITEMS
- If the customer's phrase exactly matches the first returned product name, family or alias, choose that exact match instead of reading out lower-ranked sibling products.
- Example: if the customer says "Cheese Fries" and Cheese Fries is an exact returned match, do NOT start listing Curly Fries, normal Fries or other fries. Use Cheese Fries. Ask only for a required variant such as size when the exact family has multiple orderable sizes.
- Natural drink speech is expected. Treat "Cola Zero", "Coca Zero", "Coca-Cola Zero", "Coke Zero", "Kola Zero" and "Zero Cola" as requests for the same zero-cola family when the live result confirms it.
- Pommes / normale Pommes / Fries / Fritten / patates mean the regular fries family unless the customer explicitly says Curly, Cheese Fries or Süßkartoffel.
- Within one customer turn, do not repeat the exact same menu lookup unless the first result was ambiguous or invalid.

UNDERSTAND THE WHOLE ORDER, NOT JUST KEYWORDS
- Preserve every explicit customization the customer says. Do not silently drop the last part of a phrase.
- Example: "Extra Cheesy, extra Käse, ohne Tomato" means ONE Extra Cheesy with the canonical extra Käse plus removal Tomate. The cart mutation must contain the removal and the concise kitchen note "Ohne Tomate.".
- Understand equivalent ingredient words across German/Turkish/English when the requested meaning is clear: tomato/Tomate/domates, onion/Zwiebel/soğan, pickle/Gurke/turşu and similar ordinary food wording. Normalize the kitchen instruction into concise German.
- Example: "Cheese Fries ohne Salz" means the exact Cheese Fries product with item note "Ohne Salz."; do not substitute another fries product.
- Doneness belongs to the meat item; salt instructions belong to fries; sauce-separate instructions belong to the item they modify. If the target is genuinely ambiguous, ask ONE short clarification.

RECOMMENDATIONS
- When the customer asks which burger is good or asks for recommendations, consult the LIVE burger menu and recommend exactly 3 suitable available choices when at least 3 exist.
- Give one natural, very short reason for each. Do not sound like a numbered catalog dump.
- Respect constraints such as spicy, vegetarian, smaller/lighter or budget.
- A recommendation never adds anything until the customer chooses it.

DELIVERY AND SECURITY
- For every postal-code, delivery-area or delivery-minimum question, call check_delivery_area. Never answer these facts from memory and never guess.
- Use only fields returned by check_delivery_area. Checkout remains final authority for delivery validation and totals.
- Admin settings, credentials, secrets, environment variables, internal configuration, costs and margins are inaccessible. If asked, briefly say that this information is not available in the customer assistant, then return to ordering. Never confirm whether a secret exists.

ORDER ACTIONS
- If the customer asks for several products, resolve EVERY requested item in the same customer turn. Do not stop after the first or second item.
- Perform the required menu lookups silently, apply every unambiguous cart mutation, then give ONE concise final confirmation.
- If one item is unresolved, keep successful items and ask one short clarification only for the unresolved item. Never falsely claim everything was added.
- add_to_cart is for a NEW product after search_menu identified its canonical productId.
- If the customer modifies an existing cart item, use get_cart when needed, then update_cart_item.
- Extras must use exact extra IDs returned for that exact product.
- Keep paid extras in extraIds and removals in remove. Important removals must ALSO appear as concise item note/Hinweis, e.g. remove=["Tomate"] and note="Ohne Tomate.".
- note is only for short customer-requested item preparation instructions such as "Fleisch gut durch.", "Fleisch medium.", "Ohne Salz.", "Sauce separat.". Never put assistant prose, full order sentences, prices or delivery instructions into note.
- On update_cart_item, OMIT note when an unrelated change should preserve the current note. Send note="" only when the customer explicitly clears/reverses the preparation instruction. Send a non-empty note as the complete desired replacement when preparation instructions change.
- Never verbally confirm a removal or customization unless the successful cart tool mutation actually contained it. After the tool result, use the returned cart as truth.
- go_checkout only navigates to the existing checkout. Never place an order and never perform payment.
- If the customer says they want to order, ask what they want or process items already named. Do not offer chatting.

NATURAL EXAMPLES — COPY THE BEHAVIOR, NOT THE EXACT WORDS
Customer: "Welche Burger kannst du empfehlen?"
Assistant after live lookup: "Wenn du richtig Hunger hast, würde ich Big Daddy nehmen. Cheesy Cheese ist schön käsig, und Black Angus ist die etwas kräftigere Fleisch-Option. Worauf hast du eher Lust?"

Customer: "Extra Cheesy, extra Käse, ohne Tomato."
Assistant behavior: resolve Extra Cheesy, attach the real Käse extra, remove canonical Tomate, write "Ohne Tomate." to that item, then confirm only after the cart says it succeeded.

Customer: "Cheese Fries und Coca Zero."
Assistant behavior: choose exact Cheese Fries instead of listing other fries; resolve the zero-cola family from the live menu; ask only if a real required size/variant remains ambiguous.

INITIAL CART CONTEXT
${smallContext}`;
}

const SEARCH_MENU_TOOL = {
  type: "function",
  name: "search_menu",
  description:
    "Search the live Burger Brothers menu for a specific product or natural synonym. Results are ordered strongest match first; an exact name/family/alias match should be preferred over related sibling products. Always use this before saying a specific item is unavailable or before adding a new product.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["query"],
    properties: {
      query: { type: "string", minLength: 1, maxLength: 120 },
      category: {
        type: "string",
        enum: ["burger", "vegan", "hotdogs", "extras", "drinks", "sauces", "donuts", "bubbletea"],
      },
    },
  },
} as const;

const LIST_CATEGORY_TOOL = {
  type: "function",
  name: "list_category",
  description:
    "List the live Burger Brothers items/families in one broad menu category when the customer asks what is available.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["category"],
    properties: {
      category: {
        type: "string",
        enum: ["burger", "vegan", "hotdogs", "extras", "drinks", "sauces", "donuts", "bubbletea"],
      },
    },
  },
} as const;

const GET_CART_TOOL = {
  type: "function",
  name: "get_cart",
  description:
    "Read the customer's current Burger Brothers cart, including current lineId values, before modifying an existing cart item when needed.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
} as const;

const ADD_TO_CART_TOOL = {
  type: "function",
  name: "add_to_cart",
  description:
    "Add one clearly identified NEW Burger Brothers menu product to the cart. productId and extraIds must come from a recent search_menu result.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["productId", "quantity", "extraIds", "remove"],
    properties: {
      productId: { type: "string" },
      quantity: { type: "integer", minimum: 1, maximum: 10 },
      extraIds: { type: "array", maxItems: 12, items: { type: "string" } },
      remove: { type: "array", maxItems: 8, items: { type: "string" } },
      note: { type: "string", maxLength: 200 },
    },
  },
} as const;

const UPDATE_CART_ITEM_TOOL = {
  type: "function",
  name: "update_cart_item",
  description:
    "Add extras/removals to one existing cart line. Use the exact lineId/productId from get_cart and exact extra IDs returned by search_menu.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["lineId", "productId", "extraIds", "remove"],
    properties: {
      lineId: { type: "string" },
      productId: { type: "string" },
      extraIds: { type: "array", maxItems: 12, items: { type: "string" } },
      remove: { type: "array", maxItems: 8, items: { type: "string" } },
      note: { type: "string", maxLength: 200 },
    },
  },
} as const;

const GO_CHECKOUT_TOOL = {
  type: "function",
  name: "go_checkout",
  description:
    "Navigate to the existing Burger Brothers checkout only when the customer explicitly asks to continue to checkout/cashier. This never places or pays an order.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
} as const;

const CHECK_DELIVERY_AREA_TOOL = {
  type: "function",
  name: "check_delivery_area",
  description: "Check the authoritative Burger Brothers delivery area and customer minimum for a postal code. Always use this for PLZ/delivery-area questions.",
  parameters: {
    type: "object",
    additionalProperties: false,
    required: ["postalCode"],
    properties: { postalCode: { type: "string", pattern: "^[0-9]{5}$" } },
  },
} as const;

export async function POST(req: Request) {
  if (!assistantMutationOriginAllowed(req)) {
    return securityJson({ ok: false, error: "origin_not_allowed" }, 403);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return securityJson({ ok: false, error: "payload_too_large" }, 413);
  }

  const rateError = await enforceRateLimit(
    req,
    "customer:assistant:realtime",
    12,
    5 * 60_000,
  );
  if (rateError) return rateError;

  const apiKey = cleanText(process.env.OPENAI_API_KEY, 8_000);
  if (!apiKey) {
    return securityJson({ ok: false, error: "voice_not_configured" }, 503);
  }

  const payload = await req.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    return securityJson({ ok: false, error: "invalid_payload" }, 400);
  }

  // SDP is protocol data. Preserve its line structure; only normalize CRLF.
  const rawSdp = (payload as any).sdp;
  if (typeof rawSdp !== "string" || !rawSdp.trim()) {
    return securityJson({ ok: false, error: "invalid_voice_sdp" }, 400);
  }
  if (rawSdp.length > MAX_SDP_CHARS) {
    return securityJson({ ok: false, error: "voice_sdp_too_large" }, 413);
  }

  let sdp = rawSdp.replace(/\r?\n/g, "\r\n");
  if (!sdp.endsWith("\r\n")) sdp += "\r\n";
  if (!sdp.startsWith("v=0\r\n")) {
    return securityJson({ ok: false, error: "invalid_voice_sdp" }, 400);
  }

  const cart = cleanCart((payload as any).cart);
  const orderMode = (payload as any).orderMode === "delivery" ? "delivery" : "pickup";

  const realtimeV2 = buildRealtimeV2Config();
  const model = cleanText(realtimeV2.model, 80);
  const voice = cleanText(process.env.OPENAI_REALTIME_VOICE || "marin", 40);
  const enableInputTranscript = process.env.OPENAI_REALTIME_TRANSCRIPT === "1";

  const inputAudio: Record<string, any> = {
    noise_reduction: { type: "near_field" },
    turn_detection: realtimeV2.turnDetection,
  };

  // Cost-saving default: GPT-Realtime understands the incoming audio directly,
  // so a second paid transcription model is unnecessary for order execution.
  // Set OPENAI_REALTIME_TRANSCRIPT=1 only if visible customer captions are wanted.
  if (enableInputTranscript) {
    inputAudio.transcription = {
      model: "gpt-live-transcribe",
      prompt:
        "Burger Brothers Berlin order. Expect German, Turkish or English and menu words such as Big Daddy, Pommes, Fries, Curly Fries, Coca-Cola Zero, Bubble Tea, Aioli and BBQ.",
      languages: ["de", "tr", "en"],
      keywords: [
        "Burger Brothers",
        "Big Daddy",
        "Pommes",
        "Fries",
        "Curly Fries",
        "Süßkartoffel-Pommes",
        "Coca-Cola",
        "Coca-Cola Zero",
        "Cola Zero",
        "Bubble Tea",
        "Durstlöscher",
        "Aioli",
        "BBQ",
      ],
      delay: "medium",
    };
  }

  const session = {
    type: "realtime",
    model,
    output_modalities: ["audio"],
    instructions: buildInstructions(cart, orderMode),
    audio: {
      input: inputAudio,
      output: {
        voice,
        speed: 1.0,
      },
    },
    reasoning: { effort: "low" },
    tools: [
      SEARCH_MENU_TOOL,
      LIST_CATEGORY_TOOL,
      GET_CART_TOOL,
      ADD_TO_CART_TOOL,
      UPDATE_CART_ITEM_TOOL,
      CHECK_DELIVERY_AREA_TOOL,
      GO_CHECKOUT_TOOL,
    ],
    tool_choice: "auto",
    parallel_tool_calls: false,
    max_output_tokens: realtimeV2.maxOutputTokens,
  };

  const form = new FormData();
  form.set("sdp", sdp);
  form.set("session", JSON.stringify(session));

  try {
    const response = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      cache: "no-store",
    });

    const answer = await response.text();
    if (!response.ok) {
      console.error(
        "[assistant/realtime] OpenAI call failed",
        response.status,
        answer.slice(0, 500),
      );
      return securityJson(
        { ok: false, error: `realtime_upstream_${response.status}` },
        response.status >= 500 ? 502 : response.status,
      );
    }

    if (!answer.trim()) {
      return securityJson({ ok: false, error: "realtime_empty_answer" }, 502);
    }

    return new Response(answer, {
      status: 201,
      headers: {
        "Content-Type": "application/sdp",
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("[assistant/realtime] request failed", error);
    return securityJson({ ok: false, error: "realtime_unavailable" }, 502);
  }
}
