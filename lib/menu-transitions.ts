import {
  MENU_NAV_KEYS,
  type MenuNavKey,
} from "@/lib/menu-navigation";

export const MENU_TRANSITION_STYLES = [
  "edge-glow",
  "color-wave",
  "soft-ribbon",
  "cinematic-video",
  "theme-auto",
  "minimal",
] as const;

export type MenuTransitionStyle = (typeof MENU_TRANSITION_STYLES)[number];
export type MenuTransitionOverride = MenuTransitionStyle | "inherit";

export type MenuTransitionSettings = {
  enabled: boolean;
  style: MenuTransitionStyle;
  durationMs: number;
  shadowStrength: number;
  labelEnabled: boolean;
  categoryColors: Record<MenuNavKey, string>;
  categoryStyles: Record<MenuNavKey, MenuTransitionOverride>;
};

export const DEFAULT_MENU_TRANSITION_COLORS: Record<MenuNavKey, string> = {
  burger: "#ff9418",
  vegan: "#43d17a",
  extras: "#f6bd36",
  drinks: "#38bdf8",
  hotdogs: "#ef6a38",
  sauces: "#f2c46d",
  donuts: "#f472b6",
  bubbletea: "#67e8f9",
};

const DEFAULT_CATEGORY_STYLES = MENU_NAV_KEYS.reduce(
  (out, key) => {
    out[key] = "inherit";
    return out;
  },
  {} as Record<MenuNavKey, MenuTransitionOverride>,
);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeStyle(value: unknown): MenuTransitionStyle {
  const raw = String(value || "").trim().toLowerCase();
  const aliases: Record<string, MenuTransitionStyle> = {
    arc: "edge-glow",
    signature: "edge-glow",
    "signature-arc": "edge-glow",
    edge: "edge-glow",
    glow: "edge-glow",
    color: "color-wave",
    wave: "color-wave",
    ribbon: "soft-ribbon",
    video: "cinematic-video",
    cinematic: "cinematic-video",
    theme: "theme-auto",
    automatic: "theme-auto",
    simple: "minimal",
  };

  if (raw in aliases) return aliases[raw];

  return (MENU_TRANSITION_STYLES as readonly string[]).includes(raw)
    ? (raw as MenuTransitionStyle)
    : "edge-glow";
}

function normalizeOverride(value: unknown): MenuTransitionOverride {
  if (String(value || "").trim().toLowerCase() === "inherit") {
    return "inherit";
  }

  return normalizeStyle(value);
}

function normalizeColor(value: unknown, fallback: string) {
  const raw = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : fallback;
}

export function createDefaultMenuTransitionSettings(): MenuTransitionSettings {
  return {
    enabled: true,
    style: "edge-glow",
    durationMs: 440,
    shadowStrength: 52,
    labelEnabled: true,
    categoryColors: { ...DEFAULT_MENU_TRANSITION_COLORS },
    categoryStyles: { ...DEFAULT_CATEGORY_STYLES },
  };
}

export function normalizeMenuTransitionSettings(
  value: unknown,
): MenuTransitionSettings {
  const defaults = createDefaultMenuTransitionSettings();
  const raw = isPlainObject(value) ? value : {};
  const rawColors = isPlainObject(raw.categoryColors) ? raw.categoryColors : {};
  const rawStyles = isPlainObject(raw.categoryStyles) ? raw.categoryStyles : {};

  const categoryColors = { ...defaults.categoryColors };
  const categoryStyles = { ...defaults.categoryStyles };
  const rawDuration = Number(raw.durationMs);
  const rawShadowStrength = Number(raw.shadowStrength);

  for (const key of MENU_NAV_KEYS) {
    categoryColors[key] = normalizeColor(
      rawColors[key],
      defaults.categoryColors[key],
    );
    categoryStyles[key] = normalizeOverride(rawStyles[key]);
  }

  return {
    enabled: raw.enabled !== false,
    style: normalizeStyle(raw.style),
    durationMs: clamp(
      Number.isFinite(rawDuration) ? rawDuration : defaults.durationMs,
      280,
      900,
    ),
    shadowStrength: clamp(
      Number.isFinite(rawShadowStrength)
        ? rawShadowStrength
        : defaults.shadowStrength,
      0,
      100,
    ),
    labelEnabled: raw.labelEnabled !== false,
    categoryColors,
    categoryStyles,
  };
}

export function resolveMenuTransitionStyle(
  settings: MenuTransitionSettings,
  category: MenuNavKey,
) {
  const override = settings.categoryStyles[category];
  return override && override !== "inherit" ? override : settings.style;
}
