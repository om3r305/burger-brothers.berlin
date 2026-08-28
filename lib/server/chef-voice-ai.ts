type ChefVoiceItem = {
  id: string;
  name: string;
  category: string;
  mode: "QUANTITY" | "STATUS";
  unit?: string;
  voiceAliases?: string[];
};

type RawAIHit = {
  itemId?: unknown;
  intent?: unknown;
  quantity?: unknown;
  status?: unknown;
  confidence?: unknown;
  heardAs?: unknown;
};

type VoicePatch = {
  checked: true;
  currentQty?: string;
  neededQty?: string;
  status?: "" | "LOW" | "CRITICAL" | "OUT";
};

export type ChefVoiceAIHit = {
  itemId: string;
  category: string;
  label: string;
  patch: VoicePatch;
  confidence: number;
  heardAs?: string;
};

const clean = (value: unknown, max = 500) =>
  String(value ?? "")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

function envUrl() {
  const raw = clean(process.env.CHEF_OLLAMA_URL, 1000).replace(/\/+$/, "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const allowHttp = process.env.CHEF_OLLAMA_ALLOW_HTTP === "1";
    if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function getChefVoiceAIConfig() {
  const url = envUrl();
  const model = clean(process.env.CHEF_OLLAMA_MODEL, 120);
  return {
    configured: Boolean(url && model),
    engine: url && model ? "ollama" : "fallback",
    model: url && model ? model : "",
  } as const;
}

function makeLabel(item: ChefVoiceItem, hit: RawAIHit, patch: VoicePatch) {
  if (patch.currentQty != null) {
    return `${item.name}: Bestand ${patch.currentQty}${item.unit ? ` ${item.unit}` : ""}`;
  }
  if (patch.neededQty != null) {
    return `${item.name}: bestellen ${patch.neededQty}${item.unit ? ` ${item.unit}` : ""}`;
  }
  const status = patch.status;
  const label = status === "OUT" ? "LEER" : status === "CRITICAL" ? "KRITISCH" : status === "LOW" ? "WENIG" : "AUSREICHEND";
  return `${item.name}: ${label}`;
}

function validateHits(raw: unknown, items: ChefVoiceItem[]): ChefVoiceAIHit[] {
  const source = raw && typeof raw === "object" && Array.isArray((raw as any).hits) ? (raw as any).hits : [];
  const map = new Map(items.map((item) => [item.id, item] as const));
  const result: ChefVoiceAIHit[] = [];
  const seen = new Set<string>();

  for (const row of source.slice(0, 40) as RawAIHit[]) {
    const itemId = clean(row?.itemId, 160);
    const item = map.get(itemId);
    if (!item || seen.has(itemId)) continue;

    const confidence = Math.max(0, Math.min(1, Number(row?.confidence) || 0));
    if (confidence < 0.5) continue;

    const intent = clean(row?.intent, 40).toUpperCase();
    const quantity = num(row?.quantity);
    const rawStatus = clean(row?.status, 40).toUpperCase();
    const status = ["LOW", "CRITICAL", "OUT", "OK"].includes(rawStatus) ? rawStatus : "";
    let patch: VoicePatch | null = null;

    if (intent === "STOCK" && quantity != null && item.mode === "QUANTITY") {
      patch = { checked: true, currentQty: String(quantity) };
    } else if (intent === "ORDER" && quantity != null) {
      patch = { checked: true, neededQty: String(quantity) };
      if (item.mode === "STATUS") patch.status = "LOW";
    } else if (intent === "STATUS" || status) {
      if (status === "OUT") patch = { checked: true, status: "OUT" };
      else if (status === "CRITICAL") patch = { checked: true, status: "CRITICAL" };
      else if (status === "LOW") patch = { checked: true, status: "LOW" };
      else if (status === "OK") patch = { checked: true, status: "" };
    }

    if (!patch) continue;
    seen.add(itemId);
    result.push({
      itemId,
      category: item.category,
      patch,
      confidence,
      heardAs: clean(row?.heardAs, 160) || undefined,
      label: makeLabel(item, row, patch),
    });
  }

  return result;
}

export async function interpretChefVoiceWithAI(transcriptInput: unknown, itemsInput: unknown) {
  const config = getChefVoiceAIConfig();
  const transcript = clean(transcriptInput, 5000);
  const items = (Array.isArray(itemsInput) ? itemsInput : [])
    .map((item: any) => ({
      id: clean(item?.id, 160),
      name: clean(item?.name, 180),
      category: clean(item?.category, 120),
      mode: item?.mode === "STATUS" ? "STATUS" : "QUANTITY",
      unit: clean(item?.unit, 80),
      voiceAliases: Array.isArray(item?.voiceAliases)
        ? item.voiceAliases.map((alias: unknown) => clean(alias, 120)).filter(Boolean).slice(0, 20)
        : [],
    }))
    .filter((item) => item.id && item.name) as ChefVoiceItem[];

  if (!config.configured || !transcript || !items.length) {
    return { configured: config.configured, engine: config.engine, model: config.model, hits: [] as ChefVoiceAIHit[] };
  }

  const catalog = items.map((item) => ({
    id: item.id,
    name: item.name,
    aliases: item.voiceAliases || [],
    category: item.category,
    mode: item.mode,
    unit: item.unit || "",
  }));

  const system = [
    "Du bist der Sprach-Interpreter für BB Chef, ein internes Lager-System eines Burger-Restaurants in Berlin.",
    "Mitarbeiter sprechen oft unperfektes Deutsch, gemischt mit englischen Produktnamen, Akzent, Füllwörtern und falsch erkannten Lauten.",
    "Ordne nur Produkte aus dem gelieferten Katalog zu. Erfinde niemals neue Produkte und ändere niemals itemId.",
    "Ignoriere Smalltalk und Füllwörter. Nutze Produktname, Aliase, Lautähnlichkeit und den gesamten Satzkontext.",
    "Beispiele für Absicht: 'zwei Curly Fries' => ORDER quantity 2; 'noch zwei Curly Fries auf Lager' => STOCK quantity 2; 'Ketchup fast leer' => STATUS CRITICAL; 'Mayo wenig' => STATUS LOW; 'ausreichend' => STATUS OK.",
    "Wenn eine Zuordnung unsicher ist, lasse sie weg. Antworte ausschließlich als JSON-Objekt mit Feld hits.",
    "Jeder hit: itemId, intent (ORDER|STOCK|STATUS), quantity (Zahl oder null), status (OK|LOW|CRITICAL|OUT|null), confidence 0..1, heardAs (kurzer tatsächlich gehörter Ausdruck).",
  ].join(" ");

  const user = JSON.stringify({ transcript, catalog });
  const token = clean(process.env.CHEF_OLLAMA_TOKEN, 2000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch(`${envUrl()}/api/chat`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        model: config.model,
        stream: false,
        format: "json",
        options: { temperature: 0 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!response.ok) throw new Error(`OLLAMA_HTTP_${response.status}`);
    const payload = await response.json();
    const content = clean(payload?.message?.content, 20_000);
    const parsed = content ? JSON.parse(content) : { hits: [] };
    return {
      configured: true,
      engine: "ollama" as const,
      model: config.model,
      hits: validateHits(parsed, items),
    };
  } catch (error) {
    console.error("[bb-chef-voice-ai]", error instanceof Error ? error.message : error);
    return { configured: true, engine: "ollama" as const, model: config.model, hits: [] as ChefVoiceAIHit[], failed: true };
  } finally {
    clearTimeout(timer);
  }
}
