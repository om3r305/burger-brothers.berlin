// lib/telegram.ts
import { getServerSettings } from "@/lib/server/settings";

type OrderItem = {
  name: string;
  qty: number;
  price?: number;
  category?: string;
  add?: { name?: string; label?: string; price?: number }[];
  rm?: string[];
  note?: string;
};

type TelegramConfig = {
  enabled: boolean;
  token: string;
  chatId: string;
  source: "env" | "settings";
};

/* ───────────────── categories ───────────────── */

function catKey(name?: string) {
  const t = (name || "").toLowerCase();

  if (!t) return "";
  if (t.includes("burger")) return "burger";
  if (t.includes("pommes") || t.includes("fries") || t.includes("friet") || t.includes("kartoff")) return "pommes";
  if (t.includes("drink") || t.includes("getränk") || t.includes("getraenk") || t.includes("cola") || t.includes("wasser") || t.includes("fritz")) return "drinks";
  if (t.includes("sauce") || t.includes("soße") || t.includes("soßen") || t.includes("sossen") || t.includes("sos") || t.includes("ketchup") || t.includes("mayo")) return "sauces";
  if (t.includes("donut") || t.includes("dessert")) return "donuts";
  if (t.includes("hotdog")) return "hotdogs";
  if (t.includes("vegan")) return "vegan";
  if (t.includes("bubble")) return "bubbletea";
  if (t.includes("extra")) return "extras";

  return "other";
}

function catTitle(k: string): string {
  switch (k) {
    case "burger":
      return "🍔 Burger";
    case "pommes":
      return "🍟 Pommes";
    case "drinks":
      return "🥤 Getränke";
    case "sauces":
      return "🥫 Soßen";
    case "donuts":
      return "🍩 Donuts";
    case "hotdogs":
      return "🌭 Hotdogs";
    case "vegan":
      return "🌱 Vegan";
    case "bubbletea":
      return "🧋 Bubble Tea";
    case "extras":
      return "➕ Extras";
    default:
      return "📦 Sonstiges";
  }
}

/* ───────────────── utils ───────────────── */

function htmlEscape(value: any) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function fmtEUR(n: number | undefined) {
  if (typeof n !== "number" || !Number.isFinite(n)) return "0,00";
  return n.toFixed(2).replace(".", ",");
}

function getTelegramEnv(): TelegramConfig | null {
  const token =
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.BB_TELEGRAM_BOT_TOKEN ||
    process.env.TELEGRAM_TOKEN ||
    process.env.BOT_TOKEN ||
    "";

  const chatId =
    process.env.TELEGRAM_CHAT_ID ||
    process.env.BB_TELEGRAM_CHAT_ID ||
    process.env.TELEGRAM_ORDER_CHAT_ID ||
    process.env.TELEGRAM_ADMIN_CHAT_ID ||
    "";

  if (!token || !chatId) return null;

  return {
    enabled: true,
    token: String(token),
    chatId: String(chatId),
    source: "env",
  };
}

/** Settings içinden Telegram config'i esnek anahtar / path kombinasyonlarıyla alır. */
function getTelegramFromSettings(settings: any): TelegramConfig | null {
  const candidates = [
    settings?.notifications?.telegram,
    settings?.notify?.telegram,
    settings?.integrations?.telegram,
    settings?.messaging?.telegram,
    settings?.telegram,
    settings?.contact?.telegram,
  ].filter(Boolean);

  for (const t of candidates) {
    const enabled = t?.enabled !== false && String(t?.enabled).toLowerCase() !== "false";
    const token =
      t?.botToken || t?.token || t?.apiToken || t?.BOT_TOKEN || t?.BOT;
    const chatId =
      t?.chatId || t?.chatID || t?.CHAT_ID || t?.room || t?.channel;

    if (token && chatId) {
      return {
        enabled,
        token: String(token),
        chatId: String(chatId),
        source: "settings",
      };
    }
  }

  return null;
}

/*
  ÖNEMLİ:
  Acil modda DB/Supabase sorunlu olabileceği için önce ENV okunur.
  ENV varsa DB/settings'e hiç ihtiyaç kalmadan Telegram gönderilebilir.
*/
async function resolveTelegramConfig(): Promise<TelegramConfig | null> {
  const envCfg = getTelegramEnv();
  if (envCfg) return envCfg;

  try {
    const settings = await getServerSettings();
    return getTelegramFromSettings(settings);
  } catch (error) {
    console.warn("[telegram] settings could not be read, env also missing", error);
    return null;
  }
}

async function sendTelegramHttp(params: {
  token: string;
  chatId: string;
  text: string;
  parseMode?: "HTML";
  timeoutMs?: number;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.timeoutMs ?? 15_000);

  try {
    const response = await fetch(`https://api.telegram.org/bot${params.token}/sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: params.text,
        parse_mode: params.parseMode,
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const payload = await response.text().catch(() => "");
      throw new Error(`telegram_http_${response.status}${payload ? `_${payload}` : ""}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

/* ───────────────── public helpers ───────────────── */

export async function sendTelegramRawText(text: string, opts?: { html?: boolean }) {
  const cfg = await resolveTelegramConfig();

  if (!cfg?.token || !cfg?.chatId) {
    console.warn("[telegram] missing token/chatId (settings & env)");
    return false;
  }

  if (cfg.enabled === false) {
    console.warn("[telegram] disabled in settings");
    return false;
  }

  await sendTelegramHttp({
    token: cfg.token,
    chatId: cfg.chatId,
    text,
    parseMode: opts?.html ? "HTML" : undefined,
  });

  return true;
}

/* ───────────────── main ───────────────── */

export async function sendTelegramNewOrder(input: {
  id: string;
  mode: "pickup" | "delivery";
  items: OrderItem[];
  totals: {
    merchandise: number;
    discount: number;
    coupon?: string | null;
    couponDiscount?: number;
    surcharges?: number;
    total: number;
  };
  customer: {
    name?: string;
    phone?: string;
    address?: string;
    plz?: string;
    note?: string;
  };
  planned?: string;
  etaMin?: number | null;
}) {
  const cfg = await resolveTelegramConfig();

  if (!cfg?.token || !cfg?.chatId) {
    console.warn("[telegram] missing token/chatId (settings & env)");
    return false;
  }

  if (cfg.enabled === false) {
    console.warn("[telegram] disabled in settings");
    return false;
  }

  // Gruplama
  const groups = new Map<string, OrderItem[]>();

  for (const it of input.items || []) {
    const key = catKey(it.category || it.name);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(it);
  }

  // Mesaj içeriği (Almanca)
  const lines: string[] = [];

  lines.push(
    `<b>Neue Bestellung #${htmlEscape(input.id)}</b> • ${
      input.mode === "pickup" ? "Abholung" : "Lieferung"
    }`,
  );

  const etaMinFromInput =
    typeof input.etaMin === "number" && Number.isFinite(input.etaMin) && input.etaMin > 0
      ? input.etaMin
      : null;

  if (etaMinFromInput) {
    lines.push("");
    lines.push("<b>ETA</b>");
    lines.push(
      input.mode === "pickup"
        ? `~${etaMinFromInput} Min (Abholung)`
        : `~${etaMinFromInput} Min (Lieferung)`,
    );
  } else {
    try {
      const settings = await getServerSettings();
      const mins =
        input.mode === "pickup"
          ? settings?.hours?.avgPickupMinutes ?? 10
          : settings?.hours?.avgDeliveryMinutes ?? 35;

      if (Number.isFinite(Number(mins)) && Number(mins) > 0) {
        lines.push("");
        lines.push("<b>ETA</b>");
        lines.push(
          input.mode === "pickup"
            ? `~${Number(mins)} Min (Abholung)`
            : `~${Number(mins)} Min (Lieferung)`,
        );
      }
    } catch {}
  }

  for (const [k, arr] of groups) {
    lines.push("");
    lines.push(`<b>${catTitle(k)}</b>`);

    for (const it of arr) {
      const q = it.qty || 1;
      const nm = htmlEscape(it.name || "Artikel");
      lines.push(`- ${q} × ${nm}`);

      const extras = (it.add || [])
        .map((a) => a?.label || a?.name)
        .filter(Boolean)
        .join(", ");

      if (extras) lines.push(`  • Extras: ${htmlEscape(extras)}`);

      if (Array.isArray(it.rm) && it.rm.length) {
        lines.push(`  • Ohne: ${htmlEscape(it.rm.join(", "))}`);
      }

      if (it.note) {
        lines.push(`  • Hinweis: ${htmlEscape(String(it.note))}`);
      }
    }
  }

  const t = input.totals;

  lines.push("");
  lines.push("<b>Summe</b>");
  lines.push(`Warenwert: ${fmtEUR(t.merchandise)} €`);

  if (t.discount && t.discount > 0) {
    lines.push(`Rabatt: -${fmtEUR(t.discount)} €`);
  }

  if (t.couponDiscount && t.couponDiscount > 0) {
    const tag = t.coupon ? ` (${htmlEscape(String(t.coupon))})` : "";
    lines.push(`Gutschein${tag}: -${fmtEUR(t.couponDiscount)} €`);
  }

  if (t.surcharges && t.surcharges > 0) {
    lines.push(`Aufschläge: ${fmtEUR(t.surcharges)} €`);
  }

  lines.push(`<b>Gesamt: ${fmtEUR(t.total)} €</b>`);

  lines.push("");
  lines.push("<b>Kunde</b>");

  if (input.customer.name) lines.push(htmlEscape(input.customer.name));
  if (input.customer.phone) lines.push(htmlEscape(input.customer.phone));
  if (input.customer.address) lines.push(htmlEscape(input.customer.address));
  if (input.customer.plz) lines.push(`PLZ: ${htmlEscape(input.customer.plz)}`);
  if (input.customer.note) lines.push(`Hinweis: ${htmlEscape(input.customer.note)}`);
  if (input.planned) lines.push(`Geplant (heute): ${htmlEscape(input.planned)}`);

  const text = lines.join("\n");

  try {
    await sendTelegramHttp({
      token: cfg.token,
      chatId: cfg.chatId,
      text,
      parseMode: "HTML",
    });

    return true;
  } catch (error) {
    console.error("[telegram] send error", error);
    return false;
  }
}
