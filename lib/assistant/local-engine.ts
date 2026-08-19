import type {
  AssistantAction,
  AssistantCatalogProduct,
  AssistantRequest,
  AssistantResult,
} from "./types";

const CHECKOUT_TERMS = [
  "zur kasse",
  "kasse",
  "checkout",
  "bezahlen",
  "kasaya",
  "odeme",
  "ödeme",
  "pay now",
  "go to checkout",
];

const ADD_TERMS = [
  "warenkorb",
  "hinzufugen",
  "hinzufügen",
  "rein damit",
  "sepete",
  "ekle",
  "ekleyin",
  "add to cart",
  "add it",
  "put it in",
];

const RECOMMEND_TERMS = [
  "empfehl",
  "empfiehl",
  "vorschlag",
  "was soll ich",
  "was passt",
  "gunstig",
  "günstig",
  "angebot",
  "vorteil",
  "öner",
  "oner",
  "tavsiye",
  "avantaj",
  "recommend",
  "suggest",
  "best value",
  "deal",
];

const YES_TERMS = [
  "ja",
  "okay",
  "ok",
  "mach",
  "gerne",
  "evet",
  "tamam",
  "olur",
  "yes",
  "yeah",
  "sure",
];

const NUMBER_WORDS: Record<string, number> = {
  ein: 1,
  eine: 1,
  einen: 1,
  eins: 1,
  bir: 1,
  one: 1,
  zwei: 2,
  iki: 2,
  two: 2,
  drei: 3,
  uc: 3,
  "üç": 3,
  three: 3,
  vier: 4,
  dort: 4,
  "dört": 4,
  four: 4,
  funf: 5,
  "fünf": 5,
  bes: 5,
  "beş": 5,
  five: 5,
};

function fold(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, " ")
    .trim();
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(fold(term)));
}

function detectLanguage(raw: string) {
  const text = fold(raw);

  if (/[\u0600-\u06ff]/.test(raw)) return "ar";
  if (
    /\b(ben|bana|bir|iki|sepete|ekle|olmasin|olmasın|oner|öner|tavsiye|kasaya|tamam|evet)\b/.test(
      raw.toLowerCase(),
    )
  ) {
    return "tr";
  }
  if (
    /\b(the|please|with|without|add|cart|checkout|recommend|suggest)\b/.test(
      text,
    )
  ) {
    return "en";
  }

  return "de";
}

function copyFor(
  language: string,
  key:
    | "hello"
    | "notFound"
    | "recommended"
    | "added"
    | "checkout"
    | "shown"
    | "needChoice",
) {
  const table: Record<string, Record<string, string>> = {
    de: {
      hello:
        "Sag mir einfach, worauf du Lust hast – zum Beispiel Budget, vegan, scharf oder ein konkretes Produkt.",
      notFound:
        "Ich konnte das gewünschte Produkt nicht eindeutig finden. Nenne mir bitte den Produktnamen oder sag mir, was du suchst.",
      recommended:
        "Dazu passen diese Optionen aus unserem aktuellen Menü. Tippe auf ein Produkt oder sag mir, was ich in den Warenkorb legen soll.",
      added: "Alles klar – ich lege das für dich in den Warenkorb.",
      checkout: "Alles klar – ich bringe dich zur Kasse.",
      shown: "Das habe ich in unserem aktuellen Menü gefunden.",
      needChoice:
        "Gern. Sag mir bitte noch kurz, welches Produkt ich in den Warenkorb legen soll.",
    },
    tr: {
      hello:
        "Ne istediğini söylemen yeterli; örneğin bütçeni, vegan/acılı isteğini veya ürün adını yazabilirsin.",
      notFound:
        "İstediğin ürünü net olarak bulamadım. Ürün adını ya da ne aradığını biraz daha açık söyler misin?",
      recommended:
        "Güncel menümüzden bunlar uygun görünüyor. Bir ürüne dokunabilir veya hangisini sepete eklememi istediğini söyleyebilirsin.",
      added: "Tamamdır – bunu senin için sepete ekliyorum.",
      checkout: "Tamamdır – seni kasaya yönlendiriyorum.",
      shown: "Güncel menümüzde bunu buldum.",
      needChoice:
        "Olur. Sepete hangi ürünü eklememi istediğini bir kez daha söyler misin?",
    },
    en: {
      hello:
        "Tell me what you feel like eating – for example your budget, vegan/spicy preference, or a product name.",
      notFound:
        "I could not identify the product clearly. Please tell me the product name or what you are looking for.",
      recommended:
        "These options fit your request from the current menu. Tap one or tell me which one to add to the cart.",
      added: "Got it – I’ll add that to your cart.",
      checkout: "Got it – I’ll take you to checkout.",
      shown: "I found this in the current menu.",
      needChoice:
        "Sure. Please tell me which product you want me to add to the cart.",
    },
    ar: {
      hello: "اخبرني ماذا تريد، مثل الميزانية أو نباتي أو حار أو اسم المنتج.",
      notFound: "لم أتمكن من تحديد المنتج بدقة. اذكر اسم المنتج أو ما الذي تبحث عنه.",
      recommended: "هذه خيارات مناسبة من القائمة الحالية. اختر منتجاً أو أخبرني ماذا أضيف إلى السلة.",
      added: "حسناً، سأضيفه إلى سلة التسوق.",
      checkout: "حسناً، سأنقلك إلى صفحة الدفع.",
      shown: "وجدت هذا في القائمة الحالية.",
      needChoice: "حسناً. أخبرني أي منتج تريد إضافته إلى السلة.",
    },
  };

  return (table[language] || table.de)[key];
}

function quantityFromText(raw: string) {
  const text = fold(raw);
  const numeric = text.match(/\b([1-9]|10)\b/);
  if (numeric) return Math.max(1, Math.min(10, Number(numeric[1])));

  for (const [word, quantity] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${fold(word)}\\b`).test(text)) return quantity;
  }

  return 1;
}

function budgetFromText(raw: string) {
  const matches = String(raw).match(/(\d{1,3}(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)/gi);
  if (!matches?.length) return null;

  const values = matches
    .map((value) => Number(value.replace(/[^\d,\.]/g, "").replace(",", ".")))
    .filter((value) => Number.isFinite(value) && value > 0);

  return values.length ? Math.max(...values) : null;
}

function scoreProduct(text: string, product: AssistantCatalogProduct) {
  const name = fold(product.name);
  const sku = fold(product.sku);
  const description = fold(product.description);
  const category = fold(product.category);

  if (!name) return 0;
  if (text.includes(name)) return 100;

  const compactName = name.replace(/\s+/g, "");
  const compactText = text.replace(/\s+/g, "");
  if (compactName.length >= 5 && compactText.includes(compactName)) return 90;

  let score = 0;
  const tokens = name.split(" ").filter((token) => token.length >= 3);
  for (const token of tokens) {
    if (text.includes(token)) score += 12;
  }

  if (sku && text.includes(sku)) score += 35;
  if (category && text.includes(category)) score += 8;

  for (const token of text.split(" ").filter((token) => token.length >= 4)) {
    if (description.includes(token)) score += 2;
  }

  return score;
}

function explicitlyNamedProducts(
  raw: string,
  catalog: AssistantCatalogProduct[],
) {
  const text = fold(raw);
  const compactText = text.replace(/\s+/g, "");

  return catalog.filter((product) => {
    const name = fold(product.name);
    if (!name || name.length < 4) return false;

    if (text.includes(name)) return true;

    const compactName = name.replace(/\s+/g, "");
    return compactName.length >= 5 && compactText.includes(compactName);
  });
}

function matchingProducts(
  raw: string,
  catalog: AssistantCatalogProduct[],
  limit = 4,
) {
  const text = fold(raw);

  return catalog
    .map((product) => ({ product, score: scoreProduct(text, product) }))
    .filter((entry) => entry.score >= 12)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.product.displayPrice - right.product.displayPrice,
    )
    .slice(0, limit)
    .map((entry) => entry.product);
}

function recommendationCategoryIntent(text: string) {
  if (/(vegan|vegetar|etsiz|meatless)/.test(text)) return "vegan";
  if (/(hotdog|hot dog)/.test(text)) return "hotdogs";
  if (/(donut|doughnut)/.test(text)) return "donuts";
  if (/(bubble ?tea|boba|milk ?tea)/.test(text)) return "bubbletea";
  if (/(getrank|getraenk|drink|cola|ayran|wasser|ice tea)/.test(text)) {
    return "drinks";
  }
  if (/(sauce|sosse|sos|dip|ketchup|mayo|mayonnaise|aioli)/.test(text)) {
    return "sauces";
  }
  if (/(extra|snack|pommes|fries|nugget|onion ring)/.test(text)) {
    return "extras";
  }
  if (/(burger|hamburger|cheeseburger)/.test(text)) return "burger";

  return null;
}

function recommendationCategoryWeight(
  categoryRaw: string,
  explicitIntent: string | null,
) {
  const category = fold(categoryRaw).replace(/\s+/g, "");

  if (explicitIntent) {
    return category === explicitIntent ? 1_000 : 0;
  }

  // Generic "Was empfiehlst du?" should feel like a restaurant recommendation,
  // not a cheapest-item sort. Main dishes come first; sides follow; sauces/drinks
  // only become primary recommendations when the customer asks for them.
  const weights: Record<string, number> = {
    burger: 700,
    vegan: 660,
    hotdogs: 620,
    extras: 360,
    donuts: 320,
    bubbletea: 300,
    drinks: 180,
    sauces: 120,
  };

  return weights[category] ?? 250;
}

function recommendationProducts(
  raw: string,
  catalog: AssistantCatalogProduct[],
  limit = 3,
) {
  const text = fold(raw);
  const budget = budgetFromText(raw);
  const explicitIntent = recommendationCategoryIntent(text);
  const wantsSpicy = /(scharf|spicy|acili|acılı|hot)/.test(
    raw.toLowerCase(),
  );

  let candidates = catalog.filter((product) => {
    if (budget != null && product.displayPrice > budget) return false;

    if (explicitIntent === "vegan") {
      return (
        fold(product.category).includes("vegan") ||
        fold(product.description).includes("vegan") ||
        fold(product.description).includes("vegetar")
      );
    }

    if (explicitIntent && explicitIntent !== "burger") {
      const category = fold(product.category).replace(/\s+/g, "");
      if (category !== explicitIntent) return false;
    }

    if (wantsSpicy) {
      const searchable = `${fold(product.name)} ${fold(product.description)}`;
      return /(scharf|spicy|chili|jalap|hot)/.test(searchable);
    }

    return true;
  });

  if (!candidates.length) {
    candidates = catalog.filter(
      (product) => budget == null || product.displayPrice <= budget,
    );
  }
  if (!candidates.length) candidates = [...catalog];

  return candidates
    .map((product, index) => ({
      product,
      index,
      categoryWeight: recommendationCategoryWeight(
        product.category,
        explicitIntent,
      ),
      promo: product.badge ? 1 : 0,
    }))
    .sort(
      (left, right) =>
        right.categoryWeight - left.categoryWeight ||
        right.promo - left.promo ||
        left.index - right.index ||
        left.product.displayPrice - right.product.displayPrice ||
        left.product.name.localeCompare(right.product.name),
    )
    .slice(0, limit)
    .map((entry) => entry.product);
}

function extraIdsForText(raw: string, product: AssistantCatalogProduct) {
  const text = fold(raw);

  return product.extras
    .filter((extra) => {
      const name = fold(extra.name);
      if (!name || name.length < 3) return false;
      return text.includes(name);
    })
    .map((extra) => extra.id);
}

function removalsFromText(raw: string) {
  const out: string[] = [];
  const source = String(raw);

  const patterns = [
    /\bohne\s+([^,.!?;]{2,40})/gi,
    /\bwithout\s+([^,.!?;]{2,40})/gi,
    /\b([^,.!?;]{2,30})\s+olmas[ıi]n\b/gi,
    /\b([^,.!?;]{2,30})\s+olmadan\b/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null = null;
    while ((match = pattern.exec(source)) !== null) {
      const value = String(match[1] || "")
        .trim()
        .replace(/\s+(?:in\s+den\s+warenkorb|zum\s+warenkorb|sepete|to\s+the\s+cart).*$/i, "")
        .replace(/\s+(?:und|and|ve)\s+.*$/i, "")
        .slice(0, 40);
      if (value) out.push(value);
    }
  }

  return Array.from(new Set(out)).slice(0, 5);
}

function actionForProduct(
  product: AssistantCatalogProduct,
  quantity: number,
  type: "add_to_cart" | "show_product",
  raw: string,
): AssistantAction {
  return {
    type,
    productId: product.id,
    quantity: Math.max(1, Math.min(10, quantity)),
    extraIds: extraIdsForText(raw, product),
    remove: removalsFromText(raw),
    note: "",
    requiresConfirmation: type === "show_product",
  };
}

function isBareGreeting(text: string) {
  return /^(hallo|hi|hey|selam|merhaba|hello|guten tag|moin|مرحبا)$/.test(text);
}

export function runLocalAssistant(request: AssistantRequest): AssistantResult {
  const rawMessage = String(request.message || "").trim();
  const text = fold(rawMessage);
  const language = detectLanguage(rawMessage);
  const catalog = Array.isArray(request.catalog) ? request.catalog : [];

  if (request.customerDeliveryArea) {
    const area = request.customerDeliveryArea;
    const minimum = area.minimumOrderAfterDiscount;
    const reply = area.deliverable
      ? language === "tr"
        ? `${area.postalCode} posta koduna teslimat yapıyoruz. İndirim sonrası minimum sipariş ${Number(minimum).toFixed(2)} €.`
        : language === "en"
          ? `We deliver to ${area.postalCode}. The minimum order after discounts is €${Number(minimum).toFixed(2)}.`
          : `Wir liefern nach ${area.postalCode}. Der Mindestbestellwert nach Rabatten beträgt ${Number(minimum).toFixed(2).replace(".", ",")} €.`
      : language === "tr"
        ? `${area.postalCode} şu anda teslimat bölgemizin dışında.`
        : language === "en"
          ? `${area.postalCode} is currently outside our delivery area.`
          : `${area.postalCode} liegt derzeit außerhalb unseres Liefergebiets.`;
    return { reply, language, actions: [], provider: "local" };
  }

  if (!text || isBareGreeting(text)) {
    return {
      reply: copyFor(language, "hello"),
      language,
      actions: [],
      provider: "local",
    };
  }

  if (includesAny(text, CHECKOUT_TERMS)) {
    return {
      reply: copyFor(language, "checkout"),
      language,
      actions: [
        {
          type: "go_checkout",
          productId: "",
          quantity: 1,
          extraIds: [],
          remove: [],
          note: "",
          requiresConfirmation: false,
        },
      ],
      provider: "local",
    };
  }

  const explicitAdd = includesAny(text, ADD_TERMS);
  const affirmative = YES_TERMS.some(
    (term) => text === fold(term) || text.startsWith(`${fold(term)} `),
  );

  if (
    affirmative &&
    Array.isArray(request.lastSuggestedProductIds) &&
    request.lastSuggestedProductIds.length
  ) {
    const suggested = request.lastSuggestedProductIds
      .map((id) => catalog.find((product) => product.id === id))
      .filter((product): product is AssistantCatalogProduct => Boolean(product))
      .slice(0, 4);

    if (suggested.length === 1) {
      return {
        reply: copyFor(language, "added"),
        language,
        actions: [
          actionForProduct(suggested[0], 1, "add_to_cart", rawMessage),
        ],
        provider: "local",
      };
    }

    if (suggested.length > 1) {
      return {
        reply: copyFor(language, "needChoice"),
        language,
        actions: suggested.map((product) =>
          actionForProduct(product, 1, "show_product", rawMessage),
        ),
        provider: "local",
      };
    }
  }

  const matches = matchingProducts(rawMessage, catalog);
  const quantity = quantityFromText(rawMessage);

  if (explicitAdd) {
    // A full canonical product name is safer than fuzzy category/token matches.
    // This lets "Klasik Cheese Burger sepete ekle" resolve exactly even
    // though other burger names share the word "burger".
    const explicitlyNamed = explicitlyNamedProducts(rawMessage, catalog);
    const safeMatches = explicitlyNamed.length === 1 ? explicitlyNamed : matches;

    if (safeMatches.length !== 1) {
      return {
        reply: copyFor(language, "needChoice"),
        language,
        actions: safeMatches.slice(0, 3).map((product) =>
          actionForProduct(product, 1, "show_product", rawMessage),
        ),
        provider: "local",
      };
    }

    return {
      reply: copyFor(language, "added"),
      language,
      actions: [
        actionForProduct(safeMatches[0], quantity, "add_to_cart", rawMessage),
      ],
      provider: "local",
    };
  }

  const preferenceRecommendation =
    budgetFromText(rawMessage) != null ||
    /(vegan|vegetar|etsiz|meatless|scharf|spicy|acili|acılı|hot)/.test(
      rawMessage.toLowerCase(),
    );

  if (includesAny(text, RECOMMEND_TERMS) || preferenceRecommendation) {
    const recommendations = recommendationProducts(rawMessage, catalog);

    return {
      reply: recommendations.length
        ? copyFor(language, "recommended")
        : copyFor(language, "notFound"),
      language,
      actions: recommendations.map((product) =>
        actionForProduct(product, 1, "show_product", rawMessage),
      ),
      provider: "local",
    };
  }

  if (matches.length) {
    return {
      reply: copyFor(language, "shown"),
      language,
      actions: matches.slice(0, 3).map((product) =>
        actionForProduct(product, 1, "show_product", rawMessage),
      ),
      provider: "local",
    };
  }

  return {
    reply: copyFor(language, "notFound"),
    language,
    actions: [],
    provider: "local",
  };
}
