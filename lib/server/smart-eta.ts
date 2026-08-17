type EtaOrderSignal = {
  status: string;
  mode: string;
  channel: string | null;
  items: unknown;
  meta: unknown;
  planned: string | null;
  etaMin: number | null;
  etaAdjustMin: number | null;
  ts: Date;
  createdAt: Date;
};

export type PublicEtaSummary = {
  delivery: { min: number; max: number; label: string };
  pickup: { min: number; max: number; label: string };
  generatedAt: string;
  ttlSeconds: number;
};

const STATUS_WEIGHT: Record<string, number> = {
  new: 0.8,
  preparing: 1.4,
  ready: 0.1,
  out_for_delivery: 0,
};

const STATUS_MAX_AGE_MINUTES: Record<string, number> = {
  new: 60,
  preparing: 180,
  ready: 60,
  out_for_delivery: 120,
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function itemQuantity(items: unknown) {
  if (!Array.isArray(items)) return 1;

  const quantity = items.reduce(
    (sum, item) => sum + clamp(Math.round(finiteNumber(record(item).qty, 1)), 1, 30),
    0,
  );
  return clamp(quantity || 1, 1, 40);
}

function normalizedStatus(value: string) {
  const status = String(value || "").toLowerCase().trim();
  if (["received", "eingegangen"].includes(status)) return "new";
  if (["prepare", "zubereitung", "in_vorbereitung"].includes(status)) return "preparing";
  if (["bereit", "abholbereit"].includes(status)) return "ready";
  if (["on_the_way", "unterwegs"].includes(status)) return "out_for_delivery";
  return status;
}

function isFarFuturePlanned(order: EtaOrderSignal, now: Date) {
  const meta = record(order.meta);
  const explicit =
    meta.plannedAt ?? meta.scheduledAt ?? meta.plannedDateTime ?? meta.deliveryAt;

  if (typeof explicit === "string" || explicit instanceof Date) {
    const timestamp = new Date(explicit).getTime();
    if (Number.isFinite(timestamp)) return timestamp > now.getTime() + 90 * 60_000;
  }

  const match = String(order.planned || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return false;

  const planned = new Date(now);
  planned.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return planned.getTime() > now.getTime() + 90 * 60_000;
}

function roundToFive(value: number) {
  return Math.round(value / 5) * 5;
}

export function calculateSmartEta(params: {
  baseDelivery: number;
  basePickup: number;
  orders: EtaOrderSignal[];
  now?: Date;
}): PublicEtaSummary {
  const now = params.now ?? new Date();
  const baseDelivery = clamp(Math.round(finiteNumber(params.baseDelivery, 35)), 1, 90);
  const basePickup = clamp(Math.round(finiteNumber(params.basePickup, 15)), 1, 60);

  let kitchenLoad = 0;
  let driverLoad = 0;
  const assignedEtaSignals: number[] = [];

  for (const order of params.orders) {
    const status = normalizedStatus(order.status);
    if (!(status in STATUS_WEIGHT) || isFarFuturePlanned(order, now)) continue;

    const created = order.ts || order.createdAt;
    const ageMinutes = Math.max(0, (now.getTime() - created.getTime()) / 60_000);
    if (ageMinutes > STATUS_MAX_AGE_MINUTES[status]) continue;

    const quantityFactor = 1 + Math.min(20, Math.max(0, itemQuantity(order.items) - 1)) * 0.12;
    kitchenLoad += STATUS_WEIGHT[status] * quantityFactor;

    if (status === "out_for_delivery" && order.mode === "delivery") {
      driverLoad += 0.35;
    }

    if (["new", "preparing", "ready"].includes(status) && order.etaMin != null) {
      const modeBase = order.mode === "pickup" ? basePickup : baseDelivery;
      const assigned = finiteNumber(order.etaMin) + finiteNumber(order.etaAdjustMin);
      assignedEtaSignals.push(clamp(assigned - modeBase, 0, 25));
    }
  }

  const tvSignal = assignedEtaSignals.length
    ? clamp(
        assignedEtaSignals.reduce((sum, value) => sum + value, 0) /
          assignedEtaSignals.length,
        0,
        15,
      )
    : 0;

  const controlledExtra = roundToFive(
    clamp(Math.max(0, kitchenLoad - 1) * 2.2 + driverLoad * 2 + tvSignal * 0.35, 0, 25),
  );
  const deliveryMin = clamp(roundToFive(baseDelivery + controlledExtra), baseDelivery, baseDelivery + 25);
  const deliveryMax = deliveryMin + 10;

  const pickupExtra = kitchenLoad >= 8 ? 10 : kitchenLoad >= 5 ? 5 : 0;
  const pickupMinutes = clamp(roundToFive(basePickup + pickupExtra), basePickup, basePickup + 10);

  return {
    delivery: {
      min: deliveryMin,
      max: deliveryMax,
      label: `ca. ${deliveryMin}–${deliveryMax} Min`,
    },
    pickup: {
      min: pickupMinutes,
      max: pickupMinutes,
      label: `ca. ${pickupMinutes} Min`,
    },
    generatedAt: now.toISOString(),
    ttlSeconds: 15,
  };
}
