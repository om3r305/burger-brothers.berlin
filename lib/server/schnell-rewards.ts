import { createHash, createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import type {
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

export function rewardTimeToMinute(value: string) {
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

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function deterministicUnit(parts: Array<string | number>) {
  const digest = createHmac("sha256", rewardSecret())
    .update(parts.join(":"))
    .digest();
  return digest.readUInt32BE(0) / 0xffffffff;
}

export type AdaptiveRewardChanceInput = {
  startMinute: number;
  endMinute: number;
  currentMinute: number;
  winnerLimit: number;
  winsSoFar: number;
  previousEligibleOrders: number;
  ordersSinceLastWin: number;
  minOrdersBetweenWins: number;
  hasPreviousWin: boolean;
};

export type AdaptiveRewardChance = {
  chance: number;
  progress: number;
  remainingWins: number;
  expectedWinsByNow: number;
  behindTarget: number;
  spacingBlocked: boolean;
  deadlineMode: boolean;
};

/**
 * Sipariş yokken ödül "yakmaz". Her gerçek uygun siparişte pencerenin ilerleyişi,
 * kalan kota ve son kazananın ardından gelen sipariş sayısı birlikte değerlendirilir.
 * Pencerenin sonuna yaklaşıldıkça kullanılmayan kota için şans kontrollü biçimde artar.
 */
export function computeAdaptiveWinChance(
  input: AdaptiveRewardChanceInput,
): AdaptiveRewardChance {
  const duration = Math.max(1, input.endMinute - input.startMinute);
  const progress = clamp(
    (input.currentMinute - input.startMinute) / duration,
  );
  const winnerLimit = Math.max(0, Math.floor(input.winnerLimit));
  const winsSoFar = Math.max(0, Math.floor(input.winsSoFar));
  const remainingWins = Math.max(0, winnerLimit - winsSoFar);
  const expectedWinsByNow = winnerLimit * progress;
  const behindTarget = Math.max(0, expectedWinsByNow - winsSoFar);
  const deadlineMode = progress >= 0.94;

  if (
    winnerLimit <= 0 ||
    remainingWins <= 0 ||
    input.currentMinute < input.startMinute ||
    input.currentMinute >= input.endMinute
  ) {
    return {
      chance: 0,
      progress,
      remainingWins,
      expectedWinsByNow,
      behindTarget,
      spacingBlocked: false,
      deadlineMode,
    };
  }

  const minGap = Math.max(0, Math.floor(input.minOrdersBetweenWins));
  const spacingBlocked =
    input.hasPreviousWin &&
    input.ordersSinceLastWin < minGap &&
    !deadlineMode;

  if (spacingBlocked) {
    return {
      chance: 0,
      progress,
      remainingWins,
      expectedWinsByNow,
      behindTarget,
      spacingBlocked: true,
      deadlineMode,
    };
  }

  // Başlangıçta spontane ama ölçülü bir temel ihtimal.
  const baseChance = clamp(0.08 + winnerLimit * 0.012, 0.08, 0.22);

  // Planın gerisinde kalındığında ana telafi kuvveti.
  const deficitBoost = Math.min(
    0.58,
    behindTarget * (0.17 + progress * 0.07),
  );

  // Zaman ilerledikçe ve kota kaldıkça artan baskı.
  const timeBoost = progress * progress * 0.22;
  const quotaPressure =
    (remainingWins / Math.max(1, winnerLimit)) * progress * 0.12;

  // Son kazananın ardından daha fazla sipariş geldiyse küçük ek artış.
  const orderBoost = Math.min(
    0.12,
    Math.max(0, input.ordersSinceLastWin - minGap) * 0.035,
  );

  let chance = baseChance + deficitBoost + timeBoost + quotaPressure + orderBoost;

  // Pencerenin büyük bölümü geçtiği halde hiç kazanan yoksa ilk uygun
  // siparişlerin ödülü yakalama ihtimali belirgin şekilde yükselir.
  if (progress >= 0.75 && winsSoFar === 0) {
    chance = Math.max(chance, 0.78);
  }

  // Son bölümde verilmemiş ödüller sabit saat gibi kaybolmaz.
  if (progress >= 0.88) {
    chance = Math.max(
      chance,
      Math.min(0.96, 0.72 + (remainingWins / Math.max(1, winnerLimit)) * 0.2),
    );
  }

  // Son %4 içinde gelen uygun siparişler kota dolana kadar kazanır.
  if (progress >= 0.96) {
    chance = 1;
  }

  return {
    chance: clamp(chance),
    progress,
    remainingWins,
    expectedWinsByNow,
    behindTarget,
    spacingBlocked: false,
    deadlineMode,
  };
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

function weightedChoice<T extends { weight: number }>(
  items: T[],
  randomUnit: number,
) {
  const total = items.reduce((sum, item) => sum + Math.max(1, item.weight), 0);
  if (!items.length || total <= 0) return null;
  let cursor = clamp(randomUnit) * total;
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
  decisionKey: string;
  program: SchnellRewardProgram;
  items: RewardOrderItem[];
  payable: number;
}) {
  const { program } = params;
  if (!program.enabled) return null;

  const clock = berlinParts(params.now, program.timezone);
  const schedule = program.weekly.find((item) => item.weekday === clock.weekday);
  if (!schedule?.enabled || schedule.winnerCount <= 0) return null;

  const start = rewardTimeToMinute(schedule.startTime);
  const end = rewardTimeToMinute(schedule.endTime);
  if (end <= start || clock.minuteOfDay < start || clock.minuteOfDay >= end) {
    return null;
  }

  const existingWins = await params.transaction.schnellRewardWin.findMany({
    where: {
      tenantId: params.tenantId,
      businessDate: clock.businessDate,
    },
    select: {
      slotIndex: true,
      deviceTokenHash: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  if (existingWins.length >= schedule.winnerCount) return null;

  const hashedDevice = deviceHash(params.deviceId);
  const deviceWins = existingWins.filter(
    (win) => String(win.deviceTokenHash || "") === hashedDevice,
  ).length;
  if (deviceWins >= program.maxWinsPerDevicePerDay) return null;

  // Sipariş zamanlarını 1.000 satır çekip JavaScript'te filtrelemek yerine
  // aktif pencerenin başlangıcını mevcut Berlin saatinden hesaplayıp DB count
  // kullanırız. Bu, ödül transaction'ının bağlantıyı çok daha kısa tutmasını sağlar.
  const elapsedWindowMinutes = Math.max(0, clock.minuteOfDay - start);
  const windowStartedAt = new Date(
    params.now.getTime() - elapsedWindowMinutes * 60_000,
  );

  const nextWinSequence =
    existingWins.reduce(
      (highest, win) => Math.max(highest, Number(win.slotIndex) || 0),
      -1,
    ) + 1;
  const lastWin = existingWins[existingWins.length - 1] || null;

  const previousEligibleOrders = await params.transaction.order.count({
    where: {
      tenantId: params.tenantId,
      channel: "schnellbestellung",
      ts: { gte: windowStartedAt, lte: params.now },
    },
  });
  const ordersSinceLastWin = lastWin
    ? await params.transaction.order.count({
        where: {
          tenantId: params.tenantId,
          channel: "schnellbestellung",
          ts: { gt: lastWin.createdAt, lte: params.now },
        },
      })
    : previousEligibleOrders;

  const adaptive = computeAdaptiveWinChance({
    startMinute: start,
    endMinute: end,
    currentMinute: clock.minuteOfDay,
    winnerLimit: schedule.winnerCount,
    winsSoFar: existingWins.length,
    previousEligibleOrders,
    ordersSinceLastWin,
    minOrdersBetweenWins: program.minOrdersBetweenWins,
    hasPreviousWin: Boolean(lastWin),
  });

  if (adaptive.chance <= 0) return null;

  const draw = deterministicUnit([
    params.tenantId,
    clock.businessDate,
    program.scheduleVersion,
    params.decisionKey,
    previousEligibleOrders + 1,
    existingWins.length,
  ]);
  if (draw >= adaptive.chance) return null;

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

  const selected = weightedChoice<RewardCandidate>(
    candidates,
    deterministicUnit([
      params.tenantId,
      clock.businessDate,
      program.scheduleVersion,
      params.decisionKey,
      "reward-definition",
    ]),
  );
  if (!selected) return null;

  const publicReward = {
    ...selected.evaluated.publicReward,
    celebrationSoundEnabled: program.celebrationSoundEnabled,
    celebrationSeconds: program.celebrationSeconds,
    photoMode: program.photoMode,
    photoRetentionMinutes: program.photoRetentionMinutes,
  };

  return {
    // Veritabanındaki alan geriye dönük olarak korunur; artık sabit saat slotu
    // değil, o gün verilen ödülün sıfır tabanlı sıra numarasıdır.
    slotIndex: nextWinSequence,
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
    celebrationSeconds: Math.max(5, Math.min(12, Number(reward.celebrationSeconds) || 7)),
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
