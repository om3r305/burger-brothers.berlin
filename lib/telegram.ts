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
    case "burger": return "🍔 Burger";
    case "pommes": return "🍟 Pommes";
    case "drinks": return "🥤 Getränke";
    case "sauces": return "🥫 Soßen";
    case "donuts": return "🍩 Donuts";
    case "hotdogs": return "🌭 Hotdogs";
    case "vegan": return "🌱 Vegan";
    case "bubbletea": return "🧋 Bubble Tea";
    case "extras": return "➕ Extras";
    default: return "📦 Sonstiges";
  }
}

/* ───────────────── utils ───────────────── */

function htmlEscape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function fmtEUR(n: number | undefined) {
  if (typeof n !== "number") return undefined;
  return n.toFixed(2).replace(".", ",");
}

/** Settings içinden Telegram config'i esnek anahtar / path kombinasyonlarıyla alır. */
function getTelegramFromSettings(settings: any) {
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
      };
    }
  }
  return null;
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
  };
  planned?: string;
}) {
  const settings = getServerSettings() || {};
  const cfg = getTelegramFromSettings(settings);

  // env fallback (route içinde process.env set edilmiş olabilir)
  const token = cfg?.token || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = cfg?.chatId || process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.warn("[telegram] missing token/chatId (settings & env)");
    return;
  }
  if (cfg && cfg.enabled === false) {
    console.warn("[telegram] disabled in settings");
    return;
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

  // ETA (mode-based)
  try {
    const s = await getServerSettings();
    const mins = input.mode === "pickup"
      ? (s.hours?.avgPickupMinutes ?? 10)
      : (s.hours?.avgDeliveryMinutes ?? 35);
    if (Number.isFinite(mins) && mins > 0) {
      lines.push("");
      lines.push(`<b>ETA</b>`);
      lines.push(input.mode === "pickup"
        ? `~${mins} Min (Abholung)`
        : `~${mins} Min (Lieferung)`
      );
    }
  } catch {}

  lines.push(
    `<b>Neue Bestellung #${htmlEscape(input.id)}</b> • ${
      input.mode === "pickup" ? "Abholung" : "Lieferung"
    }`
  );

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

      if (Array.isArray((it as any).rm) && (it as any).rm.length) {
        lines.push(`  • Ohne: ${htmlEscape((it as any).rm.join(", "))}`);
      }
      if ((it as any).note) {
        lines.push(`  • Hinweis: ${htmlEscape(String((it as any).note))}`);
      }
    }
  }

  const t = input.totals;
  lines.push("");
  lines.push("<b>Summe</b>");
  lines.push(`Warenwert: ${fmtEUR(t.merchandise)} €`);
  if (t.discount && t.discount > 0) lines.push(`Rabatt: -${fmtEUR(t.discount)} €`);
  if (t.couponDiscount && t.couponDiscount > 0) {
    const tag = t.coupon ? ` (${htmlEscape(String(t.coupon))})` : "";
    lines.push(`Gutschein${tag}: -${fmtEUR(t.couponDiscount)} €`);
  }
  if (t.surcharges && t.surcharges > 0) lines.push(`Aufschläge: ${fmtEUR(t.surcharges)} €`);
  lines.push(`<b>Gesamt: ${fmtEUR(t.total)} €</b>`);

  lines.push("");
  lines.push("<b>Kunde</b>");
  if (input.customer.name) lines.push(htmlEscape(input.customer.name));
  if (input.customer.phone) lines.push(htmlEscape(input.customer.phone));
  if (input.customer.address) lines.push(htmlEscape(input.customer.address));
  if (input.planned) lines.push(`Geplant (heute): ${htmlEscape(input.planned)}`);

  const text = lines.join("\n");

  // Gönder (Telegram HTTP)
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      // (Next.js node runtime'da fetch globaldir; özel timeout ihtiyacın olursa AbortController ekleyebiliriz)
    });
  } catch (e) {
    console.error("[telegram] send error", e);
  }
}
