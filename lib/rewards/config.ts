export type RewardPhotoMode = "off" | "name" | "name_photo";

export type RewardWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type SchnellRewardPublic = {
  winId: string;
  code: string;
  label: string;
  customerLabel: string;
  discountAmount: number;
  percent?: number;
  productName?: string;
  celebrationSoundEnabled: boolean;
  celebrationSeconds: number;
  photoMode: RewardPhotoMode;
  photoRetentionMinutes: number;
};

export type RewardDaySchedule = {
  weekday: RewardWeekday;
  enabled: boolean;
  startTime: string;
  endTime: string;
  winnerCount: number;
};

export type RewardDefinitionType =
  | "percent_order"
  | "free_existing_category"
  | "free_burger"
  | "second_burger_percent"
  | "buy_one_get_one_burger";

export type RewardDefinition = {
  id: string;
  type: RewardDefinitionType;
  active: boolean;
  label: string;
  customerLabel: string;
  weight: number;
  percent?: number;
  category?: "burger" | "drinks" | "sauces" | "extras";
};

export type SchnellRewardProgram = {
  enabled: boolean;
  timezone: string;
  scheduleVersion: number;
  weekly: RewardDaySchedule[];
  pool: RewardDefinition[];
  maxWinsPerDevicePerDay: number;
  minOrdersBetweenWins: number;
  celebrationSoundEnabled: boolean;
  celebrationSeconds: number;
  photoMode: RewardPhotoMode;
  photoRetentionMinutes: number;
  autoPublishName: boolean;
  showcaseEnabled: boolean;
  targetAllActiveScreens: boolean;
  targetScreenSlugs: string[];
  showcaseDurationSeconds: number;
};

const WEEKDAYS: RewardWeekday[] = [1, 2, 3, 4, 5, 6, 7];

export const DEFAULT_REWARD_POOL: RewardDefinition[] = [
  {
    id: "percent-10",
    type: "percent_order",
    active: true,
    label: "%10 indirim",
    customerLabel: "10 % Rabatt auf deine Bestellung",
    weight: 36,
    percent: 10,
  },
  {
    id: "percent-20",
    type: "percent_order",
    active: true,
    label: "%20 indirim",
    customerLabel: "20 % Rabatt auf deine Bestellung",
    weight: 18,
    percent: 20,
  },
  {
    id: "percent-30",
    type: "percent_order",
    active: true,
    label: "%30 indirim",
    customerLabel: "30 % Rabatt auf deine Bestellung",
    weight: 7,
    percent: 30,
  },
  {
    id: "percent-40",
    type: "percent_order",
    active: true,
    label: "%40 indirim",
    customerLabel: "40 % Rabatt auf deine Bestellung",
    weight: 3,
    percent: 40,
  },
  {
    id: "percent-50",
    type: "percent_order",
    active: true,
    label: "%50 indirim",
    customerLabel: "50 % Rabatt auf deine Bestellung",
    weight: 1,
    percent: 50,
  },
  {
    id: "free-sauce",
    type: "free_existing_category",
    active: true,
    label: "Sepetteki bir sos ücretsiz",
    customerLabel: "Eine Soße aus deiner Bestellung ist gratis",
    weight: 22,
    category: "sauces",
  },
  {
    id: "free-drink",
    type: "free_existing_category",
    active: true,
    label: "Sepetteki bir içecek ücretsiz",
    customerLabel: "Ein Getränk aus deiner Bestellung ist gratis",
    weight: 18,
    category: "drinks",
  },
  {
    id: "free-extra",
    type: "free_existing_category",
    active: true,
    label: "Sepetteki bir ekstra ücretsiz",
    customerLabel: "Eine Beilage aus deiner Bestellung ist gratis",
    weight: 14,
    category: "extras",
  },
  {
    id: "free-burger",
    type: "free_burger",
    active: true,
    label: "Sepetteki bir burger ücretsiz",
    customerLabel: "Ein Burger aus deiner Bestellung ist gratis",
    weight: 4,
    category: "burger",
  },
  {
    id: "second-burger-50",
    type: "second_burger_percent",
    active: true,
    label: "İkinci burger %50",
    customerLabel: "Der günstigere zweite Burger ist 50 % günstiger",
    weight: 5,
    percent: 50,
    category: "burger",
  },
  {
    id: "burger-bogo",
    type: "buy_one_get_one_burger",
    active: true,
    label: "Bir burger al, ikinci burger ücretsiz",
    customerLabel: "Der günstigere zweite Burger ist gratis",
    weight: 2,
    category: "burger",
  },
];

export const DEFAULT_REWARD_PROGRAM: SchnellRewardProgram = {
  enabled: false,
  timezone: "Europe/Berlin",
  scheduleVersion: 1,
  weekly: WEEKDAYS.map((weekday) => ({
    weekday,
    enabled: false,
    startTime: "12:00",
    endTime: weekday >= 6 ? "22:00" : "21:30",
    winnerCount: weekday >= 6 ? 5 : 3,
  })),
  pool: DEFAULT_REWARD_POOL,
  maxWinsPerDevicePerDay: 1,
  minOrdersBetweenWins: 1,
  celebrationSoundEnabled: true,
  celebrationSeconds: 7,
  photoMode: "name_photo",
  photoRetentionMinutes: 60,
  autoPublishName: true,
  showcaseEnabled: true,
  targetAllActiveScreens: true,
  targetScreenSlugs: ["brand"],
  showcaseDurationSeconds: 15,
};

function cleanText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

function numberInRange(value: unknown, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeTime(value: unknown, fallback: string) {
  const text = cleanText(value, 5);
  const match = text.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizePhotoMode(value: unknown): RewardPhotoMode {
  return value === "off" || value === "name" || value === "name_photo"
    ? value
    : DEFAULT_REWARD_PROGRAM.photoMode;
}

function normalizeRewardDefinition(value: unknown, fallback: RewardDefinition): RewardDefinition {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  const allowedTypes: RewardDefinitionType[] = [
    "percent_order",
    "free_existing_category",
    "free_burger",
    "second_burger_percent",
    "buy_one_get_one_burger",
  ];
  const type = allowedTypes.includes(raw.type as RewardDefinitionType)
    ? (raw.type as RewardDefinitionType)
    : fallback.type;
  const category = ["burger", "drinks", "sauces", "extras"].includes(String(raw.category))
    ? (String(raw.category) as RewardDefinition["category"])
    : fallback.category;

  return {
    id: cleanText(raw.id, 80) || fallback.id,
    type,
    active: raw.active !== false,
    label: cleanText(raw.label, 120) || fallback.label,
    customerLabel: cleanText(raw.customerLabel, 180) || fallback.customerLabel,
    weight: numberInRange(raw.weight, 1, 10_000, fallback.weight),
    percent:
      type === "percent_order" || type === "second_burger_percent"
        ? numberInRange(raw.percent, 1, 100, fallback.percent || 10)
        : undefined,
    category,
  };
}

export function normalizeRewardProgram(value: unknown): SchnellRewardProgram {
  const raw = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  const rawWeekly = Array.isArray(raw.weekly) ? raw.weekly : [];
  const weekly = WEEKDAYS.map((weekday) => {
    const fallback = DEFAULT_REWARD_PROGRAM.weekly.find((item) => item.weekday === weekday)!;
    const item = rawWeekly.find(
      (candidate) =>
        candidate &&
        typeof candidate === "object" &&
        Number((candidate as Record<string, unknown>).weekday) === weekday,
    ) as Record<string, unknown> | undefined;

    return {
      weekday,
      enabled: item?.enabled === true,
      startTime: normalizeTime(item?.startTime, fallback.startTime),
      endTime: normalizeTime(item?.endTime, fallback.endTime),
      winnerCount: numberInRange(item?.winnerCount, 0, 100, fallback.winnerCount),
    };
  });

  const rawPool = Array.isArray(raw.pool) ? raw.pool : [];
  const pool = DEFAULT_REWARD_POOL.map((fallback) => {
    const match = rawPool.find(
      (candidate) =>
        candidate &&
        typeof candidate === "object" &&
        cleanText((candidate as Record<string, unknown>).id, 80) === fallback.id,
    );
    return normalizeRewardDefinition(match, fallback);
  });

  const targetScreenSlugs = Array.isArray(raw.targetScreenSlugs)
    ? raw.targetScreenSlugs
        .map((item) => cleanText(item, 80).replace(/[^a-zA-Z0-9_-]/g, ""))
        .filter(Boolean)
        .slice(0, 12)
    : DEFAULT_REWARD_PROGRAM.targetScreenSlugs;

  return {
    enabled: raw.enabled === true,
    timezone: cleanText(raw.timezone, 80) || DEFAULT_REWARD_PROGRAM.timezone,
    scheduleVersion: numberInRange(
      raw.scheduleVersion,
      1,
      999_999,
      DEFAULT_REWARD_PROGRAM.scheduleVersion,
    ),
    weekly,
    pool,
    maxWinsPerDevicePerDay: numberInRange(
      raw.maxWinsPerDevicePerDay,
      1,
      20,
      DEFAULT_REWARD_PROGRAM.maxWinsPerDevicePerDay,
    ),
    minOrdersBetweenWins: numberInRange(
      raw.minOrdersBetweenWins,
      0,
      10,
      DEFAULT_REWARD_PROGRAM.minOrdersBetweenWins,
    ),
    celebrationSoundEnabled: raw.celebrationSoundEnabled !== false,
    celebrationSeconds: numberInRange(
      raw.celebrationSeconds,
      5,
      12,
      DEFAULT_REWARD_PROGRAM.celebrationSeconds,
    ),
    photoMode: normalizePhotoMode(raw.photoMode),
    photoRetentionMinutes: numberInRange(
      raw.photoRetentionMinutes,
      15,
      180,
      DEFAULT_REWARD_PROGRAM.photoRetentionMinutes,
    ),
    autoPublishName: raw.autoPublishName !== false,
    showcaseEnabled: raw.showcaseEnabled !== false,
    targetAllActiveScreens: raw.targetAllActiveScreens !== false,
    targetScreenSlugs: targetScreenSlugs.length
      ? targetScreenSlugs
      : DEFAULT_REWARD_PROGRAM.targetScreenSlugs,
    showcaseDurationSeconds: numberInRange(
      raw.showcaseDurationSeconds,
      8,
      30,
      DEFAULT_REWARD_PROGRAM.showcaseDurationSeconds,
    ),
  };
}

export function rewardWeekdayLabel(weekday: RewardWeekday) {
  return (
    {
      1: "Pazartesi",
      2: "Salı",
      3: "Çarşamba",
      4: "Perşembe",
      5: "Cuma",
      6: "Cumartesi",
      7: "Pazar",
    } as const
  )[weekday];
}
