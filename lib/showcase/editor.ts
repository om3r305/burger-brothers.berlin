import type {
  ShowcaseCampaign,
  ShowcaseDocument,
  ShowcaseScene,
  ShowcaseSceneType,
} from "./types";
import { applySpecialDayPreset } from "./presets";

export const CANONICAL_SCENE_TYPES = [
  "hero",
  "video",
  "product",
  "menu",
  "campaign",
  "image",
  "qr",
  "message",
  "weather",
  "reviews",
  "bestseller",
] as const satisfies readonly ShowcaseSceneType[];

export type CanonicalShowcaseSceneType = (typeof CANONICAL_SCENE_TYPES)[number];

export const TYPE_LABELS: Record<CanonicalShowcaseSceneType, string> = {
  hero: "Giriş ekranı",
  video: "Video",
  product: "Ürün akışı",
  menu: "Dijital menü",
  campaign: "Kampanya / Geri sayım",
  image: "Görsel",
  qr: "QR / Yorum çağrısı",
  message: "Duyuru / Özel gün",
  weather: "Hava durumu",
  reviews: "Google yorumları",
  bestseller: "Bestseller",
};

export const TYPE_ICONS: Record<CanonicalShowcaseSceneType, string> = {
  hero: "🔥",
  video: "🎬",
  product: "🍔",
  menu: "📋",
  campaign: "🏷️",
  image: "🖼️",
  qr: "📱",
  message: "💬",
  weather: "🌤️",
  reviews: "⭐",
  bestseller: "🏆",
};

function uid(prefix = "scene") {
  try {
    return `${prefix}-${crypto.randomUUID()}`;
  } catch {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

export function canonicalSceneType(type: ShowcaseSceneType): CanonicalShowcaseSceneType {
  if (type === "review-qr") return "qr";
  if (type === "social-video") return "video";
  if (type === "countdown") return "campaign";
  if (type === "special-day") return "message";
  return (CANONICAL_SCENE_TYPES as readonly string[]).includes(type)
    ? (type as CanonicalShowcaseSceneType)
    : "message";
}

export function createShowcaseScene(
  type: CanonicalShowcaseSceneType,
  document: ShowcaseDocument,
): ShowcaseScene {
  const common: ShowcaseScene = {
    id: uid(),
    type,
    name: TYPE_LABELS[type],
    enabled: true,
    durationSeconds: document.settings.defaultDurationSeconds,
    transition: "fade",
    accent: "#ff9d2e",
    fit: "cover",
    showLogo: type !== "product" && type !== "menu",
    showQr: type !== "video",
    qrLabel: document.settings.qrLabel,
    showPrice: true,
    muted: true,
  };

  switch (type) {
    case "hero":
      return { ...common, title: "BURGER BROTHERS BERLIN", subtitle: "Frisch gegrillt. Direkt bestellt.", badge: "BERLIN-TEGEL" };
    case "video":
      return { ...common, name: "Yeni video", title: "Frisch für Sie zubereitet", subtitle: "Burger Brothers Berlin", showQr: false, videoVariant: "standard" };
    case "product":
      return {
        ...common,
        name: "Ürün akışı",
        title: "BURGER BROTHERS EMPFIEHLT",
        subtitle: "Frisch zubereitet und voller Geschmack.",
        productIds: [],
        productSeconds: 12,
        productLimit: 8,
        productMaxTotalSeconds: 90,
        productImageFit: "contain",
        productImageScale: 82,
        productImageX: 0,
        productImageY: 0,
        showLogo: false,
        showQr: false,
        fit: "contain",
      };
    case "menu":
      return {
        ...common,
        name: "Dijital menü",
        title: "UNSERE SPEISEKARTE",
        subtitle: "Frisch zubereitet. Direkt online bestellen.",
        menuCategories: [],
        menuItemsPerPage: 8,
        menuPageSeconds: 12,
        menuColumns: 2,
        menuShowDescriptions: false,
        menuShowImages: true,
        menuImageSize: 58,
        showLogo: false,
        showQr: false,
      };
    case "campaign":
      return {
        ...common,
        name: "Kampanya",
        title: "AKTUELLE AKTION",
        subtitle: "Nur für kurze Zeit",
        badge: "LIMITIERTE AKTION",
        campaignVariant: "standard",
        campaignAutoContent: true,
        countdownEndBehavior: "skip",
      };
    case "image":
      return { ...common, name: "Görsel", title: "Burger Brothers Berlin", showQr: false };
    case "qr":
      return {
        ...common,
        name: "Online sipariş",
        title: "JETZT ONLINE BESTELLEN",
        subtitle: "QR-Code scannen und direkt zur Speisekarte",
        qrVariant: "order",
      };
    case "message":
      return {
        ...common,
        name: "Duyuru",
        title: "WICHTIGE MITTEILUNG",
        subtitle: "Aktuelle Informationen von Burger Brothers Berlin.",
        body: "Öffnungszeiten, Lieferhinweise oder eine besondere Ankündigung hier eintragen.",
        badge: "",
        messageVariant: "standard",
        showQr: false,
      };
    case "weather":
      return { ...common, name: "Hava durumu", title: "", body: "", showQr: false, weatherMode: "auto" };
    case "reviews":
      return { ...common, name: "Google yorumları", title: "", reviewMinRating: 4, reviewOnlyWithPhoto: false, reviewLimit: 8, reviewSort: "newest", showQr: false };
    case "bestseller":
      return { ...common, name: "Bestseller", title: "UNSERE BESTSELLER", bestsellerPeriodDays: 7, bestsellerLimit: 5, showQr: false };
  }
}

/**
 * Sahne tipi değişiminde eski tipe ait alanları taşımamak için yeni sahneyi temiz
 * varsayımlardan oluşturur; yalnız evrensel alanları korur.
 */
export function replaceSceneType(
  scene: ShowcaseScene,
  type: CanonicalShowcaseSceneType,
  document: ShowcaseDocument,
): ShowcaseScene {
  const fresh = createShowcaseScene(type, document);
  return {
    ...fresh,
    id: scene.id,
    enabled: scene.enabled,
    durationSeconds: scene.durationSeconds,
    transition: scene.transition,
    startAt: scene.startAt,
    endAt: scene.endAt,
    accent: scene.accent || fresh.accent,
  };
}

function campaignPayloadText(campaign: ShowcaseCampaign, keys: string[]) {
  const payload = campaign.payload || {};
  for (const key of keys) {
    const value = payload[key];
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return "";
}

export function campaignScenePatch(
  campaign: ShowcaseCampaign | undefined,
  variant: "standard" | "countdown",
): Partial<ShowcaseScene> {
  if (!campaign) return { campaignId: undefined };
  const payload = campaign.payload || {};
  const percent = Number(payload.percent ?? payload.value ?? payload.amount);
  const automaticTitle = Number.isFinite(percent) && percent > 0
    ? `${Math.round(percent)}% RABATT`
    : campaignPayloadText(campaign, ["headline", "name", "title"]) || campaign.title;
  return {
    campaignId: campaign.id,
    campaignVariant: variant,
    campaignAutoContent: true,
    title: automaticTitle,
    subtitle: campaign.title,
    badge: campaign.badgeText || campaignPayloadText(campaign, ["badge", "badgeText"]) || "LIMITIERTE AKTION",
    body: campaignPayloadText(campaign, ["description", "body", "text"]),
    countdownTargetAt: variant === "countdown" ? campaign.endsAt || undefined : undefined,
    endAt: campaign.endsAt || undefined,
    startAt: campaign.startsAt || undefined,
  };
}

export function reviewQrPatch(document: ShowcaseDocument): Partial<ShowcaseScene> {
  return {
    qrVariant: "google-review",
    name: "Google yorum çağrısı",
    title: "DEINE MEINUNG ZÄHLT ❤️",
    body: "Teile dein Burger-Erlebnis. Dein Foto könnte schon bald hier erscheinen.",
    qrUrl: document.settings.qrUrl,
    qrLabel: "Jetzt bewerten",
    showQr: true,
  };
}

export function socialVideoPatch(): Partial<ShowcaseScene> {
  return {
    videoVariant: "social",
    name: "Sosyal video",
    title: "Folge uns",
    subtitle: "@burgerbrotherstegel",
    showQr: false,
  };
}

export function specialDayPatch(): Partial<ShowcaseScene> {
  return {
    ...applySpecialDayPreset("celebration"),
    name: "Özel gün",
    messageVariant: "special-day",
    specialAutoSchedule: false,
    showQr: false,
  };
}

export type ShowcaseValidationResult =
  | { ok: true }
  | { ok: false; sceneId?: string; message: string };

export function validateShowcaseDocument(document: ShowcaseDocument): ShowcaseValidationResult {
  const invalidCountdown = document.scenes.find((scene) => {
    const isCountdown = scene.type === "countdown" || (scene.type === "campaign" && scene.campaignVariant === "countdown");
    return scene.enabled && isCountdown && !scene.countdownTargetAt && !scene.endAt;
  });
  if (invalidCountdown) {
    return { ok: false, sceneId: invalidCountdown.id, message: `“${invalidCountdown.name}” için bir bitiş zamanı seçmelisin.` };
  }
  return { ok: true };
}
