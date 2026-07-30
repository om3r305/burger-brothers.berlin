// lib/themes.ts
// Burger Brothers seasonal theme engine — DB-friendly, framework-agnostic.

export const THEME_IDS = [
  "classic",
  "neon",
  "easter",
  "summer",
  "fathersday",
  "school",
  "veganweek",
  "fan",
  "oktoberfest",
  "lights",
  "germany",
  "halloween",
  "blackweek",
  "christmas",
  "winter",
  "newyear",
  "valentines",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];
export type ThemeEffect =
  | "ember"
  | "circuit"
  | "petals"
  | "sunrays"
  | "heritage"
  | "confetti"
  | "leaves"
  | "stadium"
  | "diamonds"
  | "aurora"
  | "ribbons"
  | "fog"
  | "facets"
  | "festive-lights"
  | "frost"
  | "fireworks"
  | "hearts";
export type ThemeMode = "manual" | "automatic";
export type ThemeScheduleStatus =
  | "active"
  | "ending"
  | "upcoming"
  | "ended"
  | "inactive";

export type ThemePreset = {
  id: ThemeId;
  label: string;
  icon: string;
  description: string;
  themeColor: string;
  cornerLeft: string;
  cornerRight: string;
  particles: string[];
  effect: ThemeEffect;
  motifs: string[];
  burst: string[];
  density: 0 | 1 | 2;
};

export type ThemeScheduleEntry = {
  id: string;
  name: string;
  theme: ThemeId;
  enabled: boolean;
  startAt?: string;
  endAt?: string;
  repeatYearly?: boolean;
  priority?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type ThemeSettings = {
  active: ThemeId;
  mode: ThemeMode;
  automatic: boolean;
  decorationsEnabled: boolean;
  motionEnabled: boolean;
  snow: boolean;
  bgVideoUrl: string;
  logos: Partial<Record<ThemeId, string>>;
  videos: Partial<Record<ThemeId, string>>;
  schedule: ThemeScheduleEntry[];
  [key: string]: any;
};

export type ResolvedTheme = {
  theme: ThemeId;
  source: "manual" | "schedule" | "fallback";
  scheduleId: string | null;
  scheduleName: string | null;
  settings: ThemeSettings;
};

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "classic",
    label: "Classic",
    icon: "🍔",
    description: "Burger Brothers Orange & Gold – klar, hochwertig und zeitlos.",
    themeColor: "#0b0704",
    cornerLeft: "🍔",
    cornerRight: "🔥",
    particles: [],
    effect: "ember",
    motifs: ["✦", "·"],
    burst: ["✦", "🔥", "·"],
    density: 1,
  },
  {
    id: "neon",
    label: "Neon Night",
    icon: "⚡",
    description: "Grün–cyanfarbene Neonlinien für einen modernen Nacht-Look.",
    themeColor: "#06120a",
    cornerLeft: "⚡",
    cornerRight: "✦",
    particles: ["✦", "·", "⚡"],
    effect: "circuit",
    motifs: ["⌁", "＋", "✦"],
    burst: ["⚡", "✦", "＋"],
    density: 1,
  },
  {
    id: "easter",
    label: "Frühling / Ostern",
    icon: "🐰",
    description: "Pastellfarben, Ostereier und dezente Frühlingsdetails.",
    themeColor: "#102116",
    cornerLeft: "🐰",
    cornerRight: "🥚",
    particles: ["🌸", "·", "🌿"],
    effect: "petals",
    motifs: ["❀", "🌿", "·"],
    burst: ["🌸", "✦", "🌿"],
    density: 1,
  },
  {
    id: "summer",
    label: "Berlin Sommer",
    icon: "☀️",
    description: "Sonniger Gelb–Blau-Look, ideal für Getränke und Bubble Tea.",
    themeColor: "#071629",
    cornerLeft: "☀️",
    cornerRight: "🥤",
    particles: ["✦", "☀", "·"],
    effect: "sunrays",
    motifs: ["☀", "✦", "≈"],
    burst: ["☀", "✦", "🥤"],
    density: 1,
  },
  {
    id: "fathersday",
    label: "Vatertag",
    icon: "🧢",
    description: "Kraftvolles Navy–Kupfer-Design für Christi Himmelfahrt und Vatertag.",
    themeColor: "#07131d",
    cornerLeft: "🧢",
    cornerRight: "🍔",
    particles: ["◆", "✦", "·"],
    effect: "heritage",
    motifs: ["◆", "ⅹ", "✦"],
    burst: ["◆", "🍔", "✦"],
    density: 1,
  },
  {
    id: "school",
    label: "Schulstart / Zeugnis",
    icon: "🎓",
    description: "Fröhliches, klares Design für Schulstart, Zeugnisse und verdiente Belohnungen.",
    themeColor: "#111232",
    cornerLeft: "🎓",
    cornerRight: "⭐",
    particles: ["★", "✦", "·"],
    effect: "confetti",
    motifs: ["★", "▰", "✦"],
    burst: ["★", "🎉", "✦"],
    density: 2,
  },
  {
    id: "veganweek",
    label: "Vegan Week",
    icon: "🌱",
    description: "Ruhiger Smaragd-Look für Vegan Week und pflanzliche Aktionen.",
    themeColor: "#05170f",
    cornerLeft: "🌱",
    cornerRight: "🥬",
    particles: ["❧", "·", "✦"],
    effect: "leaves",
    motifs: ["❧", "⌁", "·"],
    burst: ["🌱", "❧", "✦"],
    density: 1,
  },
  {
    id: "fan",
    label: "Fan Sommer",
    icon: "⚽",
    description: "Stadion-Atmosphäre für Fußballturniere und wichtige Spieltage.",
    themeColor: "#07170b",
    cornerLeft: "⚽",
    cornerRight: "🏟️",
    particles: ["⚽", "·", "✦"],
    effect: "stadium",
    motifs: ["○", "╱", "✦"],
    burst: ["⚽", "✦", "★"],
    density: 1,
  },
  {
    id: "oktoberfest",
    label: "Oktoberfest / Wiesn",
    icon: "🥨",
    description: "Blau-weißes Bayern-Muster mit Holz- und Brezel-Details.",
    themeColor: "#07172a",
    cornerLeft: "🥨",
    cornerRight: "🍺",
    particles: ["◇", "🥨", "·"],
    effect: "diamonds",
    motifs: ["◇", "◆", "·"],
    burst: ["🥨", "◇", "✦"],
    density: 1,
  },
  {
    id: "lights",
    label: "Berlin Lights",
    icon: "✨",
    description: "Violett-blaue Lichtlinien im Festival-of-Lights-Stil.",
    themeColor: "#0b0820",
    cornerLeft: "✨",
    cornerRight: "🏙️",
    particles: ["✦", "✧", "·"],
    effect: "aurora",
    motifs: ["✦", "╱", "✧"],
    burst: ["✦", "✧", "⚡"],
    density: 2,
  },
  {
    id: "germany",
    label: "Deutschland / Einheit",
    icon: "🇩🇪",
    description: "Reduziertes Schwarz–Rot–Gold für den Tag der Deutschen Einheit.",
    themeColor: "#100b05",
    cornerLeft: "🇩🇪",
    cornerRight: "🤝",
    particles: ["◆", "·", "✦"],
    effect: "ribbons",
    motifs: ["━", "◆", "✦"],
    burst: ["◆", "✦", "🤝"],
    density: 1,
  },
  {
    id: "halloween",
    label: "Halloween",
    icon: "🎃",
    description: "Kinoartiges Violett–Orange mit Kürbislicht, Fledermäusen und dezentem Nebel.",
    themeColor: "#15071d",
    cornerLeft: "🎃",
    cornerRight: "🦇",
    particles: ["🦇", "✦", "·"],
    effect: "fog",
    motifs: ["⌁", "🦇", "·"],
    burst: ["🎃", "🦇", "✦"],
    density: 1,
  },
  {
    id: "blackweek",
    label: "Black Week",
    icon: "🖤",
    description: "Schwarz–Gold für starke, moderne Angebotskampagnen.",
    themeColor: "#050505",
    cornerLeft: "◆",
    cornerRight: "✦",
    particles: ["✦", "◆", "·"],
    effect: "facets",
    motifs: ["◆", "◇", "✦"],
    burst: ["◆", "✦", "★"],
    density: 1,
  },
  {
    id: "christmas",
    label: "Christmas / Advent",
    icon: "🎄",
    description: "Tiefes Tannengrün, warmes Gold, Adventslichter und ruhiger Schnee.",
    themeColor: "#07140d",
    cornerLeft: "🎄",
    cornerRight: "🎁",
    particles: ["❄", "✦", "·"],
    effect: "festive-lights",
    motifs: ["✦", "●", "❄"],
    burst: ["🎄", "✦", "❄"],
    density: 2,
  },
  {
    id: "winter",
    label: "Winter",
    icon: "❄️",
    description: "Klares Eisblau mit Frostkante, weichem Licht und ruhigen Schneeflocken.",
    themeColor: "#071523",
    cornerLeft: "❄️",
    cornerRight: "☕",
    particles: ["❄", "·", "✦"],
    effect: "frost",
    motifs: ["❄", "✦", "·"],
    burst: ["❄", "✦", "◇"],
    density: 1,
  },
  {
    id: "newyear",
    label: "Silvester / Neujahr",
    icon: "🎆",
    description: "Schwarz–Gold mit Feuerwerk und festlichen Details.",
    themeColor: "#09070f",
    cornerLeft: "🎆",
    cornerRight: "🥂",
    particles: ["✦", "★", "·"],
    effect: "fireworks",
    motifs: ["✦", "★", "·"],
    burst: ["✦", "★", "🎆"],
    density: 2,
  },
  {
    id: "valentines",
    label: "Valentine's",
    icon: "❤️",
    description: "Dunkelrot–Rosa, passend für Couple- und Zwei-Menü-Angebote.",
    themeColor: "#19070d",
    cornerLeft: "❤️",
    cornerRight: "🍔",
    particles: ["♥", "♡", "·"],
    effect: "hearts",
    motifs: ["♥", "♡", "·"],
    burst: ["♥", "♡", "✦"],
    density: 1,
  },
];

export const THEME_PRESET_MAP = Object.fromEntries(
  THEME_PRESETS.map((preset) => [preset.id, preset]),
) as Record<ThemeId, ThemePreset>;

function rid(prefix = "theme") {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch {}

  return `${prefix}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function bool(value: any, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value == null || value === "") return fallback;

  const text = String(value).toLowerCase().trim();
  if (["1", "true", "yes", "ja", "on"].includes(text)) return true;
  if (["0", "false", "no", "nein", "off"].includes(text)) return false;

  return fallback;
}

function num(value: any, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanAsset(value: any) {
  const text = String(value || "").trim();
  if (!text || text.includes("...")) return "";
  return text;
}

function safeDate(value: any) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : "";
}

export function normalizeThemeId(value: any): ThemeId {
  const text = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[\s_-]+/g, "");

  const aliases: Record<string, ThemeId> = {
    default: "classic",
    classic: "classic",
    neon: "neon",
    easter: "easter",
    ostern: "easter",
    spring: "easter",
    fruehling: "easter",
    frühling: "easter",
    summer: "summer",
    sommer: "summer",
    berlinsommer: "summer",
    fathersday: "fathersday",
    father: "fathersday",
    vatertag: "fathersday",
    maennertag: "fathersday",
    männertag: "fathersday",
    school: "school",
    schulstart: "school",
    zeugnis: "school",
    karne: "school",
    veganweek: "veganweek",
    vegan: "veganweek",
    pflanzlich: "veganweek",
    fan: "fan",
    fansommer: "fan",
    football: "fan",
    fussball: "fan",
    fußball: "fan",
    oktoberfest: "oktoberfest",
    wiesn: "oktoberfest",
    lights: "lights",
    berlinlights: "lights",
    festivaloflights: "lights",
    germany: "germany",
    deutschland: "germany",
    deutscheeinheit: "germany",
    tagderdeutscheneinheit: "germany",
    halloween: "halloween",
    blackweek: "blackweek",
    blackfriday: "blackweek",
    christmas: "christmas",
    xmas: "christmas",
    weihnachten: "christmas",
    advent: "christmas",
    winter: "winter",
    newyear: "newyear",
    silvester: "newyear",
    neujahr: "newyear",
    valentines: "valentines",
    valentine: "valentines",
  };

  return aliases[text] || "classic";
}

export function getThemePreset(value: any): ThemePreset {
  return THEME_PRESET_MAP[normalizeThemeId(value)];
}

function emptyThemeAssets() {
  return Object.fromEntries(THEME_IDS.map((id) => [id, ""])) as Record<
    ThemeId,
    string
  >;
}

export function createDefaultThemeSettings(): ThemeSettings {
  return {
    active: "classic",
    mode: "manual",
    automatic: false,
    decorationsEnabled: true,
    motionEnabled: true,
    snow: true,
    bgVideoUrl: "",
    logos: emptyThemeAssets(),
    videos: emptyThemeAssets(),
    schedule: [],
  };
}

export function normalizeThemeSchedule(value: any): ThemeScheduleEntry[] {
  const list = Array.isArray(value) ? value : [];

  return list
    .map((raw: any, index: number) => {
      const theme = normalizeThemeId(raw?.theme ?? raw?.active ?? raw?.preset);
      const startAt = safeDate(raw?.startAt ?? raw?.startsAt);
      const endAt = safeDate(raw?.endAt ?? raw?.endsAt);

      return {
        id: String(raw?.id || `theme-rule-${index + 1}`),
        name: String(
          raw?.name || raw?.title || THEME_PRESET_MAP[theme].label,
        ).trim(),
        theme,
        enabled: raw?.enabled !== false && raw?.active !== false,
        startAt: startAt || undefined,
        endAt: endAt || undefined,
        repeatYearly: bool(raw?.repeatYearly, true),
        priority: Math.round(num(raw?.priority, 50)),
        createdAt: safeDate(raw?.createdAt) || undefined,
        updatedAt: safeDate(raw?.updatedAt) || undefined,
      } satisfies ThemeScheduleEntry;
    })
    .filter((entry) => entry.id && entry.name);
}

export function normalizeThemeSettings(value: any): ThemeSettings {
  const defaults = createDefaultThemeSettings();
  const raw = value && typeof value === "object" ? value : {};
  const active = normalizeThemeId(raw?.active ?? raw?.selected ?? raw?.preset);
  const automatic =
    raw?.mode === "automatic" ||
    raw?.automatic === true ||
    raw?.autoEnabled === true;

  const logos = emptyThemeAssets();
  const videos = emptyThemeAssets();

  for (const id of THEME_IDS) {
    logos[id] = cleanAsset(raw?.logos?.[id]);
    videos[id] = cleanAsset(raw?.videos?.[id]);
  }

  // Eski dört temalı yapı korunur.
  logos.classic ||= cleanAsset(raw?.logoClassic);
  logos.neon ||= cleanAsset(raw?.logoNeon);
  logos.christmas ||= cleanAsset(raw?.logoChristmas);
  logos.halloween ||= cleanAsset(raw?.logoHalloween);

  return {
    ...defaults,
    ...raw,
    active,
    mode: automatic ? "automatic" : "manual",
    automatic,
    decorationsEnabled: bool(raw?.decorationsEnabled, true),
    motionEnabled: bool(raw?.motionEnabled, true),
    snow: bool(raw?.snow, true),
    bgVideoUrl: cleanAsset(raw?.bgVideoUrl),
    logos,
    videos,
    schedule: normalizeThemeSchedule(raw?.schedule ?? raw?.calendar),
  };
}

function localDateTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
}

function easterSunday(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12);
}

function shiftedDate(date: Date, days: number) {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    12,
  );
}

function localDateTimeFromDate(date: Date, hour = 0, minute = 0) {
  return localDateTime(
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    hour,
    minute,
  );
}

export function createRecommendedThemeSchedule(
  year = new Date().getFullYear(),
): ThemeScheduleEntry[] {
  const now = new Date().toISOString();
  const make = (
    theme: ThemeId,
    name: string,
    startAt: string,
    endAt: string,
    priority: number,
    repeatYearly = true,
  ): ThemeScheduleEntry => ({
    id: rid(`theme-${theme}`),
    name,
    theme,
    enabled: true,
    startAt,
    endAt,
    repeatYearly,
    priority,
    createdAt: now,
    updatedAt: now,
  });

  const easter = easterSunday(year);
  const ascension = shiftedDate(easter, 39);

  return [
    make(
      "winter",
      "Winter",
      localDateTime(year, 1, 3),
      localDateTime(year, 2, 28, 23, 59),
      20,
    ),
    make(
      "valentines",
      "Valentine's Week",
      localDateTime(year, 2, 7),
      localDateTime(year, 2, 15, 23, 59),
      55,
    ),
    make(
      "easter",
      `Frühling / Ostern ${year}`,
      localDateTimeFromDate(shiftedDate(easter, -7)),
      localDateTimeFromDate(shiftedDate(easter, 1), 23, 59),
      50,
      false,
    ),
    make(
      "fathersday",
      `Vatertag ${year}`,
      localDateTimeFromDate(shiftedDate(ascension, -2)),
      localDateTimeFromDate(shiftedDate(ascension, 3), 23, 59),
      72,
      false,
    ),
    make(
      "summer",
      "Berlin Sommer",
      localDateTime(year, 6, 1),
      localDateTime(year, 8, 31, 23, 59),
      25,
    ),
    make(
      "fan",
      "Fan Sommer",
      localDateTime(year, 6, 10),
      localDateTime(year, 7, 20, 23, 59),
      60,
    ),
    make(
      "school",
      "Zeugnis-Belohnung · Berlin (Termin prüfen)",
      localDateTime(year, 1, 25),
      localDateTime(year, 2, 5, 23, 59),
      48,
    ),
    make(
      "school",
      "Schulstart · Berlin (Termin prüfen)",
      localDateTime(year, 8, 20),
      localDateTime(year, 9, 10, 23, 59),
      48,
    ),
    make(
      "oktoberfest",
      "Oktoberfest / Wiesn",
      localDateTime(year, 9, 15),
      localDateTime(year, 10, 5, 23, 59),
      65,
    ),
    make(
      "germany",
      "Tag der Deutschen Einheit",
      localDateTime(year, 9, 29),
      localDateTime(year, 10, 4, 23, 59),
      78,
    ),
    make(
      "lights",
      "Berlin Lights",
      localDateTime(year, 10, 6),
      localDateTime(year, 10, 20, 23, 59),
      70,
    ),
    make(
      "halloween",
      "Halloween",
      localDateTime(year, 10, 21),
      localDateTime(year, 11, 1, 23, 59),
      90,
    ),
    make(
      "veganweek",
      "World Vegan Week",
      localDateTime(year, 10, 28),
      localDateTime(year, 11, 7, 23, 59),
      58,
    ),
    make(
      "blackweek",
      "Black Week",
      localDateTime(year, 11, 20),
      localDateTime(year, 11, 30, 23, 59),
      95,
    ),
    make(
      "christmas",
      "Christmas / Advent",
      localDateTime(year, 12, 1),
      localDateTime(year, 12, 26, 23, 59),
      100,
    ),
    make(
      "newyear",
      "Silvester / Neujahr",
      localDateTime(year, 12, 27),
      localDateTime(year + 1, 1, 2, 23, 59),
      110,
    ),
  ];
}

function partsFromDate(date: Date) {
  return {
    month: date.getMonth(),
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
    ms: date.getMilliseconds(),
  };
}

function withYear(parts: ReturnType<typeof partsFromDate>, year: number) {
  return new Date(
    year,
    parts.month,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.ms,
  );
}

export function getScheduleWindow(
  entryInput: ThemeScheduleEntry,
  nowInput: Date | number = new Date(),
) {
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const hasStart = Boolean(entryInput.startAt);
  const hasEnd = Boolean(entryInput.endAt);
  const startOriginal = hasStart
    ? new Date(entryInput.startAt as string)
    : new Date(-8640000000000000);
  const endOriginal = hasEnd
    ? new Date(entryInput.endAt as string)
    : new Date(8640000000000000);

  if (!entryInput.repeatYearly || !hasStart || !hasEnd) {
    return {
      start: startOriginal,
      end: endOriginal,
    };
  }

  if (
    !Number.isFinite(startOriginal.valueOf()) ||
    !Number.isFinite(endOriginal.valueOf())
  ) {
    return { start: startOriginal, end: endOriginal };
  }

  const startParts = partsFromDate(startOriginal);
  const endParts = partsFromDate(endOriginal);
  const year = now.getFullYear();

  let start = withYear(startParts, year);
  let end = withYear(endParts, year);

  const crossesYear =
    endParts.month < startParts.month ||
    (endParts.month === startParts.month && endParts.day < startParts.day);

  if (crossesYear) {
    end = withYear(endParts, year + 1);

    // Ocak başında bir önceki Aralık'ta başlamış pencereyi yakala.
    if (now < start) {
      const previousStart = withYear(startParts, year - 1);
      const previousEnd = withYear(endParts, year);

      if (now <= previousEnd) {
        start = previousStart;
        end = previousEnd;
      }
    }
  }

  return { start, end };
}

export function getThemeScheduleStatus(
  entryInput: ThemeScheduleEntry,
  nowInput: Date | number = new Date(),
): ThemeScheduleStatus {
  if (!entryInput.enabled) return "inactive";

  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const { start, end } = getScheduleWindow(entryInput, now);

  if (Number.isFinite(start.valueOf()) && now < start) return "upcoming";
  if (Number.isFinite(end.valueOf()) && now > end) {
    return entryInput.repeatYearly ? "upcoming" : "ended";
  }

  if (
    Number.isFinite(end.valueOf()) &&
    end.valueOf() - now.valueOf() <= 48 * 60 * 60 * 1000
  ) {
    return "ending";
  }

  return "active";
}

export function resolveActiveTheme(
  value: any,
  nowInput: Date | number = new Date(),
): ResolvedTheme {
  const settings = normalizeThemeSettings(value);
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);

  if (settings.mode !== "automatic") {
    return {
      theme: settings.active,
      source: "manual",
      scheduleId: null,
      scheduleName: null,
      settings,
    };
  }

  const candidates = settings.schedule
    .filter((entry) => getThemeScheduleStatus(entry, now) === "active" || getThemeScheduleStatus(entry, now) === "ending")
    .sort((left, right) => {
      const priorityDiff = num(right.priority, 0) - num(left.priority, 0);
      if (priorityDiff !== 0) return priorityDiff;

      const leftStart = getScheduleWindow(left, now).start.valueOf();
      const rightStart = getScheduleWindow(right, now).start.valueOf();
      return rightStart - leftStart;
    });

  const selected = candidates[0];

  if (selected) {
    return {
      theme: selected.theme,
      source: "schedule",
      scheduleId: selected.id,
      scheduleName: selected.name,
      settings,
    };
  }

  return {
    theme: settings.active || "classic",
    source: "fallback",
    scheduleId: null,
    scheduleName: null,
    settings,
  };
}

export function safeThemeAsset(value: any, fallback = "") {
  const raw = cleanAsset(value);
  if (!raw) return fallback;
  if (/^https?:\/\//i.test(raw)) return raw;
  return raw.startsWith("/") ? raw : `/${raw}`;
}

export function getThemeLogo(
  value: any,
  themeInput: any,
  fallback: string,
) {
  const settings = normalizeThemeSettings(value);
  const theme = normalizeThemeId(themeInput);
  return safeThemeAsset(settings.logos?.[theme], fallback);
}

export function getThemeVideo(
  value: any,
  themeInput: any,
  fallback: string,
) {
  const settings = normalizeThemeSettings(value);
  const theme = normalizeThemeId(themeInput);
  return safeThemeAsset(
    settings.videos?.[theme] || settings.bgVideoUrl,
    fallback,
  );
}

export function themeColor(themeInput: any) {
  return getThemePreset(themeInput).themeColor;
}
