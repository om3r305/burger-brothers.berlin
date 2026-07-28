import { createHash, createHmac, randomInt } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
  RewardDaySchedule,
  RewardDefinition,
  SchnellRewardProgram,
  SchnellRewardPublic,
} from "@/lib/rewards/config";

export type RewardOrderItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  qty: number;
};

export type { SchnellRewardPublic } from "@/lib/rewards/config";


export type SchnellRewardDecision = {
  slotIndex: number;
  definition: RewardDefinition;
  code: string;
  label: string;
  customerLabel: string;
  discountAmount: number;
  percent?: number;
  productId?: string;
  productName?: string;
  deviceTokenHash: string;
  publicReward: Omit<SchnellRewardPublic, "winId">;
};

type BerlinParts = {
  businessDate: string;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  minuteOfDay: number;
};

function cleanObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function roundMoney(value: number) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function timeToMinute(value: string) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return 0;
  return Math.min(1_439, Math.max(0, Number(match[1]) * 60 + Number(match[2])));
}

export function berlinParts(now = new Date(), timezone = "Europe/Berlin"): BerlinParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekdayMap: Record<string, BerlinParts["weekday"]> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };

  return {
    businessDate: `${map.year}-${map.month}-${map.day}`,
    weekday: weekdayMap[map.weekday] || 1,
    minuteOfDay: Number(map.hour || 0) * 60 + Number(map.minute || 0),
  };
}

function rewardSecret() {
  return String(
    process.env.SESSION_SECRET ||
      process.env.NEXTAUTH_SECRET ||
      process.env.AUTH_SECRET ||
      "burger-brothers-reward-fallback",
  );
}

export function generateRewardSlots(params: {
  tenantId: string;
  businessDate: string;
  schedule: RewardDaySchedule;
  scheduleVersion: number;
}) {
  const start = timeToMinute(params.schedule.startTime);
  const end = timeToMinute(params.schedule.endTime);
  const count = Math.max(0, Math.floor(params.schedule.winnerCount));

  if (!params.schedule.enabled || count <= 0 || end <= start) return [] as number[];

  const duration = end - start;
  const segment = duration / count;
  const slots: number[] = [];

  for (let index = 0; index < count; index += 1) {
    const digest = createHmac("sha256", rewardSecret())
      .update(
        [
          params.tenantId,
          params.businessDate,
          params.schedule.weekday,
          params.scheduleVersion,
          index,
        ].join(":"),
      )
      .digest();
    const randomUnit = digest.readUInt32BE(0) / 0xffffffff;
    const segmentStart = start + segment * index;
    const safePadding = Math.min(12, Math.max(2, segment * 0.12));
    const usableStart = segmentStart + safePadding;
    const usableEnd = start + segment * (index + 1) - safePadding;
    const minute =
      usableEnd > usableStart
        ? usableStart + randomUnit * (usableEnd - usableStart)
        : segmentStart + randomUnit * segment;
    slots.push(Math.min(end - 1, Math.max(start, Math.round(minute))));
  }

  return [...new Set(slots)].sort((a, b) => a - b);
}

function deviceHash(deviceId: string) {
  return createHash("sha256").update(deviceId).digest("hex");
}

function categoryItems(items: RewardOrderItem[], category: string) {
  return items.filter(
    (item) =>
      String(item.category).toLowerCase() === category &&
      Number(item.qty) > 0 &&
      Number(item.price) > 0,
  );
}

function unitCandidates(items: RewardOrderItem[]) {
  const units: RewardOrderItem[] = [];
  for (const item of items) {
    for (let index = 0; index < Math.max(0, Math.floor(Number(item.qty) || 0)); index += 1) {
      units.push({ ...item, qty: 1 });
    }
  }
  return units;
}

function evaluateDefinition(
  definition: RewardDefinition,
  items: RewardOrderItem[],
  payable: number,
): Omit<SchnellRewardDecision, "slotIndex" | "deviceTokenHash" | "definition"> | null {
  if (!definition.active || payable <= 0) return null;

  if (definition.type === "percent_order") {
    const percent = Math.min(100, Math.max(1, Number(definition.percent) || 10));
    const amount = roundMoney((payable * percent) / 100);
    if (amount <= 0) return null;
    return {
      code: definition.id,
      label: definition.label,
      customerLabel: definition.customerLabel,
      discountAmount: Math.min(payable, amount),
      percent,
      publicReward: {
        code: definition.id,
        label: definition.label,
        customerLabel: definition.customerLabel,
        discountAmount: Math.min(payable, amount),
        percent,
        celebrationSoundEnabled: true,
        celebrationSeconds: 4,
        photoMode: "off",
        photoRetentionMinutes: 60,
      },
    };
  }

  if (definition.type === "free_existing_category") {
    const category = definition.category || "extras";
    const item = categoryItems(items, category).sort((a, b) => a.price - b.price)[0];
    if (!item) return null;
    const amount = Math.min(payable, roundMoney(item.price));
    return {
      code: definition.id,
      label: definition.label,
      customerLabel: `${item.name} ist für dich gratis!`,
      discountAmount: amount,
      productId: item.id,
      productName: item.name,
      publicReward: {
        code: definition.id,
        label: definition.label,
        customerLabel: `${item.name} ist für dich gratis!`,
        discountAmount: amount,
        productName: item.name,
        celebrationSoundEnabled: true,
        celebrationSeconds: 4,
        photoMode: "off",
        photoRetentionMinutes: 60,
      },
    };
  }

  const burgerUnits = unitCandidates(categoryItems(items, "burger")).sort(
    (a, b) => a.price - b.price,
  );

  if (definition.type === "free_burger") {
    const item = burgerUnits[0];
    if (!item) return null;
    const amount = Math.min(payable, roundMoney(item.price));
    return {
      code: definition.id,
      label: definition.label,
      customerLabel: `${item.name} ist für dich gratis!`,
      discountAmount: amount,
      productId: item.id,
      productName: item.name,
      publicReward: {
        code: definition.id,
        label: definition.label,
        customerLabel: `${item.name} ist für dich gratis!`,
        discountAmount: amount,
        productName: item.name,
        celebrationSoundEnabled: true,
        celebrationSeconds: 4,
        photoMode: "off",
        photoRetentionMinutes: 60,
      },
    };
  }

  if (definition.type === "second_burger_percent") {
    if (burgerUnits.length < 2) return null;
    const item = burgerUnits[0];
    const percent = Math.min(100, Math.max(1, Number(definition.percent) || 50));
    const amount = Math.min(payable, roundMoney((item.price * percent) / 100));
    return {
      code: definition.id,
      label: definition.label,
      customerLabel: `${item.name}: ${percent} % Glücks-Rabatt!`,
      discountAmount: amount,
      percent,
      productId: item.id,
      productName: item.name,
      publicReward: {
        code: definition.id,
        label: definition.label,
        customerLabel: `${item.name}: ${percent} % Glücks-Rabatt!`,
        discountAmount: amount,
        percent,
        productName: item.name,
        celebrationSoundEnabled: true,
        celebrationSeconds: 4,
        photoMode: "off",
        photoRetentionMinutes: 60,
      },
    };
  }

  if (definition.type === "buy_one_get_one_burger") {
    if (burgerUnits.length < 2) return null;
    const item = burgerUnits[0];
    const amount = Math.min(payable, roundMoney(item.price));
    return {
      code: definition.id,
      label: definition.label,
      customerLabel: `${item.name} ist als zweiter Burger gratis!`,
      discountAmount: amount,
      productId: item.id,
      productName: item.name,
      publicReward: {
        code: definition.id,
        label: definition.label,
        customerLabel: `${item.name} ist als zweiter Burger gratis!`,
        discountAmount: amount,
        productName: item.name,
        celebrationSoundEnabled: true,
        celebrationSeconds: 4,
        photoMode: "off",
        photoRetentionMinutes: 60,
      },
    };
  }

  return null;
}

function weightedChoice<T extends { weight: number }>(items: T[]) {
  const total = items.reduce((sum, item) => sum + Math.max(1, item.weight), 0);
  if (!items.length || total <= 0) return null;
  let cursor = randomInt(total);
  for (const item of items) {
    cursor -= Math.max(1, item.weight);
    if (cursor < 0) return item;
  }
  return items[items.length - 1];
}

export async function decideSchnellReward(params: {
  transaction: Prisma.TransactionClient;
  tenantId: string;
  now: Date;
  deviceId: string;
  program: SchnellRewardProgram;
  items: RewardOrderItem[];
  payable: number;
}) {
  const { program } = params;
  if (!program.enabled) return null;

  const clock = berlinParts(params.now, program.timezone);
  const schedule = program.weekly.find((item) => item.weekday === clock.weekday);
  if (!schedule?.enabled || schedule.winnerCount <= 0) return null;

  const start = timeToMinute(schedule.startTime);
  const end = timeToMinute(schedule.endTime);
  if (end <= start || clock.minuteOfDay < start || clock.minuteOfDay >= end) {
    return null;
  }

  const slots = generateRewardSlots({
    tenantId: params.tenantId,
    businessDate: clock.businessDate,
    schedule,
    scheduleVersion: program.scheduleVersion,
  });
  if (!slots.length) return null;

  const existingWins = await params.transaction.schnellRewardWin.findMany({
    where: {
      tenantId: params.tenantId,
      businessDate: clock.businessDate,
    },
    select: {
      slotIndex: true,
      deviceTokenHash: true,
    },
  });
  const claimed = new Set(existingWins.map((win) => Number(win.slotIndex)));
  // Only the latest reached slot is claimable. Older missed slots expire instead
  // of stacking up and producing several winners back-to-back late in the day.
  let nextDueSlot = -1;
  for (let index = 0; index < slots.length; index += 1) {
    if (slots[index] <= clock.minuteOfDay) nextDueSlot = index;
    else break;
  }
  if (nextDueSlot < 0 || claimed.has(nextDueSlot)) return null;

  const hashedDevice = deviceHash(params.deviceId);
  const deviceWins = existingWins.filter(
    (win) => String(win.deviceTokenHash || "") === hashedDevice,
  ).length;
  if (deviceWins >= program.maxWinsPerDevicePerDay) return null;

  type RewardCandidate = {
    weight: number;
    definition: RewardDefinition;
    evaluated: Omit<
      SchnellRewardDecision,
      "slotIndex" | "deviceTokenHash" | "definition"
    >;
  };

  const candidates: RewardCandidate[] = program.pool.flatMap((definition) => {
    if (!definition.active) return [];
    const evaluated = evaluateDefinition(definition, params.items, params.payable);
    return evaluated
      ? [{ weight: definition.weight, definition, evaluated }]
      : [];
  });

  const selected = weightedChoice<RewardCandidate>(candidates);
  if (!selected) return null;

  const publicReward = {
    ...selected.evaluated.publicReward,
    celebrationSoundEnabled: program.celebrationSoundEnabled,
    celebrationSeconds: program.celebrationSeconds,
    photoMode: program.photoMode,
    photoRetentionMinutes: program.photoRetentionMinutes,
  };

  return {
    slotIndex: nextDueSlot,
    definition: selected.definition,
    ...selected.evaluated,
    deviceTokenHash: hashedDevice,
    publicReward,
  } satisfies SchnellRewardDecision;
}

export function rewardFromOrderMeta(metaValue: unknown): SchnellRewardPublic | null {
  const reward = cleanObject(cleanObject(metaValue).reward);
  const winId = String(reward.winId || "").trim();
  const code = String(reward.code || "").trim();
  if (!winId || !code) return null;

  return {
    winId,
    code,
    label: String(reward.label || "Glücksgewinn"),
    customerLabel: String(reward.customerLabel || reward.label || "Glücksgewinn"),
    discountAmount: roundMoney(Number(reward.discountAmount) || 0),
    percent: Number(reward.percent) || undefined,
    productName: String(reward.productName || "") || undefined,
    celebrationSoundEnabled: reward.celebrationSoundEnabled !== false,
    celebrationSeconds: Math.max(3, Math.min(8, Number(reward.celebrationSeconds) || 4)),
    photoMode:
      reward.photoMode === "name" || reward.photoMode === "name_photo"
        ? reward.photoMode
        : "off",
    photoRetentionMinutes: Math.max(
      15,
      Math.min(180, Number(reward.photoRetentionMinutes) || 60),
    ),
  };
}

export function rewardMetaPayload(
  winId: string,
  decision: SchnellRewardDecision,
): Prisma.InputJsonObject {
  return {
    winId,
    code: decision.code,
    label: decision.label,
    customerLabel: decision.customerLabel,
    discountAmount: decision.discountAmount,
    percent: decision.percent ?? null,
    productId: decision.productId ?? null,
    productName: decision.productName ?? null,
    celebrationSoundEnabled: decision.publicReward.celebrationSoundEnabled,
    celebrationSeconds: decision.publicReward.celebrationSeconds,
    photoMode: decision.publicReward.photoMode,
    photoRetentionMinutes: decision.publicReward.photoRetentionMinutes,
  };
}
