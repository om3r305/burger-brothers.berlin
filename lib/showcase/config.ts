import type {
  ShowcaseDocument,
  ShowcaseMediaItem,
  ShowcaseScene,
  ShowcaseSceneType,
  ShowcaseTransition,
} from "./types";
import { normalizeShowcaseCategory } from "./runtime";
import { canonicalSceneType } from "./editor";
import { specialDayPresetIsActive, type WeatherCopyKey } from "./presets";

const SCENE_TYPES = new Set<ShowcaseSceneType>([
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
  "review-qr",
  "countdown",
  "bestseller",
  "special-day",
  "social-video",
]);

const TRANSITIONS = new Set<ShowcaseTransition>([
  "fade",
  "slide",
  "zoom",
  "none",
]);

function cleanText(value: any, max = 300) {
  return String(value ?? "").trim().slice(0, max);
}

function hasOwn(value: any, key: string) {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function cleanStringList(value: any, maxItems: number, maxLength = 120) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .slice(0, maxItems)
        .map((item) => cleanText(item, maxLength))
        .filter(Boolean),
    ),
  );
}

function cleanUrl(value: any, max = 2_000) {
  const text = cleanText(value, max);
  if (!text) return "";
  if (text.startsWith("/")) return text;

  try {
    const url = new URL(text);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function cleanDate(value: any) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : "";
}

function bool(value: any, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function numberInRange(value: any, fallback: number, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function id(value: any, prefix = "scene") {
  const text = cleanText(value, 100).replace(/[^a-zA-Z0-9_-]/g, "");
  if (text) return text;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createDefaultShowcaseDocument(siteUrl = "https://www.burger-brothers.berlin"): ShowcaseDocument {
  const now = new Date().toISOString();

  return {
    schemaVersion: 1,
    version: `initial-${Date.now().toString(36)}`,
    enabled: true,
    updatedAt: now,
    settings: {
      name: "Burger Brothers Vitrin Ekranı",
      defaultDurationSeconds: 45,
      refreshSeconds: 15,
      showClock: true,
      showProgress: true,
      showConnectionState: false,
      qrUrl: siteUrl,
      qrLabel: "Jetzt online bestellen",
      ticker: "Frisch gegrillt • Direkt online bestellen • Burger Brothers Berlin",
      background: "theme",
    },
    scenes: [
      {
        id: "willkommen",
        type: "hero",
        name: "Karşılama",
        enabled: true,
        durationSeconds: 45,
        transition: "fade",
        title: "JETZT ONLINE BESTELLEN",
        subtitle: "QR-Code scannen und direkt zur Speisekarte",
        badge: "BERLIN-TEGEL",
        qrLabel: "Jetzt online bestellen",
        showLogo: true,
        showQr: true,
        fit: "cover",
        muted: true,
      },
      {
        id: "online-bestellen",
        type: "qr",
        name: "Online sipariş",
        enabled: true,
        durationSeconds: 25,
        transition: "zoom",
        title: "JETZT ONLINE BESTELLEN",
        subtitle: "QR-Code scannen und direkt zur Speisekarte",
        qrUrl: siteUrl,
        qrLabel: "burger-brothers.berlin",
        showLogo: true,
        showQr: true,
        fit: "contain",
        muted: true,
      },
    ],
  };
}

export function normalizeShowcaseScene(value: any, fallbackDuration = 45): ShowcaseScene {
  const legacyType = SCENE_TYPES.has(value?.type) ? value.type as ShowcaseSceneType : "message";
  const type = canonicalSceneType(legacyType);
  const transition = TRANSITIONS.has(value?.transition) ? value.transition : "fade";
  const accent = /^#[0-9a-f]{6}$/i.test(String(value?.accent || ""))
    ? String(value.accent)
    : "#ff9d2e";
  const legacyProductId = cleanText(value?.productId, 120);
  const productIds = cleanStringList(value?.productIds, 50, 120);
  const menuCategories = Array.from(
    new Set(
      cleanStringList(value?.menuCategories, 30, 80)
        .map((category) => normalizeShowcaseCategory(category))
        .filter(Boolean),
    ),
  );
  const normalizedProductIds = productIds.length
    ? productIds
    : legacyProductId
      ? [legacyProductId]
      : [];
  const showLogoFallback = type === "product" || type === "menu" ? false : true;
  const weatherMessages = Object.fromEntries(
    Object.entries(value?.weatherMessages || {})
      .map(([key, message]) => [key, cleanText(message, 240)])
      .filter(([, message]) => Boolean(message)),
  ) as Partial<Record<WeatherCopyKey, string>>;

  const qrVariant = legacyType === "review-qr"
    ? "google-review"
    : ["order", "google-review", "custom"].includes(value?.qrVariant)
      ? value.qrVariant
      : "order";
  const videoVariant = legacyType === "social-video"
    ? "social"
    : value?.videoVariant === "social" ? "social" : "standard";
  const campaignVariant = legacyType === "countdown"
    ? "countdown"
    : value?.campaignVariant === "countdown" ? "countdown" : "standard";
  const messageVariant = legacyType === "special-day"
    ? "special-day"
    : value?.messageVariant === "special-day" ? "special-day" : "standard";

  return {
    id: id(value?.id),
    type,
    name: cleanText(value?.name || value?.title || "Sahne", 120),
    enabled: bool(value?.enabled, true),
    durationSeconds: numberInRange(value?.durationSeconds, fallbackDuration, 5, 3_600),
    transition,
    startAt: cleanDate(value?.startAt) || undefined,
    endAt: cleanDate(value?.endAt) || undefined,
    title: cleanText(value?.title, 180),
    subtitle: cleanText(value?.subtitle, 260),
    body: cleanText(value?.body, 1_200),
    badge: cleanText(value?.badge, 80),
    mediaUrl: cleanUrl(value?.mediaUrl) || undefined,
    posterUrl: cleanUrl(value?.posterUrl) || undefined,
    productId: normalizedProductIds[0] || undefined,
    productIds: normalizedProductIds.length ? normalizedProductIds : [],
    productSeconds: numberInRange(value?.productSeconds, 12, 6, 120),
    productLimit: numberInRange(value?.productLimit, 8, 1, 20),
    productMaxTotalSeconds: numberInRange(value?.productMaxTotalSeconds, 90, 15, 300),
    productImageFit: value?.productImageFit === "cover" ? "cover" : "contain",
    productImageScale: numberInRange(value?.productImageScale, 78, 35, 130),
    productImageX: numberInRange(value?.productImageX, 0, -40, 40),
    productImageY: numberInRange(value?.productImageY, 0, -40, 40),
    menuCategories,
    menuItemsPerPage: numberInRange(value?.menuItemsPerPage, 8, 4, 24),
    menuPageSeconds: numberInRange(value?.menuPageSeconds, 12, 6, 120),
    menuColumns: Number(value?.menuColumns) === 3 ? 3 : 2,
    menuShowDescriptions: bool(value?.menuShowDescriptions, false),
    menuShowImages: bool(value?.menuShowImages, true),
    menuImageSize: numberInRange(value?.menuImageSize, 58, 36, 104),
    campaignId: cleanText(value?.campaignId, 120) || undefined,
    campaignAutoContent: bool(value?.campaignAutoContent, true),
    qrUrl: cleanUrl(value?.qrUrl) || undefined,
    qrLabel: cleanText(value?.qrLabel, 120),
    accent,
    fit: value?.fit === "contain" ? "contain" : "cover",
    showLogo: bool(value?.showLogo, showLogoFallback),
    showQr: bool(value?.showQr, false),
    showPrice: bool(value?.showPrice, true),
    muted: bool(value?.muted, true),
    videoVariant,
    qrVariant,
    campaignVariant,
    messageVariant,
    reviewMinRating: numberInRange(value?.reviewMinRating, 4, 1, 5),
    reviewOnlyWithPhoto: bool(value?.reviewOnlyWithPhoto, false),
    reviewLimit: numberInRange(value?.reviewLimit, 8, 1, 30),
    reviewSort: value?.reviewSort === "random" ? "random" : "newest",
    countdownTargetAt: cleanDate(value?.countdownTargetAt) || undefined,
    bestsellerPeriodDays: numberInRange(value?.bestsellerPeriodDays, 7, 1, 365),
    bestsellerLimit: numberInRange(value?.bestsellerLimit, 5, 1, 10),
    specialTheme: ["love", "mother", "father", "halloween", "christmas", "new-year", "easter", "germany", "berlin", "celebration", "winter", "classic"].includes(value?.specialTheme)
      ? value.specialTheme
      : "classic",
    specialEmoji: cleanText(value?.specialEmoji, 16),
    specialLogoUrl: cleanUrl(value?.specialLogoUrl) || undefined,
    specialPreset: cleanText(value?.specialPreset, 80) || undefined,
    specialAutoSchedule: bool(value?.specialAutoSchedule, false),
    countdownEndBehavior: value?.countdownEndBehavior === "ended" ? "ended" : "skip",
    weatherMode: value?.weatherMode === "custom" ? "custom" : "auto",
    weatherMessages,
  };
}

export function normalizeShowcaseDocument(value: any, siteUrl = "https://www.burger-brothers.berlin"): ShowcaseDocument {
  const defaults = createDefaultShowcaseDocument(siteUrl);
  const defaultDuration = numberInRange(
    value?.settings?.defaultDurationSeconds,
    defaults.settings.defaultDurationSeconds,
    5,
    3_600,
  );
  const scenes = Array.isArray(value?.scenes)
    ? value.scenes.slice(0, 100).map((scene: any) => normalizeShowcaseScene(scene, defaultDuration))
    : defaults.scenes;

  return {
    schemaVersion: 1,
    version: cleanText(value?.version, 120) || `draft-${Date.now().toString(36)}`,
    enabled: bool(value?.enabled, true),
    updatedAt: cleanDate(value?.updatedAt) || new Date().toISOString(),
    publishedAt: cleanDate(value?.publishedAt) || undefined,
    settings: {
      name: cleanText(value?.settings?.name, 120) || defaults.settings.name,
      defaultDurationSeconds: defaultDuration,
      refreshSeconds: numberInRange(value?.settings?.refreshSeconds, 15, 10, 60),
      showClock: bool(value?.settings?.showClock, true),
      showProgress: bool(value?.settings?.showProgress, true),
      showConnectionState: bool(value?.settings?.showConnectionState, false),
      qrUrl: cleanUrl(value?.settings?.qrUrl) || siteUrl,
      // Ayar anahtarı hiç yoksa ilk kurulum varsayılanını kullan.
      // Anahtar mevcut ve değer boşsa kullanıcının "gizle" tercihini koru.
      qrLabel: hasOwn(value?.settings, "qrLabel")
        ? cleanText(value?.settings?.qrLabel, 120)
        : defaults.settings.qrLabel,
      ticker: hasOwn(value?.settings, "ticker")
        ? cleanText(value?.settings?.ticker, 500)
        : defaults.settings.ticker,
      background: ["theme", "dark", "black"].includes(value?.settings?.background)
        ? value.settings.background
        : "theme",
    },
    scenes: scenes.length ? scenes : defaults.scenes,
  };
}

export function normalizeShowcaseMediaList(value: any): ShowcaseMediaItem[] {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 500)
    .map((item: any) => ({
      id: id(item?.id, "media"),
      key: cleanText(item?.key || item?.publicId, 500),
      provider: ["cloudinary", "r2", "external"].includes(item?.provider)
        ? item.provider
        : undefined,
      publicId: cleanText(item?.publicId, 500) || undefined,
      resourceType: ["image", "video"].includes(item?.resourceType)
        ? item.resourceType
        : undefined,
      assetId: cleanText(item?.assetId, 160) || undefined,
      version: item?.version
        ? numberInRange(item.version, 0, 0, Number.MAX_SAFE_INTEGER)
        : undefined,
      format: cleanText(item?.format, 30) || undefined,
      name: cleanText(item?.name, 220) || "Dosya",
      url: cleanUrl(item?.url),
      mimeType: cleanText(item?.mimeType, 120),
      size: numberInRange(item?.size, 0, 0, 2_000_000_000),
      createdAt: cleanDate(item?.createdAt) || new Date().toISOString(),
      width: item?.width ? numberInRange(item.width, 0, 0, 20_000) : undefined,
      height: item?.height ? numberInRange(item.height, 0, 0, 20_000) : undefined,
      durationSeconds: item?.durationSeconds
        ? numberInRange(item.durationSeconds, 0, 0, 86_400)
        : undefined,
    }))
    .filter((item) => item.key && item.url && item.mimeType);
}

function specialPresetIsActive(scene: ShowcaseScene, now: number) {
  const isSpecialDay = scene.type === "special-day" || (scene.type === "message" && scene.messageVariant === "special-day");
  if (!scene.specialAutoSchedule || !isSpecialDay) return true;
  return specialDayPresetIsActive(scene.specialPreset || scene.specialTheme, now);
}

export function sceneIsActive(scene: ShowcaseScene, now = Date.now()) {
  if (!scene.enabled) return false;
  if (!specialPresetIsActive(scene, now)) return false;
  const start = scene.startAt ? Date.parse(scene.startAt) : NaN;
  const end = scene.endAt ? Date.parse(scene.endAt) : NaN;
  if (Number.isFinite(start) && now < start) return false;
  if (Number.isFinite(end) && now > end) return false;
  const isCountdown = scene.type === "countdown" || (scene.type === "campaign" && scene.campaignVariant === "countdown");
  if (isCountdown && scene.countdownEndBehavior !== "ended") {
    const target = scene.countdownTargetAt ? Date.parse(scene.countdownTargetAt) : NaN;
    if (Number.isFinite(target) && now >= target) return false;
  }
  return true;
}
