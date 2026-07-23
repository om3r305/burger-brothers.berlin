// app/checkout/page.tsx
"use client";

import Link from "next/link";
import TrackPanel from "@/components/ui/TrackPanel";
import CouponBox from "@/components/CouponBox";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useLayoutEffect,
  useRef,
} from "react";
import { t } from "@/lib/i18n";

import { useCart } from "@/components/store";
import type { CartItemFixed, OrderMode } from "@/components/store";
import {
  LS_SETTINGS,
  readSettings,
  getPricingOverrides,
  fetchAndApplyRemoteSettings,
} from "@/lib/settings";
import type { SettingsV6 } from "@/lib/settings";
import {
  evaluateFreebieRules,
  freebieCategoryLabel,
  freebieModeLabel,
  parseFreebieCategory,
} from "@/lib/freebies";
import type { FreebieEvaluation, FreebieUnit } from "@/lib/freebies";
import { evaluateConditionalCartCampaign } from "@/lib/conditional-campaign";
import {
  planFromSettings,
  isOpenAt,
  buildSlotsForDate,
  validatePlannedTime,
  nowInTZ,
} from "@/lib/availability";

import { getStreets, searchStreets, normalizePlz } from "@/lib/streets";
import * as Coupons from "@/lib/coupons";

import {
  type PauseState,
  isModePaused,
  onPauseChange,
  syncPauseFromServer,
} from "@/lib/pause";
import PaymentTrustBadges from "@/components/PaymentTrustBadges";
import { attachPfandToOrderItems, computePfand, resolvePfandUnit } from "@/lib/pfand";
import { rememberCustomerTracking } from "@/lib/customer-tracking";
import CheckoutToastViewport from "@/components/checkout/CheckoutToastViewport";
import type {
  ActivePaymentRecovery,
  CheckoutAddress,
  CheckoutOrderDraft,
  CheckoutOrderItem,
  CheckoutPaymentMethod,
  CheckoutPaymentStatus,
  CheckoutToast,
  CheckoutToastTone,
  OrderCreateResult,
  PaymentSessionResponse,
  SavedPaymentMethod,
} from "@/types/checkout";
import {
  arrayValue,
  errorMessage,
  isActivePaymentRecovery,
  isAllowedNavigationUrl,
  isRecord,
  numberValue,
  parseJsonUnknown,
  parseOrderCreateEnvelope,
  parsePaymentPrepareResponse,
  parsePaymentProfileResponse,
  parsePaymentSessionResponse,
  recordValue,
  stringValue,
} from "@/lib/checkout/runtime";

/* ───────── helpers ───────── */

const fmt = (n: number) =>
  new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(n);

function reportCheckoutError(scope: string, error: unknown) {
  console.error(`[checkout/${scope}]`, error);
}

function roundToNearest10Cents(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;

  return +(Math.round((n + Number.EPSILON) * 10) / 10).toFixed(2);
}

type Mode = OrderMode;
type Address = CheckoutAddress;

type Planned = {
  enabledPickup: boolean;
  timePickup: string;
  enabledDelivery: boolean;
  timeDelivery: string;
};

function normalizeAddress(value: unknown): Partial<Address> | null {
  if (!isRecord(value)) return null;

  return {
    name: stringValue(value.name),
    phone: stringValue(value.phone),
    email: typeof value.email === "string" ? value.email : undefined,
    emailOptIn: value.emailOptIn === true,
    street: stringValue(value.street),
    house: stringValue(value.house),
    zip: stringValue(value.zip),
    city: stringValue(value.city),
    floor: typeof value.floor === "string" ? value.floor : undefined,
    entrance:
      typeof value.entrance === "string" ? value.entrance : undefined,
    note: typeof value.note === "string" ? value.note : undefined,
  };
}

function normalizePlanned(value: unknown): Planned | null {
  if (!isRecord(value)) return null;

  return {
    enabledPickup: value.enabledPickup === true,
    timePickup: stringValue(value.timePickup),
    enabledDelivery: value.enabledDelivery === true,
    timeDelivery: stringValue(value.timeDelivery),
  };
}

function normalizeSavedCheckout(value: unknown): {
  addr: Partial<Address> | null;
  planned: Planned | null;
  orderMode: Mode | null;
} {
  if (!isRecord(value)) {
    return { addr: null, planned: null, orderMode: null };
  }

  return {
    addr: normalizeAddress(value.addr),
    planned: normalizePlanned(value.planned),
    orderMode:
      value.orderMode === "pickup" || value.orderMode === "delivery"
        ? value.orderMode
        : null,
  };
}

type PaymentMethod = CheckoutPaymentMethod;

const ACTIVE_PAYMENT_RECOVERY_KEY = "bb_active_payment_recovery_v1";

function browserOpaqueToken(bytesLength = 32) {
  const bytes = new Uint8Array(bytesLength);
  window.crypto.getRandomValues(bytes);
  let binary = "";
  bytes.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return window
    .btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function readActivePaymentRecovery(): ActivePaymentRecovery | null {
  const parsed = parseJsonUnknown(
    localStorage.getItem(ACTIVE_PAYMENT_RECOVERY_KEY),
  );
  return isActivePaymentRecovery(parsed) ? parsed : null;
}

function clearActivePaymentRecoveryStorage() {
  try {
    localStorage.removeItem(ACTIVE_PAYMENT_RECOVERY_KEY);
    sessionStorage.removeItem("bb_active_payment_session");
    window.dispatchEvent(new CustomEvent("bb:payment-recovery-changed"));
  } catch {
    // Storage cleanup is best-effort; server state remains authoritative.
  }
}

function paymentRecoveryIsTerminal(payload: PaymentSessionResponse) {
  const status = payload.status;
  return (
    payload?.finalized === true ||
    [
      "cancelled",
      "expired",
      "failed",
      "refunded",
      "finalized",
    ].includes(status)
  );
}

function formatPaymentRecoveryCountdown(expiresAt: unknown, nowMs: number) {
  const endMs = Date.parse(String(expiresAt || ""));
  if (!Number.isFinite(endMs)) return "";

  const remainingSeconds = Math.max(0, Math.ceil((endMs - nowMs) / 1000));
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;

  return `${minutes}:${seconds < 10 ? `0${seconds}` : seconds}`;
}

type SplitUnit = {
  key: string;
  label: string;
  weightCents: number;
};

type SplitShare = {
  index: number;
  label: string;
  baseAmountCents: number;
  serviceFeeCents: number;
  amountCents: number;
  items: Array<{ key: string; label: string }>;
};
type TipChoice = "none" | "1" | "2" | "3" | "custom";

type FreebieTier = {
  minTotal: number;
  freeSauces: number;
  [key: string]: unknown;
};

type FreebiesCfg = Record<string, unknown> | null;

type RouteDealReward = {
  type?: "percent" | "fixed" | "free_delivery" | "free_sauce" | "free_drink" | string;
  percent?: number;
  amount?: number;
  maxDiscount?: number;
  freeItemName?: string;
  freeItemCategory?: string;
  [key: string]: unknown;
};

type ActiveRouteDeal = {
  id?: string;
  ruleId?: string;
  name?: string;
  plz?: string;
  street?: string;
  streets?: string[];
  matchMode?: "plz" | "street" | string;
  orderId?: string;
  startedAt?: string;
  expiresAt?: string;
  durationMinutes?: number;
  minTotal?: number;
  reward?: RouteDealReward;
  message?: string;
  [key: string]: unknown;
};

type RouteDealBenefit = {
  deal: ActiveRouteDeal | null;
  applied: boolean;
  unlocked: boolean;
  discountAmount: number;
  missingAmount: number;
  label: string;
  rewardType: string;
  expiresMs: number;
};

type Variant = {
  id: string;
  name: string;
  price: number;
  active?: boolean;
};

type FlatItem = {
  id?: string;
  sku?: string;
  name: string;
  price?: number;
  category?: string;
  tags?: string[];
  variants?: Variant[];
};

const LS_CHECKOUT = "bb_checkout_info_v1";
const LS_DRINK_GROUPS = "bb_drink_groups_v1";
const LS_ACTIVE_COUPON = "bb_active_coupon_code";
const LS_ACTIVE_COUPON_META = "bb_active_coupon_meta";
const LS_PRODUCTS = "bb_products_v1";
const PROFILE_KEY = "bb_checkout_profile_v2";

const ORDER_RETRY_TOTAL_MS = 5 * 60 * 1000;
const ORDER_RETRY_INTERVAL_MS = 30 * 1000;

const pad2 = (n: number) => (n < 10 ? `0${n}` : String(n));

const normCode = (s: string) =>
  s
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "")
    .trim()
    .toLowerCase();

function hhmmInTZ(d: Date, tz: string) {
  return new Intl.DateTimeFormat("de-DE", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function todayAt(hhmm: string, tz: string) {
  const [h, m] = (hhmm || "").split(":").map((x) => parseInt(x, 10));
  const base = nowInTZ(tz);
  const y = base.getFullYear();
  const mo = base.getMonth();
  const da = base.getDate();
  const iso = `${y}-${pad2(mo + 1)}-${pad2(da)}T${pad2(h || 0)}:${pad2(
    m || 0,
  )}:00`;

  return new Date(new Date(`${iso} GMT`).toLocaleString("en-US", { timeZone: tz }));
}

function normalizePlannedHHMM(value: unknown): string {
  const match = String(value || "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);

  if (!match) return "";

  const hours = Math.max(0, Math.min(23, Number(match[1]) || 0));
  const minutes = Math.max(0, Math.min(59, Number(match[2]) || 0));

  return `${pad2(hours)}:${pad2(minutes)}`;
}

function plannedConfirmationLabel(mode: Mode) {
  return mode === "pickup" ? "Geplante Abholung" : "Geplante Lieferung";
}

function plannedEtaLabel(mode: Mode) {
  return mode === "pickup" ? "Vorbereitungszeit" : "Voraussichtliche Lieferung";
}

function getMinTotal(tier: unknown) {
  const record = recordValue(tier);
  return toNum(
    record.minTotal ?? record.MinTotal ?? record["Min.Total"],
    0,
  );
}

function calcFreeSauces(merchandise: number, tiers?: FreebieTier[]) {
  if (!tiers?.length) return 0;

  const sorted = tiers
    .slice()
    .sort((a, b) => getMinTotal(a) - getMinTotal(b));

  let free = 0;

  for (const tier of sorted) {
    if (merchandise >= getMinTotal(tier)) {
      free = toNum(tier.freeSauces, 0);
    }
  }

  return free;
}

type FreebieProgress = {
  currentFreeSauces: number;
  nextMinTotal: number | null;
  nextFreeSauces: number;
  missingAmount: number;
};

function sortedFreebieTiers(tiers?: FreebieTier[]) {
  if (!tiers?.length) return [];

  return tiers
    .map((tier) => ({
      minTotal: getMinTotal(tier),
      freeSauces: toNum(tier.freeSauces, 0),
    }))
    .filter((tier) => tier.minTotal > 0 && tier.freeSauces > 0)
    .sort((a, b) => a.minTotal - b.minTotal);
}

function buildFreebieProgress(
  merchandise: number,
  tiers?: FreebieTier[],
): FreebieProgress | null {
  const sorted = sortedFreebieTiers(tiers);

  if (!sorted.length) return null;

  const currentFreeSauces = calcFreeSauces(merchandise, sorted as FreebieTier[]);
  const nextTier = sorted.find((tier) => merchandise < tier.minTotal) || null;

  return {
    currentFreeSauces,
    nextMinTotal: nextTier ? nextTier.minTotal : null,
    nextFreeSauces: nextTier ? nextTier.freeSauces : 0,
    missingAmount: nextTier ? Math.max(0, nextTier.minTotal - merchandise) : 0,
  };
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`inline-flex h-6 w-11 items-center rounded-full transition ${
        disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"
      } ${checked ? "bg-emerald-500" : "bg-stone-600"}`}
    >
      <span
        className={`ml-0.5 inline-block h-5 w-5 transform rounded-full bg-white transition ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

const toNum = (value: unknown, fallback = 0) =>
  numberValue(value, fallback);

const normName = (value: string) =>
  value ? value.charAt(0).toLocaleUpperCase("de-DE") + value.slice(1) : value;

function normalizeStreetChoice(value: unknown) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/strasse/g, "straße")
    .replace(/\s+/g, " ")
    .trim();
}

function findOfficialStreet(streets: string[], value: unknown) {
  const target = normalizeStreetChoice(value);

  if (!target) return "";

  return streets.find((street) => normalizeStreetChoice(street) === target) || "";
}

function safeJsonParse(value: string | null): unknown {
  return parseJsonUnknown(value);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, Math.max(0, ms));
  });
}

function cleanTrackOrderId(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9_-]/g, "");
}

function rememberLastDeliveryTrackId(trackingToken: unknown, orderId?: unknown) {
  const cleanToken = cleanTrackOrderId(trackingToken);
  const cleanOrderId = cleanTrackOrderId(orderId);

  if (!cleanToken) return;

  rememberCustomerTracking({
    trackingToken: cleanToken,
    orderId: cleanOrderId || undefined,
  });
}

function isFilled(value: unknown) {
  return String(value ?? "").trim().length > 0;
}

function digitsOnly(value: unknown) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeCheckoutZip(value: unknown) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 5);
}

function clearDeliveryAddressForZip(current: Address, zip: string): Address {
  return {
    ...current,
    zip,
    street: "",
    house: "",
    city: "",
    floor: "",
    entrance: "",
    note: "",
  };
}

function withPersonalCheckoutFields(current: Address, saved?: Partial<Address> | null): Address {
  if (!saved || typeof saved !== "object") return current;

  return {
    ...current,
    name: saved.name ?? current.name,
    phone: saved.phone ?? current.phone,
    email: saved.email ?? current.email,
    emailOptIn: Boolean(saved.emailOptIn ?? current.emailOptIn),
  };
}

function mergeAddressForCheckoutZip(
  current: Address,
  saved: Partial<Address> | null | undefined,
  mode: Mode,
  preferredZip?: unknown,
): Address {
  if (!saved || typeof saved !== "object") return current;

  if (mode !== "delivery") {
    return {
      ...current,
      ...saved,
      email: saved.email ?? current.email,
      emailOptIn: Boolean(saved.emailOptIn ?? current.emailOptIn),
    };
  }

  const requestedZip = normalizeCheckoutZip(preferredZip);
  const savedZip = normalizeCheckoutZip(saved.zip);
  const targetZip = requestedZip || savedZip || normalizeCheckoutZip(current.zip);

  /*
    Sepette/menüde seçilen PLZ, kayıtlı adresteki PLZ'den farklıysa
    eski sokak/kapı bilgilerini taşımıyoruz. Sadece isim/telefon/e-posta kalır.
  */
  if (requestedZip && savedZip !== requestedZip) {
    return clearDeliveryAddressForZip(withPersonalCheckoutFields(current, saved), requestedZip);
  }

  return {
    ...current,
    ...saved,
    zip: targetZip,
    email: saved.email ?? current.email,
    emailOptIn: Boolean(saved.emailOptIn ?? current.emailOptIn),
  };
}

function checkoutProfileKey(mode: Mode, zip?: unknown) {
  if (mode !== "delivery") return `${PROFILE_KEY}:pickup`;

  const cleanZip = normalizeCheckoutZip(zip);
  return cleanZip ? `${PROFILE_KEY}:delivery:${cleanZip}` : `${PROFILE_KEY}:delivery`;
}

function readCheckoutProfile(
  mode: Mode,
  zip?: unknown,
): Partial<Address> | null {
  if (typeof window === "undefined") return null;

  const keys =
    mode === "delivery"
      ? [checkoutProfileKey("delivery", zip), `${PROFILE_KEY}:delivery`]
      : [`${PROFILE_KEY}:pickup`];

  for (const key of keys) {
    const parsed = parseJsonUnknown(localStorage.getItem(key));
    const profile = normalizeAddress(parsed);
    if (!profile) continue;

    if (mode === "delivery" && key === `${PROFILE_KEY}:delivery`) {
      const profileZip = normalizeCheckoutZip(profile.zip);
      if (profileZip) {
        try {
          localStorage.setItem(
            checkoutProfileKey("delivery", profileZip),
            JSON.stringify(profile),
          );
        } catch {
          // Best-effort migration only.
        }
      }
    }

    return profile;
  }

  return null;
}

function saveCheckoutProfile(mode: Mode, addr: Partial<Address>) {
  if (typeof window === "undefined") return;

  try {
    if (mode === "delivery") {
      const zip = normalizeCheckoutZip(addr.zip);
      if (zip) {
        localStorage.setItem(checkoutProfileKey("delivery", zip), JSON.stringify(addr));
      }

      localStorage.setItem(`${PROFILE_KEY}:delivery`, JSON.stringify(addr));
      return;
    }

    localStorage.setItem(`${PROFILE_KEY}:pickup`, JSON.stringify(addr));
  } catch {
    // Checkout profile persistence is an optional convenience.
  }
}

function checkoutInputClass(valid: boolean, extra = "") {
  return [
    "w-full rounded-md border p-2 outline-none transition",
    valid
      ? "border-emerald-500/70 bg-emerald-500/10 ring-1 ring-emerald-500/30 focus:border-emerald-400"
      : "border-rose-500/70 bg-rose-500/10 ring-1 ring-rose-500/25 focus:border-rose-400",
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

function checkoutOptionalInputClass(extra = "") {
  return ["w-full rounded-md bg-stone-800/60 p-2 outline-none transition", extra]
    .filter(Boolean)
    .join(" ");
}

function FieldHint({
  ok,
  okText,
  errorText,
}: {
  ok: boolean;
  okText: string;
  errorText: string;
}) {
  return (
    <span className={`mt-1 block text-xs ${ok ? "text-emerald-300" : "text-rose-300"}`}>
      {ok ? okText : errorText}
    </span>
  );
}


function buildSplitUnits(items: CartItemFixed[]): SplitUnit[] {
  const units: SplitUnit[] = [];

  items.forEach((cartItem, cartIndex) => {
    const qty = Math.max(1, Math.round(toNum(cartItem.qty, 1)));
    const basePrice = toNum(cartItem.item.price, 0);
    const extras = (cartItem.add ?? []).reduce(
      (sum, extra) => sum + toNum(extra.price, 0),
      0,
    );
    const pfandUnit = resolvePfandUnit(cartItem).amount;

    // This is only a split-distribution weight. The actual payable amount is
    // always allocated from the server-verifiable payableCents total.
    const unitPrice = Math.max(0.01, basePrice + extras + pfandUnit);
    const name = String(cartItem.item.name || cartItem.item.sku || "Artikel");

    for (let unitIndex = 0; unitIndex < qty; unitIndex += 1) {
      units.push({
        key: `${cartIndex}:${String(
          cartItem.id || cartItem.item.id || cartItem.item.sku || name,
        )}:${unitIndex}`,
        label: qty > 1 ? `${name} (${unitIndex + 1}/${qty})` : name,
        weightCents: Math.max(1, Math.round(unitPrice * 100)),
      });
    }
  });

  return units;
}

function buildSplitShares(params: {
  units: SplitUnit[];
  assignments: Record<string, number>;
  people: number;
  payableCents: number;
  serviceFeeCents: number;
}): SplitShare[] {
  const { units, assignments, people, payableCents, serviceFeeCents } = params;
  const safePeople = Math.max(2, Math.round(people));
  const groups = Array.from({ length: safePeople }, (_, index) => ({
    index,
    label: `Person ${index + 1}`,
    weightCents: 0,
    items: [] as Array<{ key: string; label: string }>,
  }));

  for (const unit of units) {
    const rawIndex = Number(assignments[unit.key]);
    const personIndex =
      Number.isInteger(rawIndex) && rawIndex >= 0 && rawIndex < safePeople
        ? rawIndex
        : 0;

    groups[personIndex].weightCents += unit.weightCents;
    groups[personIndex].items.push({
      key: unit.key,
      label: unit.label,
    });
  }

  const totalWeight = groups.reduce(
    (sum, group) => sum + group.weightCents,
    0,
  );

  let allocated = 0;

  return groups.map((group, index) => {
    const isLast = index === groups.length - 1;
    const baseAmountCents =
      totalWeight <= 0
        ? 0
        : isLast
          ? Math.max(0, payableCents - allocated)
          : Math.max(
              0,
              Math.floor((payableCents * group.weightCents) / totalWeight),
            );

    allocated += baseAmountCents;

    return {
      index,
      label: group.label,
      baseAmountCents,
      serviceFeeCents,
      amountCents: baseAmountCents + serviceFeeCents,
      items: group.items,
    };
  });
}

function readPaymentEnabled(
  settings: SettingsV6,
  key: "cash" | "online" | "contactless" | "split",
  fallback: boolean,
) {
  const payments = isRecord(settings.payments) ? settings.payments : {};
  const selectedValue: unknown = payments[key];
  const direct = isRecord(selectedValue) ? selectedValue.enabled : undefined;
  const featurePayments = isRecord(settings.features?.payments)
    ? settings.features.payments
    : {};

  if (typeof direct === "boolean") return direct;

  const map: Record<typeof key, string[]> = {
    cash: ["cashPayment", "cash"],
    online: ["onlinePayment", "online"],
    contactless: ["contactlessPayment", "contactless", "posPayment", "pos"],
    split: ["splitPayment", "split"],
  };

  for (const featureKey of map[key]) {
    const value = featurePayments[featureKey];
    if (typeof value === "boolean") return value;
  }

  return fallback;
}

function routeDealStreetKey(value: unknown) {
  return normalizeStreetChoice(value)
    .replace(/straße/g, "strasse")
    .replace(/\bstr\.?\b/g, "strasse")
    .replace(/\s+/g, " ")
    .trim();
}

function routeDealList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/[;,\n]/g)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function routeDealExpiresMs(deal: ActiveRouteDeal | null | undefined) {
  const ms = Date.parse(String(deal?.expiresAt || ""));
  return Number.isFinite(ms) ? ms : 0;
}

function formatRouteDealLeft(expiresMs: number, nowMs: number) {
  const totalSeconds = Math.max(0, Math.floor((expiresMs - nowMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${pad2(minutes)}:${pad2(seconds)}`;
}

function routeDealRewardLabel(reward: RouteDealReward | null | undefined) {
  const type = String(reward?.type || "percent");

  if (type === "fixed") return `${fmt(toNum(reward?.amount, 0))} Rabatt`;
  if (type === "free_delivery") return "Lieferaufschlag geschenkt";
  if (type === "free_sauce") {
    return reward?.freeItemName ? `${reward.freeItemName} gratis` : "Gratis Soße";
  }
  if (type === "free_drink") {
    return reward?.freeItemName ? `${reward.freeItemName} gratis` : "Gratis Getränk";
  }

  return `${Math.round(toNum(reward?.percent, 15))}% Rabatt`;
}

function normalizeRouteDeal(value: unknown): ActiveRouteDeal | null {
  if (!isRecord(value)) return null;

  const rewardRecord = isRecord(value.reward) ? value.reward : {};
  const reward: RouteDealReward = {
    type: typeof rewardRecord.type === "string" ? rewardRecord.type : "percent",
    percent: toNum(rewardRecord.percent, 0),
    amount: toNum(rewardRecord.amount, 0),
    maxDiscount: toNum(rewardRecord.maxDiscount, 0),
    freeItemName:
      typeof rewardRecord.freeItemName === "string"
        ? rewardRecord.freeItemName
        : undefined,
    freeItemCategory:
      typeof rewardRecord.freeItemCategory === "string"
        ? rewardRecord.freeItemCategory
        : undefined,
  };

  return {
    id: typeof value.id === "string" ? value.id : undefined,
    ruleId: typeof value.ruleId === "string" ? value.ruleId : undefined,
    name: typeof value.name === "string" ? value.name : undefined,
    plz: typeof value.plz === "string" ? value.plz : undefined,
    street: typeof value.street === "string" ? value.street : undefined,
    streets: Array.isArray(value.streets) ? value.streets.map(String) : undefined,
    matchMode: typeof value.matchMode === "string" ? value.matchMode : undefined,
    orderId: typeof value.orderId === "string" ? value.orderId : undefined,
    startedAt: typeof value.startedAt === "string" ? value.startedAt : undefined,
    expiresAt: typeof value.expiresAt === "string" ? value.expiresAt : undefined,
    durationMinutes: toNum(value.durationMinutes, 0),
    minTotal: toNum(value.minTotal, 0),
    reward,
    message: typeof value.message === "string" ? value.message : undefined,
    requireStreet: value.requireStreet === true,
  };
}

function findActiveRouteDealForCheckout(params: {
  routeDeals: unknown;
  mode: Mode;
  zip: string;
  street: string;
  nowMs: number;
}): ActiveRouteDeal | null {
  const { routeDeals, mode, zip, street, nowMs } = params;
  const config = recordValue(routeDeals);

  if (mode !== "delivery" || config.enabled !== true) return null;

  const code = normalizePlz(zip);
  if (!code) return null;

  const streetKey = routeDealStreetKey(street);
  const active = Array.isArray(config.active) ? config.active : [];

  return active
    .map(normalizeRouteDeal)
    .filter((deal): deal is ActiveRouteDeal => deal !== null)
    .filter((deal) => {
      const expiresMs = routeDealExpiresMs(deal);
      if (!expiresMs || expiresMs <= nowMs) return false;

      const dealPlz = normalizePlz(deal.plz);
      if (!dealPlz || dealPlz !== code) return false;

      const explicitStreets = routeDealList(deal.streets);
      const mustMatchStreet =
        deal.matchMode === "street" ||
        deal.requireStreet === true ||
        explicitStreets.length > 0;

      if (!mustMatchStreet) return true;

      const allowed = explicitStreets.length
        ? explicitStreets
        : deal.street
          ? [deal.street]
          : [];

      if (!allowed.length) return true;
      if (!streetKey) return false;

      return allowed.some(
        (candidate) => routeDealStreetKey(candidate) === streetKey,
      );
    })
    .sort((a, b) => routeDealExpiresMs(a) - routeDealExpiresMs(b))[0] ?? null;
}

function computeRouteDealBenefit(params: {
  deal: ActiveRouteDeal | null;
  baseTotal: number;
  netMerchandise: number;
  deliverySurcharges: number;
  nowMs: number;
}): RouteDealBenefit {
  const { deal, baseTotal, netMerchandise, deliverySurcharges, nowMs } = params;

  if (!deal) {
    return {
      deal: null,
      applied: false,
      unlocked: false,
      discountAmount: 0,
      missingAmount: 0,
      label: "",
      rewardType: "",
      expiresMs: 0,
    };
  }

  const expiresMs = routeDealExpiresMs(deal);
  const minTotal = Math.max(0, toNum(deal?.minTotal, 0));
  const unlocked = expiresMs > nowMs && Math.round(baseTotal * 100) >= Math.round(minTotal * 100);
  const reward = deal?.reward || {};
  const rewardType = String(reward?.type || "percent");
  let discountAmount = 0;

  if (unlocked) {
    if (rewardType === "fixed") {
      discountAmount = Math.min(baseTotal, Math.max(0, toNum(reward?.amount, 0)));
    } else if (rewardType === "free_delivery") {
      discountAmount = Math.min(baseTotal, Math.max(0, deliverySurcharges));
    } else if (rewardType === "percent") {
      discountAmount = Math.max(0, netMerchandise) * (toNum(reward?.percent, 15) / 100);
    }

    const maxDiscount = Math.max(0, toNum(reward?.maxDiscount, 0));
    if (maxDiscount > 0 && discountAmount > maxDiscount) {
      discountAmount = maxDiscount;
    }
  }

  discountAmount = +Math.min(baseTotal, Math.max(0, discountAmount)).toFixed(2);

  return {
    deal,
    applied: unlocked && (discountAmount > 0 || rewardType === "free_sauce" || rewardType === "free_drink"),
    unlocked,
    discountAmount,
    missingAmount: Math.max(0, minTotal - baseTotal),
    label: routeDealRewardLabel(reward),
    rewardType,
    expiresMs,
  };
}

/* ───────── catalog ───────── */

function collectCatalog(): FlatItem[] {
  const out: FlatItem[] = [];

  const readPrice = (value: unknown) => {
    const record = recordValue(value);
    return [record.price, record.amount, record.preis, record.value]
      .map((candidate) => toNum(candidate, Number.NaN))
      .find(Number.isFinite) ?? 0;
  };

  const readName = (value: unknown) => {
    const record = recordValue(value);
    return String(
      record.name ?? record.label ?? record.title ?? record.sku ?? "Artikel",
    );
  };

  const isAvailable = (value: unknown) => {
    const record = recordValue(value);
    if (record.active === false) return false;

    const now = Date.now();
    const from = record.activeFrom ?? record.startAt;
    const to = record.activeTo ?? record.endAt;
    const fromMs = from ? Date.parse(String(from)) : Number.NaN;
    const toMs = to ? Date.parse(String(to)) : Number.NaN;

    return !(
      (Number.isFinite(fromMs) && now < fromMs) ||
      (Number.isFinite(toMs) && now > toMs)
    );
  };

  const pushProduct = (value: unknown, category?: string) => {
    const record = recordValue(value);
    if (!isAvailable(record)) return;

    out.push({
      id: stringValue(record.id || record._id || record.sku) || undefined,
      sku: stringValue(record.sku) || undefined,
      name: readName(record),
      price: readPrice(record),
      category: category ?? (stringValue(record.category) || undefined),
      tags: Array.isArray(record.tags) ? record.tags.map(String) : undefined,
    });
  };

  const pushGroupWithVariants = (value: unknown, category?: string) => {
    const record = recordValue(value);
    if (!isAvailable(record)) return;

    const pools = [
      record.variants,
      record.options,
      record.choices,
      record.items,
      record.children,
    ];

    const variants: Variant[] = pools.flatMap((pool) =>
      arrayValue(pool).flatMap((variantValue): Variant[] => {
        const variant = recordValue(variantValue);
        if (variant.active === false) return [];

        const id = String(
          variant.id ?? variant._id ?? variant.sku ?? variant.name ?? "",
        ).trim();
        if (!id) return [];

        return [{
          id,
          name: readName(variant),
          price: readPrice(variant),
          active: true,
        }];
      }),
    );

    if (!variants.length) return;

    out.push({
      id: stringValue(record.id || record._id || record.sku) || undefined,
      sku: stringValue(record.sku) || undefined,
      name: readName(record),
      category: category ?? (stringValue(record.category) || undefined),
      tags: Array.isArray(record.tags) ? record.tags.map(String) : undefined,
      variants,
    });
  };

  const drinkGroups = parseJsonUnknown(localStorage.getItem(LS_DRINK_GROUPS));
  if (Array.isArray(drinkGroups)) {
    for (const groupValue of drinkGroups) {
      const group = recordValue(groupValue);
      pushGroupWithVariants(
        { ...group, variants: group.variants },
        "drinks",
      );
    }
  }

  const globalConfig = recordValue((globalThis as typeof globalThis & {
    siteConfig?: unknown;
  }).siteConfig);
  const menu = globalConfig.menu;

  const walk = (node: unknown, category?: string) => {
    if (Array.isArray(node)) {
      node.forEach((item) => walk(item, category));
      return;
    }
    if (!isRecord(node)) return;

    const nextCategory =
      stringValue(node.category) ||
      stringValue(node.cat) ||
      stringValue(node.name) ||
      category;

    const hasVariants = [node.variants, node.options, node.choices].some(
      (value) => Array.isArray(value) && value.length > 0,
    );
    const looksLikeProduct = [node.name, node.title, node.label].some(
      (value) => typeof value === "string",
    );

    if (looksLikeProduct) {
      if (hasVariants) pushGroupWithVariants(node, nextCategory);
      else if (node.price != null || node.amount != null || node.preis != null) {
        pushProduct(node, nextCategory);
      }
    }

    [node.children, node.items, node.groups, node.sections, node.list, node.data]
      .filter((branch) => branch != null)
      .forEach((branch) => walk(branch, nextCategory));
  };

  if (menu) walk(menu);

  const products = parseJsonUnknown(localStorage.getItem(LS_PRODUCTS));
  if (Array.isArray(products)) {
    for (const productValue of products) {
      const product = recordValue(productValue);
      const hasVariants = [product.variants, product.options, product.choices].some(
        (value) => Array.isArray(value) && value.length > 0,
      );

      if (hasVariants) pushGroupWithVariants(product, stringValue(product.category));
      else pushProduct(product, stringValue(product.category));
    }
  }

  return out.filter(Boolean);
}

function catKey(name?: string) {
  const text = (name || "").toLowerCase();

  if (!text) return "";
  if (text.includes("burger")) return "burger";
  if (
    text.includes("drink") ||
    text.includes("getränk") ||
    text.includes("getraenk") ||
    text.includes("cola") ||
    text.includes("wasser") ||
    text.includes("fritz")
  ) {
    return "drinks";
  }
  if (
    text.includes("sauce") ||
    text.includes("soße") ||
    text.includes("soßen") ||
    text.includes("sossen") ||
    text.includes("sos") ||
    text.includes("ketchup") ||
    text.includes("mayo")
  ) {
    return "sauces";
  }
  if (text.includes("donut") || text.includes("dessert")) return "donuts";
  if (text.includes("hotdog")) return "hotdogs";
  if (text.includes("vegan")) return "vegan";
  if (text.includes("bubble")) return "bubbleTea";
  if (text.includes("extra")) return "extras";

  return text;
}

function pickByCategory(catalog: FlatItem[], type: "drink" | "donut" | "sauce") {
  const key = type === "drink" ? "drinks" : type === "donut" ? "donuts" : "sauces";
  return catalog.filter((item) => catKey(item.category || item.name) === key);
}

function sumCartMerchandise(items: CartItemFixed[]) {
  let sum = 0;

  for (const cartItem of items) {
    const base = toNum(cartItem.item.price, 0);
    const addSum = (cartItem.add ?? []).reduce(
      (total, extra) => total + toNum(extra.price, 0),
      0,
    );

    sum += (base + addSum) * toNum(cartItem.qty, 1);
  }

  return +sum.toFixed(2);
}

function collectFreebieUnitsCheckout(items: CartItemFixed[]): FreebieUnit[] {
  const units: FreebieUnit[] = [];

  for (const cartItem of items) {
    const qty = Math.max(1, toNum(cartItem.qty, 1));
    const unitIds = Array.isArray(cartItem.__unitIds) ? cartItem.__unitIds : [];
    const price = Math.max(0, toNum(cartItem.item.price, 0));
    const category = parseFreebieCategory(
      cartItem.category ?? cartItem.item.category ?? cartItem.item.name,
    );

    if (!category) continue;

    for (let index = 0; index < qty; index += 1) {
      units.push({
        unitId: String(unitIds[index] || `${cartItem.id}-${index}`),
        category,
        price,
      });
    }
  }

  return units;
}

function computePricingV6(
  items: CartItemFixed[],
  mode: Mode,
  plz: string | null | undefined,
) {
  const overrides = getPricingOverrides(mode);
  const rate = toNum(overrides.discountRate, 0);

  const merchandise = sumCartMerchandise(items);
  const conditionalCampaign = evaluateConditionalCartCampaign({
    cartOffers: readSettings()?.cartOffers || [],
    mode,
    baseAmount: merchandise,
    standardRate: rate,
  });
  const deliveryDiscount = conditionalCampaign.discountAmount;

  const freebie = evaluateFreebieRules({
    config: overrides.freebies,
    mode,
    merchandise,
    units: collectFreebieUnitsCheckout(items),
  });

  const discount = +(
    deliveryDiscount + freebie.discountedAmount
  ).toFixed(2);

  const afterDiscount = +Math.max(0, merchandise - discount).toFixed(2);
  const pfandSummary = computePfand(items);
  const pfand = pfandSummary.amount;

  const plzMap = overrides.plzMin || {};
  const code = (plz || "").replace(/[^\d]/g, "").slice(0, 5);
  const requiredMin =
    typeof plzMap[code] === "number" ? toNum(plzMap[code], 0) : null;
  const plzKnown = requiredMin != null;

  let surcharges = 0;

  if (mode === "delivery" && overrides.surcharges) {
    for (const ci of items) {
      const key = catKey(ci?.item?.category || ci?.item?.name || "");
      const surcharge = toNum(overrides.surcharges?.[key], 0);

      if (surcharge > 0) {
        surcharges += surcharge * toNum(ci?.qty, 1);
      }
    }
  }

  surcharges = +surcharges.toFixed(2);

  const totalPreCoupon = +(afterDiscount + surcharges + pfand).toFixed(2);

  return {
    merchandise,
    discount,
    afterDiscount,
    surcharges,
    pfand,
    pfandLines: pfandSummary.lines,
    totalPreCoupon,
    requiredMin: requiredMin ?? null,
    plzKnown,
    freebiesCfg: overrides.freebies,
    freebie,
    conditionalCampaign,
  };
}

/* ───────── coupon helpers ───────── */

function mapCartToCouponItems(items: CartItemFixed[]): Coupons.CartItemForCoupon[] {
  return items.map((ci) => {
    const addSum = (ci.add ?? []).reduce(
      (total, extra) => total + toNum(extra.price, 0),
      0,
    );

    const base = toNum(ci?.item?.price, 0);

    return {
      sku: String(ci?.item?.sku || ci?.item?.id || ci?.id || ""),
      name: String(ci?.item?.name || ""),
      category: String(ci?.item?.category || ""),
      qty: toNum(ci?.qty, 1),
      unitPrice: +(base + addSum).toFixed(2),
    };
  });
}

function computeCouponDiscount(
  code: string | null,
  items: CartItemFixed[],
  cartAfterOverride: number,
  customerPhone?: string | null,
): { amount: number; message: string; code?: string; error?: string } {
  if (!code) return { amount: 0, message: "" };

  const codeUp = code.trim();
  if (!codeUp) return { amount: 0, message: "" };

  const found = Coupons.findCouponByAnyCode(codeUp);
  const def = found.def;
  const issued = found.issued;

  if (!def) {
    return {
      amount: 0,
      message: "",
      code: codeUp,
      error: "Ungültiger Gutschein",
    };
  }

  const check = Coupons.canApply({
    def,
    issued: issued || undefined,
    cartTotal: Math.max(0, cartAfterOverride),
    cartItems: mapCartToCouponItems(items),
    customerPhone: customerPhone || undefined,
  });

  if (!check.ok) {
    return {
      amount: 0,
      message: "",
      code: codeUp,
      error: check.message || "Gutschein nicht anwendbar",
    };
  }

  return {
    amount: +check.discountAmount.toFixed(2),
    message: check.message,
    code: codeUp,
  };
}

/* ───────── component ───────── */

export default function CheckoutPage() {
  const addToCart = useCart((state) => state.addToCart);
  const items = useCart((state) => state.items);
  const clear = useCart((state) => state.clear);
  const orderMode = useCart((state) => state.orderMode);
  const setOrderMode = useCart((state) => state.setOrderMode);
  const plzStore = useCart((state) => state.plz);
  const setPLZ = useCart((state) => state.setPLZ);

  const [checkoutToasts, setCheckoutToasts] = useState<CheckoutToast[]>([]);
  const toastTimersRef = useRef<Map<string, number>>(new Map());

  const dismissCheckoutToast = useCallback((id: string) => {
    const timer = toastTimersRef.current.get(id);
    if (timer) window.clearTimeout(timer);
    toastTimersRef.current.delete(id);
    setCheckoutToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showCheckoutToast = useCallback(
    (message: string, tone: CheckoutToastTone = "info") => {
      const id = browserOpaqueToken(12);
      setCheckoutToasts((current) => [
        ...current.filter((toast) => toast.message !== message),
        { id, message, tone },
      ].slice(-3));

      const timer = window.setTimeout(() => {
        dismissCheckoutToast(id);
      }, tone === "error" ? 7000 : 4500);
      toastTimersRef.current.set(id, timer);
    },
    [dismissCheckoutToast],
  );

  useEffect(() => {
    const timers = toastTimersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const [pause, setPause] = useState<PauseState>({
    delivery: false,
    pickup: false,
  });

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const state = await syncPauseFromServer();
        if (active && state) setPause(state);
      } catch (error: unknown) {
        reportCheckoutError("pause-sync", error);
      }
    })();

    const unsubscribe = onPauseChange((state) => {
      if (active) setPause(state);
    });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  const [cfgTick, setCfgTick] = useState(0);

  useEffect(() => {
    let stop = false;

    const refreshRemoteSettings = async () => {
      try {
        await fetchAndApplyRemoteSettings();
        if (!stop) setCfgTick((tick) => tick + 1);
      } catch (error: unknown) {
        reportCheckoutError("settings-sync", error);
        if (!stop) setCfgTick((tick) => tick + 1);
      }
    };

    refreshRemoteSettings();

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === LS_SETTINGS) {
        setCfgTick((tick) => tick + 1);
      }
    };

    const onFocus = () => {
      refreshRemoteSettings();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refreshRemoteSettings();
      }
    };

    const onSettingsSync = () => {
      setCfgTick((tick) => tick + 1);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    window.addEventListener("bb_settings_changed", onSettingsSync as EventListener);
    window.addEventListener("bb:settings-sync", onSettingsSync as EventListener);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      stop = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("bb_settings_changed", onSettingsSync as EventListener);
      window.removeEventListener("bb:settings-sync", onSettingsSync as EventListener);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const settingsRaw: SettingsV6 = useMemo(() => readSettings(), [cfgTick]);

  const avgPickupMinutes = Math.max(
    1,
    toNum(settingsRaw?.hours?.avgPickupMinutes, 15),
  );
  const avgDeliveryMinutes = Math.max(
    1,
    toNum(settingsRaw?.hours?.avgDeliveryMinutes, 35),
  );

  const planCfg = useMemo(() => {
    const cfg = planFromSettings(settingsRaw?.hours);
    cfg.daysAhead = toNum(settingsRaw?.hours?.daysAhead, 0);
    return cfg;
  }, [settingsRaw]);

  const plannedSlotMinutes = Math.max(
    1,
    toNum(
      orderMode === "pickup"
        ? settingsRaw?.hours?.slotMinutesPickup
        : settingsRaw?.hours?.slotMinutesDelivery,
      toNum(settingsRaw?.hours?.slotMinutes, planCfg.slotMinutes || 15),
    ),
  );

  const phoneDigits = toNum(settingsRaw?.validation?.phoneDigits, 11) || 11;

  const paymentSettings = useMemo(
    () => ({
      cash: readPaymentEnabled(settingsRaw, "cash", true),
      online: readPaymentEnabled(settingsRaw, "online", false),
      contactless: readPaymentEnabled(settingsRaw, "contactless", false),
      split: readPaymentEnabled(settingsRaw, "split", false),
      splitServiceFee: Math.max(
        0,
        Math.min(5, toNum(settingsRaw?.payments?.split?.serviceFee, 0.2)),
      ),
      splitMaxPeople: Math.max(
        2,
        Math.min(
          10,
          Math.round(toNum(settingsRaw?.payments?.split?.maxPeople, 8)),
        ),
      ),
      rememberPaymentMethods:
        settingsRaw?.payments?.online?.rememberPaymentMethods !== false,
      whatsappShareEnabled:
        settingsRaw?.payments?.split?.whatsappShareEnabled !== false,
    }),
    [settingsRaw],
  );


  const [addr, setAddr] = useState<Address>({
    name: "",
    phone: "",
    email: "",
    emailOptIn: false,
    street: "",
    house: "",
    zip: normalizeCheckoutZip(plzStore),
    city: "",
    floor: "",
    entrance: "",
    note: "",
  });

  const [planned, setPlanned] = useState<Planned>({
    enabledPickup: false,
    timePickup: "",
    enabledDelivery: false,
    timeDelivery: "",
  });

  const mustPlanNow = !isOpenAt(
    orderMode,
    nowInTZ(planCfg.tz),
    planCfg.plan,
    planCfg.tz,
  ).open;

  const slotConfig = useMemo(
    () => ({
      plan: planCfg.plan,
      tz: planCfg.tz,
      slotMinutes: plannedSlotMinutes,
      leadPickupMin: avgPickupMinutes,
      leadDeliveryMin: avgDeliveryMinutes,
      lastOrderBufferMin: 15,
      allowPreorder: settingsRaw.hours?.allowPreorder !== false,
      daysAhead: planCfg.daysAhead ?? 0,
    }),
    [
      planCfg.plan,
      planCfg.tz,
      planCfg.daysAhead,
      plannedSlotMinutes,
      avgPickupMinutes,
      avgDeliveryMinutes,
      settingsRaw.hours?.allowPreorder,
    ],
  );

  useLayoutEffect(() => {
    if (!mustPlanNow) return;

    const today = nowInTZ(planCfg.tz);
    const first = buildSlotsForDate(orderMode, today, slotConfig)[0];
    const hhmm = first ? hhmmInTZ(first, planCfg.tz) : "";

    setPlanned((current) =>
      orderMode === "pickup"
        ? {
            ...current,
            enabledPickup: true,
            timePickup: current.timePickup || hhmm,
          }
        : {
            ...current,
            enabledDelivery: true,
            timeDelivery: current.timeDelivery || hhmm,
          },
    );
  }, [
    mustPlanNow,
    orderMode,
    planCfg.plan,
    planCfg.tz,
    plannedSlotMinutes,
    avgPickupMinutes,
    avgDeliveryMinutes,
    slotConfig,
  ]);

  const slotOptions: string[] = useMemo(() => {
    const today = nowInTZ(planCfg.tz);
    const list = buildSlotsForDate(orderMode, today, slotConfig);
    return list.map((date) => hhmmInTZ(date, planCfg.tz));
  }, [
    orderMode,
    planCfg.plan,
    planCfg.tz,
    plannedSlotMinutes,
    planCfg.daysAhead,
    avgPickupMinutes,
    avgDeliveryMinutes,
    cfgTick,
    slotConfig,
  ]);

  useEffect(() => {
    if (!mustPlanNow || slotOptions.length === 0) return;

    const first = slotOptions[0];

    setPlanned((current) =>
      orderMode === "pickup"
        ? {
            ...current,
            enabledPickup: true,
            timePickup: current.timePickup || first,
          }
        : {
            ...current,
            enabledDelivery: true,
            timeDelivery: current.timeDelivery || first,
          },
    );
  }, [mustPlanNow, slotOptions, orderMode]);

  useEffect(() => {
    const saved = normalizeSavedCheckout(
      parseJsonUnknown(localStorage.getItem(LS_CHECKOUT)),
    );
    const preferredZip = normalizeCheckoutZip(plzStore);

    if (saved.addr) {
      setAddr((current) =>
        mergeAddressForCheckoutZip(
          current,
          saved.addr,
          orderMode,
          preferredZip,
        ),
      );
    }

    if (saved.planned) {
      setPlanned(saved.planned);
    }
    // This hydration intentionally runs once; later updates use dedicated
    // storage/settings listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const preferredZip = normalizeCheckoutZip(plzStore);
    const profile = readCheckoutProfile(orderMode, preferredZip);
    if (!profile) return;

    setAddr((current) =>
      mergeAddressForCheckoutZip(
        current,
        profile,
        orderMode,
        preferredZip || current.zip,
      ),
    );
  }, [orderMode, plzStore]);

  useEffect(() => {
    try {
      localStorage.setItem(
        LS_CHECKOUT,
        JSON.stringify({
          addr,
          planned,
          orderMode,
        }),
      );
    } catch {
      // Checkout form persistence must never block ordering.
    }
  }, [addr, planned, orderMode]);

  const profileTimer = useRef<number | null>(null);
  const [streetOptions, setStreetOptions] = useState<string[]>([]);
  const [streetQuery, setStreetQuery] = useState("");
  const [showSug, setShowSug] = useState(false);

  useEffect(() => {
    if (orderMode !== "delivery") return;

    const storeZip = normalizeCheckoutZip(plzStore);
    if (!storeZip) return;

    setAddr((current) => {
      const currentZip = normalizeCheckoutZip(current.zip);
      if (currentZip === storeZip) return current;

      return clearDeliveryAddressForZip(current, storeZip);
    });

    setStreetOptions(getStreets(storeZip));
    setStreetQuery("");
    setShowSug(false);
  }, [orderMode, plzStore]);

  useEffect(() => {
    if (profileTimer.current) {
      window.clearTimeout(profileTimer.current);
    }

    profileTimer.current = window.setTimeout(() => {
      try {
        const toSave: Partial<Address> = {
          name: addr.name,
          phone: addr.phone,
          email: addr.email,
          emailOptIn: Boolean(addr.emailOptIn),
          street: (addr.street || streetQuery || "").trim(),
          house: addr.house,
          zip: addr.zip,
          city: addr.city,
          floor: addr.floor,
          entrance: addr.entrance,
          note: addr.note,
        };

        saveCheckoutProfile(orderMode, toSave);
      } catch (error: unknown) {
        reportCheckoutError("profile-save", error);
      }
    }, 400);

    return () => {
      if (profileTimer.current) {
        window.clearTimeout(profileTimer.current);
      }
    };
  }, [orderMode, addr, streetQuery]);

  const base = useMemo(
    () => computePricingV6(items, orderMode, addr.zip || plzStore),
    [items, orderMode, addr.zip, plzStore, cfgTick],
  );

  const {
    merchandise,
    discount,
    afterDiscount,
    surcharges,
    pfand,
    requiredMin,
    plzKnown,
  } = base;

  const [lsTick, setLsTick] = useState(0);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [confirm, setConfirm] = useState<{
    id?: string;
    etaMin?: number;
    emergencyMode?: boolean;
    mode?: Mode;
    plannedTime?: string | null;
    trackingToken?: string;
  } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [orderRetryState, setOrderRetryState] = useState<{
    attempt: number;
    elapsedSec: number;
    nextRetryInSec: number;
    emergencySending?: boolean;
  } | null>(null);
  const [routeDealNowMs, setRouteDealNowMs] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setRouteDealNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  const [rememberPaymentMethod, setRememberPaymentMethod] = useState(true);
  const [paymentProfileRemembered, setPaymentProfileRemembered] = useState(false);
  const [paymentProfileMethods, setPaymentProfileMethods] = useState<
    SavedPaymentMethod[]
  >([]);
  const [selectedSavedPaymentMethodId, setSelectedSavedPaymentMethodId] =
    useState("");
  const [activePaymentRecovery, setActivePaymentRecovery] =
    useState<ActivePaymentRecovery | null>(null);
  const [paymentRecoveryBusy, setPaymentRecoveryBusy] = useState(false);
  const [paymentRecoveryMessage, setPaymentRecoveryMessage] = useState("");
  const [paymentRecoveryNowMs, setPaymentRecoveryNowMs] = useState(() => Date.now());
  const paymentExpirySyncRef = useRef(false);
  const [tipChoice, setTipChoice] = useState<TipChoice>("none");
  const [customTip, setCustomTip] = useState("");
  const [splitPeople, setSplitPeople] = useState(2);
  const [splitAssignments, setSplitAssignments] = useState<
    Record<string, number>
  >({});

  const syncActivePaymentRecovery = useCallback(
    async (candidate?: ActivePaymentRecovery | null) => {
      const recovery = candidate ?? readActivePaymentRecovery();

      if (!recovery) {
        setActivePaymentRecovery(null);
        return;
      }

      setActivePaymentRecovery(recovery);

      try {
        const response = await fetch(
          `/api/payments/session?id=${encodeURIComponent(
            recovery.paymentSessionId,
          )}&recovery=${encodeURIComponent(recovery.recoveryToken)}`,
          { cache: "no-store" },
        );
        const raw: unknown = await response.json().catch(() => null);
        const payload = parsePaymentSessionResponse(raw);

        if (paymentRecoveryIsTerminal(payload)) {
          clearActivePaymentRecoveryStorage();
          setActivePaymentRecovery(null);
          setPaymentRecoveryMessage("");
          return;
        }

        const nextRecovery: ActivePaymentRecovery = {
          ...recovery,
          expiresAt: payload?.recoveryExpiresAt || recovery.expiresAt || null,
        };

        try {
          localStorage.setItem(
            ACTIVE_PAYMENT_RECOVERY_KEY,
            JSON.stringify(nextRecovery),
          );
        } catch (error: unknown) {
          reportCheckoutError("payment-recovery-storage", error);
        }

        setActivePaymentRecovery(nextRecovery);
      } catch (error: unknown) {
        // Keep the local recovery card visible during a temporary network error.
        reportCheckoutError("payment-recovery-sync", error);
      }
    },
    [],
  );

  useEffect(() => {
    const restore = () => {
      setPaymentRecoveryNowMs(Date.now());
      void syncActivePaymentRecovery();
    };
    restore();
    window.addEventListener("pageshow", restore);
    window.addEventListener("focus", restore);
    window.addEventListener(
      "bb:payment-recovery-changed",
      restore as EventListener,
    );
    return () => {
      window.removeEventListener("pageshow", restore);
      window.removeEventListener("focus", restore);
      window.removeEventListener(
        "bb:payment-recovery-changed",
        restore as EventListener,
      );
    };
  }, [syncActivePaymentRecovery]);

  useEffect(() => {
    if (!activePaymentRecovery) return;

    const timer = window.setInterval(() => {
      setPaymentRecoveryNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [activePaymentRecovery]);

  useEffect(() => {
    if (
      !activePaymentRecovery?.expiresAt ||
      paymentRecoveryBusy ||
      paymentExpirySyncRef.current
    ) {
      return;
    }

    const expiresAtMs = Date.parse(String(activePaymentRecovery.expiresAt));
    if (!Number.isFinite(expiresAtMs) || expiresAtMs > paymentRecoveryNowMs) {
      return;
    }

    paymentExpirySyncRef.current = true;
    void syncActivePaymentRecovery(activePaymentRecovery).finally(() => {
      window.setTimeout(() => {
        paymentExpirySyncRef.current = false;
      }, 5000);
    });
  }, [
    activePaymentRecovery,
    paymentRecoveryBusy,
    paymentRecoveryNowMs,
    syncActivePaymentRecovery,
  ]);

  useEffect(() => {
    if (!paymentSettings.online || !paymentSettings.rememberPaymentMethods) {
      setPaymentProfileRemembered(false);
      setPaymentProfileMethods([]);
      return;
    }

    let active = true;

    void fetch("/api/payments/profile", { cache: "no-store" })
      .then(async (response) => {
        const raw: unknown = await response.json().catch(() => null);
        return parsePaymentProfileResponse(raw);
      })
      .then((profile) => {
        if (!active) return;

        setPaymentProfileRemembered(profile.remembered);
        setPaymentProfileMethods(profile.methods);
        setSelectedSavedPaymentMethodId((current) =>
          profile.methods.some((item) => item.id === current)
            ? current
            : profile.methods[0]?.id || "",
        );

        if (profile.remembered) {
          setRememberPaymentMethod(true);
        }
      })
      .catch((error: unknown) => {
        reportCheckoutError("payment-profile", error);
        if (!active) return;
        setPaymentProfileRemembered(false);
        setPaymentProfileMethods([]);
        setSelectedSavedPaymentMethodId("");
      });

    return () => {
      active = false;
    };
  }, [paymentSettings.online, paymentSettings.rememberPaymentMethods]);

  useEffect(() => {
    if (paymentMethod === "online" && !paymentSettings.online) {
      setPaymentMethod(paymentSettings.cash ? "cash" : "online");
    }

    if (
      paymentMethod === "split_contactless" &&
      (!paymentSettings.online || !paymentSettings.split)
    ) {
      setPaymentMethod(paymentSettings.online ? "online" : "cash");
    }

    if (
      paymentMethod === "cash" &&
      !paymentSettings.cash &&
      paymentSettings.online
    ) {
      setPaymentMethod("online");
    }
  }, [
    paymentMethod,
    paymentSettings.cash,
    paymentSettings.online,
    paymentSettings.split,
  ]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (
        !event.key ||
        event.key === LS_ACTIVE_COUPON ||
        event.key === LS_ACTIVE_COUPON_META ||
        event.key === LS_CHECKOUT
      ) {
        setLsTick((tick) => tick + 1);
      }
    };

    const onCouponEvent = () => {
      setLsTick((tick) => tick + 1);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("bb_coupon_changed", onCouponEvent as EventListener);
    window.addEventListener("bb:coupon-sync", onCouponEvent as EventListener);
    window.addEventListener("bb:coupon-changed", onCouponEvent as EventListener);

    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("bb_coupon_changed", onCouponEvent as EventListener);
      window.removeEventListener("bb:coupon-sync", onCouponEvent as EventListener);
      window.removeEventListener("bb:coupon-changed", onCouponEvent as EventListener);
    };
  }, []);

  const activeCode = useMemo(() => {
    try {
      return (localStorage.getItem(LS_ACTIVE_COUPON) || "").trim();
    } catch {
      return "";
    }
  }, [lsTick, items.length]);

  const couponItems = useMemo(() => mapCartToCouponItems(items), [items]);

  const coupon = useMemo(
    () =>
      computeCouponDiscount(
        activeCode,
        items,
        afterDiscount,
        (addr.phone || "").replace(/\D/g, "") || null,
      ),
    [activeCode, items, afterDiscount, addr.phone],
  );

  const couponAmount = Math.min(afterDiscount, Math.max(0, coupon.amount || 0));

  const routeDealStreetValue = (addr.street || streetQuery || "").trim();
  const activeRouteDeal = useMemo(
    () =>
      findActiveRouteDealForCheckout({
        routeDeals: settingsRaw?.routeDeals,
        mode: orderMode,
        zip: addr.zip || plzStore || "",
        street: routeDealStreetValue,
        nowMs: routeDealNowMs,
      }),
    [
      settingsRaw?.routeDeals,
      orderMode,
      addr.zip,
      plzStore,
      routeDealStreetValue,
      routeDealNowMs,
    ],
  );

  const routeDealBaseTotal = +((afterDiscount - couponAmount) + surcharges).toFixed(2);
  const routeDealBenefit = useMemo(
    () =>
      computeRouteDealBenefit({
        deal: activeRouteDeal,
        baseTotal: routeDealBaseTotal,
        netMerchandise: +(afterDiscount - couponAmount).toFixed(2),
        deliverySurcharges: surcharges,
        nowMs: routeDealNowMs,
      }),
    [
      activeRouteDeal,
      routeDealBaseTotal,
      afterDiscount,
      couponAmount,
      surcharges,
      routeDealNowMs,
    ],
  );

  const routeDealDiscount = routeDealBenefit.discountAmount;
  const totalFinal = roundToNearest10Cents(
    Math.max(0, routeDealBaseTotal - routeDealDiscount) + pfand,
  );

  const tipAmount = useMemo(() => {
    if (tipChoice === "none") return 0;
    if (tipChoice === "custom") {
      return +Math.max(0, toNum(customTip, 0)).toFixed(2);
    }

    return +toNum(tipChoice, 0).toFixed(2);
  }, [tipChoice, customTip]);

  const payableTotal = roundToNearest10Cents(totalFinal + tipAmount);

  const splitUnits = useMemo(() => buildSplitUnits(items), [items]);
  const splitServiceFeeCents = Math.max(
    0,
    Math.round(paymentSettings.splitServiceFee * 100),
  );

  useEffect(() => {
    setSplitPeople((current) =>
      Math.max(2, Math.min(paymentSettings.splitMaxPeople, current)),
    );
  }, [paymentSettings.splitMaxPeople]);

  useEffect(() => {
    setSplitAssignments((current) => {
      const next: Record<string, number> = {};
      let changed = false;

      splitUnits.forEach((unit, index) => {
        const existing = current[unit.key];
        const person =
          Number.isInteger(existing) &&
          existing >= 0 &&
          existing < splitPeople
            ? existing
            : index % splitPeople;

        next[unit.key] = person;

        if (current[unit.key] !== person) {
          changed = true;
        }
      });

      if (Object.keys(current).length !== Object.keys(next).length) {
        changed = true;
      }

      return changed ? next : current;
    });
  }, [splitUnits, splitPeople]);

  const splitShares = useMemo(
    () =>
      buildSplitShares({
        units: splitUnits,
        assignments: splitAssignments,
        people: splitPeople,
        payableCents: Math.max(0, Math.round(payableTotal * 100)),
        serviceFeeCents: splitServiceFeeCents,
      }),
    [
      splitUnits,
      splitAssignments,
      splitPeople,
      payableTotal,
      splitServiceFeeCents,
    ],
  );

  const splitPlanValid =
    splitUnits.length > 0 &&
    splitShares.length >= 2 &&
    splitShares.every(
      (share) => share.items.length > 0 && share.baseAmountCents > 0,
    );

  const splitGrandTotal = +(
    splitShares.reduce((sum, share) => sum + share.amountCents, 0) / 100
  ).toFixed(2);

  const meetsMin =
    orderMode === "pickup"
      ? true
      : plzKnown
        ? Math.round(Math.max(0, totalFinal - pfand) * 100) >= Math.round(toNum(requiredMin, 0) * 100)
        : false;

  const freebieEvaluation: FreebieEvaluation =
    base.freebie || {
      enabled: false,
      allowed: 0,
      used: 0,
      remaining: 0,
      discountedAmount: 0,
      thresholds: [],
      rules: [],
    };

  const modePaused = isModePaused(orderMode, pause);
  const pauseMessage = modePaused
    ? orderMode === "pickup"
      ? "Abholung ist vorübergehend pausiert. Online-Bestellungen sind aktuell nicht möglich."
      : "Lieferung ist vorübergehend pausiert. Online-Bestellungen sind aktuell nicht möglich."
    : "";

  const streetValue = (streetQuery || addr.street || "").trim();
  const officialStreet = useMemo(
    () => findOfficialStreet(streetOptions, streetValue),
    [streetOptions, streetValue],
  );

  const nameOk = isFilled(addr.name);
  const phoneOk = digitsOnly(addr.phone).length === phoneDigits;
  const zipOk =
    orderMode === "pickup" ? true : digitsOnly(addr.zip).length === 5 && plzKnown;
  const streetOk =
    orderMode === "pickup" ? true : zipOk && streetOptions.length > 0 && !!officialStreet;
  const houseOk = orderMode === "pickup" ? true : isFilled(addr.house);

  const requiredOk =
    orderMode === "pickup"
      ? nameOk && phoneOk
      : nameOk && phoneOk && zipOk && streetOk && houseOk;

  const emailValid =
    !addr.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr.email.trim());

  const plannedEnabledVirtual =
    orderMode === "pickup"
      ? mustPlanNow || planned.enabledPickup
      : mustPlanNow || planned.enabledDelivery;

  const plannedTime = orderMode === "pickup" ? planned.timePickup : planned.timeDelivery;
  const normalizedPlannedTime = normalizePlannedHHMM(plannedTime);
  const plannedOk = plannedEnabledVirtual ? !!normalizedPlannedTime : true;
  const noSlotsToday = plannedEnabledVirtual && (slotOptions?.length ?? 0) === 0;

  const disableSend =
    items.length === 0 ||
    !requiredOk ||
    !emailValid ||
    !plannedOk ||
    noSlotsToday ||
    (orderMode === "delivery" && (!plzKnown || !meetsMin)) ||
    !phoneOk ||
    modePaused;

  const paymentPlanBlocked =
    paymentMethod === "split_contactless" && !splitPlanValid;
  const paymentMethodUnavailable =
    (paymentMethod === "cash" && !paymentSettings.cash) ||
    (paymentMethod === "online" && !paymentSettings.online) ||
    (paymentMethod === "split_contactless" &&
      (!paymentSettings.online || !paymentSettings.split));
  const disablePaymentSubmit =
    Boolean(activePaymentRecovery) ||
    disableSend ||
    paymentPlanBlocked ||
    paymentMethodUnavailable;

  const filteredStreets = useMemo(
    () => searchStreets(addr.zip, streetQuery, 50),
    [addr.zip, streetQuery],
  );

  const onZipChange = (value: string, resetStreet = true) => {
    const only = normalizeCheckoutZip(value);

    setPLZ(only || null);

    const list = getStreets(only);
    setStreetOptions(list);

    setAddr((current) => {
      const changed = normalizeCheckoutZip(current.zip) !== only;

      if (!resetStreet || !changed) {
        return {
          ...current,
          zip: only,
        };
      }

      return clearDeliveryAddressForZip(current, only);
    });

    if (resetStreet) {
      setStreetQuery("");
      setShowSug(false);
    }
  };

  useEffect(() => {
    const zip = normalizeCheckoutZip(addr.zip);

    if (!zip) {
      setStreetOptions([]);
      setStreetQuery("");
      return;
    }

    const list = getStreets(zip);
    setStreetOptions(list);

    if (!streetQuery && addr.street) {
      const match = findOfficialStreet(list, addr.street);
      setStreetQuery(match || "");
    }
  }, [addr.zip, addr.street, streetQuery]);

  const enablePlanned = (enable: boolean) => {
    const today = nowInTZ(planCfg.tz);
    const first = buildSlotsForDate(orderMode, today, slotConfig)[0];
    const hhmm = first ? hhmmInTZ(first, planCfg.tz) : "";

    if (orderMode === "pickup") {
      setPlanned((current) => ({
        ...current,
        enabledPickup: enable,
        timePickup: enable ? current.timePickup || hhmm : "",
      }));
    } else {
      setPlanned((current) => ({
        ...current,
        enabledDelivery: enable,
        timeDelivery: enable ? current.timeDelivery || hhmm : "",
      }));
    }
  };

  const ensureValidPlanned = (): boolean => {
    if (!mustPlanNow) return true;

    const tz = planCfg.tz;
    const selectedHHMM = normalizePlannedHHMM(
      orderMode === "pickup" ? planned.timePickup : planned.timeDelivery,
    );

    const candidate =
      plannedEnabledVirtual && selectedHHMM ? todayAt(selectedHHMM, tz) : nowInTZ(tz);

    const result = validatePlannedTime(orderMode, candidate, {
      plan: planCfg.plan,
      tz,
      leadPickupMin: avgPickupMinutes,
      leadDeliveryMin: avgDeliveryMinutes,
      lastOrderBufferMin: 15,
      siteClosed: false,
      allowPreorder: settingsRaw?.hours?.allowPreorder !== false,
      daysAhead: planCfg.daysAhead ?? 0,
    });

    if (result.ok) return true;

    if (result.suggest) {
      const hhmm = hhmmInTZ(result.suggest, tz);

      if (orderMode === "pickup") {
        setPlanned((current) => ({
          ...current,
          enabledPickup: true,
          timePickup: hhmm,
        }));
      } else {
        setPlanned((current) => ({
          ...current,
          enabledDelivery: true,
          timeDelivery: hhmm,
        }));
      }
    }

    return false;
  };

  const catalog = useMemo(() => collectCatalog(), [cfgTick]);

  const hasBurger = items.some((ci) =>
    String(ci?.item?.category || "").toLowerCase().includes("burger"),
  );

  const hasPommes = items.some((ci) =>
    ["pommes", "fries", "patates", "friet", "kartoffel"].some((key) =>
      String(ci?.item?.name || "").toLowerCase().includes(key),
    ),
  );

  const hasDrink = items.some((ci) =>
    ["drink", "getränk", "cola", "fanta", "sprite", "wasser", "fritz"].some((key) =>
      (ci?.item?.category || ci?.item?.name || "").toLowerCase().includes(key),
    ),
  );

  const hasSauce = items.some((ci) =>
    ["sauce", "soße", "soßen", "sos", "ketchup", "mayo"].some((key) =>
      (ci?.item?.category || ci?.item?.name || "").toLowerCase().includes(key),
    ),
  );

  const hasDonut = items.some((ci) =>
    ["donut", "dessert", "süß", "suess"].some((key) =>
      (ci?.item?.category || ci?.item?.name || "").toLowerCase().includes(key),
    ),
  );

  let suggestion: "drink" | "donut" | "sauce" | null = null;

  if (hasBurger && hasPommes && !hasDrink) suggestion = "drink";
  else if (hasBurger && hasPommes && hasDrink && !hasDonut) suggestion = "donut";
  else if ((hasBurger || hasPommes) && hasDrink && !hasSauce) suggestion = "sauce";

  const [drawer, setDrawer] = useState<null | "drink" | "donut" | "sauce">(null);
  const drawerList: FlatItem[] = useMemo(
    () => (drawer ? pickByCategory(catalog, drawer) : []),
    [drawer, catalog],
  );

  const [drawerSel, setDrawerSel] = useState<Record<string, number>>({});

  useEffect(() => {
    setDrawerSel({});
  }, [drawer]);

  const drawerCount = Object.values(drawerSel).reduce(
    (total, value) => total + (value || 0),
    0,
  );

  const drawerSum = useMemo(() => {
    let sum = 0;

    for (const item of drawerList) {
      if (item.variants?.length) {
        for (const variant of item.variants) {
          const key = `${item.id || item.sku}-${variant.id}`;
          const qty = drawerSel[key] || 0;

          if (qty > 0) sum += variant.price * qty;
        }
      } else {
        const key = `${item.id || item.sku}`;
        const qty = drawerSel[key] || 0;

        if (qty > 0) sum += (item.price || 0) * qty;
      }
    }

    return sum;
  }, [drawerList, drawerSel]);

  const applyDrawer = () => {

    for (const item of drawerList) {
      if (item.variants?.length) {
        for (const variant of item.variants) {
          const key = `${item.id || item.sku}-${variant.id}`;
          const qty = drawerSel[key] || 0;

          if (qty > 0) {
            addToCart({
              item: {
                id: key,
                name: `${item.name} • ${variant.name}`,
                price: variant.price,
                category: item.category || "drinks",
              },
              qty,
            });
          }
        }
      } else {
        const key = `${item.id || item.sku}`;
        const qty = drawerSel[key] || 0;

        if (qty > 0) {
          addToCart({
            item: {
              id: key,
              name: item.name,
              price: item.price || 0,
              category: item.category || "drinks",
            },
            qty,
          });
        }
      }
    }

    setDrawer(null);
  };

  const paymentRecoveryCountdown = formatPaymentRecoveryCountdown(
    activePaymentRecovery?.expiresAt,
    paymentRecoveryNowMs,
  );

  const cancelActivePaymentRecovery = useCallback(async () => {
    const recovery = activePaymentRecovery ?? readActivePaymentRecovery();
    if (!recovery || paymentRecoveryBusy) return;

    try {
      setPaymentRecoveryBusy(true);
      setPaymentRecoveryMessage("");

      const response = await fetch("/api/payments/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          paymentSessionId: recovery.paymentSessionId,
          recoveryToken: recovery.recoveryToken,
        }),
        cache: "no-store",
      });
      const raw: unknown = await response.json().catch(() => null);
      const payload = parsePaymentSessionResponse(raw);

      if (!response.ok || payload.cancelled !== true) {
        throw new Error(
          payload.message ||
            payload.error ||
            "Die offene Zahlung konnte nicht storniert werden.",
        );
      }

      clearActivePaymentRecoveryStorage();
      setActivePaymentRecovery(null);
      setPaymentRecoveryMessage("");
    } catch (error: unknown) {
      reportCheckoutError("payment-recovery-cancel", error);
      setPaymentRecoveryMessage(
        errorMessage(
          error,
          "Die offene Zahlung konnte nicht storniert werden. Bitte erneut versuchen.",
        ),
      );
    } finally {
      setPaymentRecoveryBusy(false);
    }
  }, [activePaymentRecovery, paymentRecoveryBusy]);

  const continueActivePayment = useCallback(() => {
    const recovery = activePaymentRecovery ?? readActivePaymentRecovery();
    if (!recovery?.manageUrl) return;
    window.location.assign(recovery.manageUrl);
  }, [activePaymentRecovery]);

  const clearActiveCoupon = () => {
    try {
      localStorage.removeItem(LS_ACTIVE_COUPON);
      localStorage.removeItem(LS_ACTIVE_COUPON_META);
      window.dispatchEvent(new CustomEvent("bb_coupon_changed"));
      window.dispatchEvent(new CustomEvent("bb:coupon-sync"));
    } catch {
      // Coupon storage cleanup is best-effort.
    }

    setLsTick((tick) => tick + 1);
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 pb-6 sm:px-6">
      <CheckoutToastViewport
        toasts={checkoutToasts}
        onDismiss={dismissCheckoutToast}
      />

      {activePaymentRecovery && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
          <div className="w-full max-w-lg rounded-3xl border border-amber-400/50 bg-stone-950 p-5 shadow-2xl sm:p-6">
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-amber-300">
              Offene Zahlung
            </div>
            <h2 className="mt-2 text-2xl font-black text-white">
              Bitte zuerst die laufende Zahlung abschließen
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-stone-300">
              Solange diese Zahlung offen ist, bleibt der Checkout gesperrt.
              Dadurch entstehen keine doppelte Bestellung und keine doppelte
              Zahlung.
            </p>

            {paymentRecoveryCountdown && (
              <div className="mt-4 rounded-2xl border border-stone-700 bg-stone-900/80 p-4 text-center">
                <div className="text-xs uppercase tracking-wide text-stone-400">
                  Verbleibende Zeit
                </div>
                <div className="mt-1 text-4xl font-black tabular-nums text-amber-300">
                  {paymentRecoveryCountdown}
                </div>
                <div className="mt-1 text-xs text-stone-400">
                  Danach wird die offene Zahlung automatisch geschlossen.
                </div>
              </div>
            )}

            {paymentRecoveryMessage && (
              <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-100">
                {paymentRecoveryMessage}
              </div>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={paymentRecoveryBusy}
                onClick={continueActivePayment}
                className="rounded-xl bg-amber-400 px-4 py-3 font-black text-black disabled:opacity-50"
              >
                Zahlung fortsetzen
              </button>
              <button
                type="button"
                disabled={paymentRecoveryBusy}
                onClick={() => void cancelActivePaymentRecovery()}
                className="rounded-xl border border-rose-400/60 bg-rose-500/10 px-4 py-3 font-bold text-rose-100 disabled:opacity-50"
              >
                {paymentRecoveryBusy
                  ? "Zahlung wird storniert …"
                  : "Zahlung stornieren"}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="sticky top-0 z-40 -mx-4 border-b border-stone-800/60 bg-stone-950/70 px-4 pb-3 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex items-center justify-between">
          <Link href="/menu" className="text-sm text-stone-300 hover:text-stone-100">
            ← Zurück zum Menü
          </Link>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setOrderMode("pickup")}
              className={`nav-pill ${orderMode === "pickup" ? "nav-pill--active" : ""}`}
              title="Im Laden abholen"
            >
              Abholen
            </button>

            <button
              type="button"
              onClick={() => setOrderMode("delivery")}
              className={`nav-pill ${orderMode === "delivery" ? "nav-pill--active" : ""}`}
              title="Lieferung"
            >
              Liefern
            </button>
          </div>
        </div>

        <h1 className="mt-3 text-2xl font-semibold">Checkout</h1>
      </div>

      {modePaused && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          {pauseMessage}
        </div>
      )}

      {orderRetryState && (
        <div className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          <div className="font-semibold">Technische Prüfung läuft</div>
          {orderRetryState.emergencySending ? (
            <div className="mt-1 leading-relaxed">
              Die Datenbank ist weiterhin nicht erreichbar. Ihre Bestellung wird jetzt im
              Notfallmodus direkt an unser Team übermittelt.
            </div>
          ) : (
            <div className="mt-1 leading-relaxed">
              Die Verbindung zur Datenbank ist gerade nicht stabil. Wir versuchen die
              Bestellung bis zu 5 Minuten lang automatisch erneut. Bitte diese Seite nicht
              schließen. Wenn die Verbindung nicht zurückkommt, wird die Bestellung als
              <b> ACİL MOD SİPARİŞ</b> per Telegram an unser Team gesendet.
            </div>
          )}
          {!orderRetryState.emergencySending && (
            <div className="mt-2 text-xs text-amber-200/85">
              Versuch: {orderRetryState.attempt} · vergangen: {orderRetryState.elapsedSec}s ·
              nächste Prüfung in ca. {orderRetryState.nextRetryInSec}s
            </div>
          )}
        </div>
      )}

      {orderMode === "delivery" && routeDealBenefit.deal && (
        <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-xl text-black">
                🚗
              </div>

              <div>
                <div className="font-semibold">
                  {routeDealBenefit.deal?.name || "Nachbarschafts-Angebot"}
                </div>
                <div className="mt-1 leading-relaxed">
                  {routeDealBenefit.deal?.message ||
                    "Unser Fahrer ist gleich in Ihrer Nähe. Bestellen Sie jetzt und sichern Sie sich Ihr Nachbarschafts-Angebot."}
                </div>
                <div className="mt-1 text-xs opacity-85">
                  {routeDealBenefit.unlocked ? (
                    <>
                      Aktiviert: <b>{routeDealBenefit.label}</b>
                    </>
                  ) : (
                    <>
                      Noch <b>{fmt(routeDealBenefit.missingAmount)}</b> bis zum Angebot.
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="inline-flex w-full items-center justify-center rounded-full border border-emerald-400/40 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100 sm:w-auto">
              {formatRouteDealLeft(routeDealBenefit.expiresMs, routeDealNowMs)}
            </div>
          </div>
        </div>
      )}

      <div className="space-y-1 text-sm">
        <div className="flex justify-between">
          <span>Warenwert</span>
          <span>{fmt(merchandise)}</span>
        </div>

        {orderMode === "delivery" && surcharges > 0 && (
          <div className="flex justify-between">
            <span>Lieferaufschläge</span>
            <span>{fmt(surcharges)}</span>
          </div>
        )}

        {discount > 0 && (
          <div className="flex justify-between text-emerald-400">
            <span>Rabatt</span>
            <span>-{fmt(discount)}</span>
          </div>
        )}

        {!!activeCode && couponAmount > 0 && (
          <div className="flex justify-between text-emerald-400">
            <span>Gutschein {coupon.code ? `(${coupon.code})` : ""}</span>
            <span>-{fmt(couponAmount)}</span>
          </div>
        )}

        {!!activeCode && couponAmount === 0 && coupon.error && (
          <div className="flex items-center justify-between text-rose-300">
            <span className="text-xs">{coupon.error}</span>
            <button
              className="rounded-md border border-stone-700/60 px-2 py-0.5 text-xs"
              onClick={clearActiveCoupon}
            >
              ✕
            </button>
          </div>
        )}

        {routeDealBenefit.applied && routeDealDiscount > 0 && (
          <div className="flex justify-between text-emerald-400">
            <span>Nachbarschafts-Angebot</span>
            <span>-{fmt(routeDealDiscount)}</span>
          </div>
        )}

        {routeDealBenefit.applied &&
          routeDealDiscount === 0 &&
          (routeDealBenefit.rewardType === "free_sauce" ||
            routeDealBenefit.rewardType === "free_drink") && (
            <div className="flex justify-between text-emerald-400">
              <span>Nachbarschafts-Angebot</span>
              <span>{routeDealBenefit.label}</span>
            </div>
          )}

        {tipAmount > 0 && (
          <div className="flex justify-between text-emerald-300">
            <span>Trinkgeld</span>
            <span>{fmt(tipAmount)}</span>
          </div>
        )}

        <div className="flex justify-between font-semibold">
          <span>Gesamt</span>
          <span>{fmt(payableTotal)}</span>
        </div>
      </div>

      {freebieEvaluation.enabled && freebieEvaluation.rules.length > 0 && (
        <div className="rounded-2xl border border-emerald-500/35 bg-emerald-500/10 p-3 text-sm text-emerald-100">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">🎁 Ihre Gratis-Vorteile</div>
            {freebieEvaluation.discountedAmount > 0 ? (
              <div className="text-xs font-semibold text-emerald-300">
                Abgezogen: {fmt(freebieEvaluation.discountedAmount)}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            {freebieEvaluation.rules.map((rule) => {
              const categoryText = freebieCategoryLabel(
                rule.category,
                rule.quantity !== 1,
              );

              return (
                <div
                  key={rule.id}
                  className={`rounded-xl border px-3 py-2 ${
                    rule.unlocked
                      ? "border-emerald-400/30 bg-emerald-400/10"
                      : "border-amber-400/30 bg-amber-400/10 text-amber-100"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-medium">
                      {rule.unlocked ? "✅" : "🔒"} {rule.quantity}× {categoryText}
                      {" · "}
                      {freebieModeLabel(rule.mode)}
                    </div>

                    <div className="text-xs opacity-90">
                      ab {fmt(rule.minTotal)}
                      {rule.maxProductPrice != null
                        ? ` · max. ${fmt(rule.maxProductPrice)}`
                        : ""}
                    </div>
                  </div>

                  <div className="mt-1 text-xs opacity-90">
                    {rule.unlocked ? (
                      rule.remaining > 0 ? (
                        <>
                          Noch <b>{rule.remaining}</b> passenden Artikel hinzufügen.
                        </>
                      ) : (
                        <>
                          Genutzt: <b>{rule.used}/{rule.allowed}</b>
                        </>
                      )
                    ) : (
                      <>
                        Noch <b>{fmt(rule.missingAmount)}</b> bis zu diesem Vorteil.
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <CouponBox
        cartTotal={afterDiscount}
        cartItems={couponItems}
        customerPhone={(addr.phone || "").replace(/\D/g, "") || null}
      />

      {suggestion && (
        <div className="flex flex-col gap-3 rounded-md border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-200 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2 sm:items-center">
            {suggestion === "drink" && <span>🥤</span>}
            {suggestion === "donut" && <span>🍩</span>}
            {suggestion === "sauce" && <span>🥫</span>}

            {suggestion === "drink" && <span>Durstig? Füge ein Getränk hinzu.</span>}
            {suggestion === "donut" && <span>Lust auf etwas Süßes? Donut auswählen.</span>}
            {suggestion === "sauce" && <span>Pommes ohne Soße? Soße hinzufügen.</span>}
          </div>

          <button onClick={() => setDrawer(suggestion)} className="btn-ghost w-full sm:w-auto">
            {suggestion === "drink" && "Getränk auswählen"}
            {suggestion === "donut" && "Donut auswählen"}
            {suggestion === "sauce" && "Soße auswählen"}
          </button>
        </div>
      )}

      {items.length === 0 && (
        <div className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-300">
          Dein Warenkorb ist leer.
        </div>
      )}

      {orderMode === "delivery" && (addr.zip || "").trim().length === 5 && !plzKnown && (
        <div className="rounded-md bg-rose-500/10 p-3 text-sm text-rose-300">
          <div className="font-medium">Außerhalb unseres Liefergebiets.</div>
          <div>Bitte eine unterstützte PLZ eingeben.</div>
        </div>
      )}

      {orderMode === "delivery" &&
        plzKnown &&
        !meetsMin &&
        typeof requiredMin === "number" && (
          <div className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-300">
            Mindestbestellwert: <b>{fmt(requiredMin)}</b>. Dein Gesamt:{" "}
            <b>{fmt(totalFinal)}</b>. Bitte weitere Artikel hinzufügen.
          </div>
        )}

      {noSlotsToday && (
        <div className="rounded-md bg-rose-500/10 p-3 text-sm text-rose-300">
          Heute sind keine Zeiten mehr verfügbar.
        </div>
      )}

      <div className="rounded-2xl border border-stone-700/60 bg-stone-900/60 p-4">
        <p className="mb-3 text-xs text-stone-400">
          Ihre Daten werden auf diesem Gerät gespeichert, damit Sie beim nächsten Mal
          schneller bestellen können. Bitte prüfen Sie, ob Ihre Daten noch aktuell sind.{" "}
          <button
            type="button"
            className="underline hover:text-stone-300"
            onClick={() => {
              try {
                localStorage.removeItem(`${PROFILE_KEY}:${orderMode}`);
              } catch (error: unknown) {
                reportCheckoutError("profile-delete", error);
              }

              showCheckoutToast("Gespeicherte Daten wurden entfernt.", "success");
            }}
          >
            Daten löschen
          </button>
        </p>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label="Vollständiger Name *" htmlFor="checkout-name">
            <input
              id="checkout-name"
              autoComplete="name"
              value={addr.name}
              onChange={(event) =>
                setAddr({
                  ...addr,
                  name:
                    settingsRaw?.validation?.nameCapitalizeFirst === false
                      ? event.target.value
                      : normName(event.target.value),
                })
              }
              className={checkoutInputClass(nameOk)}
              aria-invalid={!nameOk}
            />
            <FieldHint
              ok={nameOk}
              okText="Name ist ausgefüllt."
              errorText="Bitte vollständigen Namen eingeben."
            />
          </Field>

          <Field label={`Telefon * (${phoneDigits} Ziffern)`} htmlFor="checkout-phone">
            <input
              id="checkout-phone"
              autoComplete="tel"
              inputMode="tel"
              pattern="[\d+\s()-]+"
              value={addr.phone}
              onChange={(event) => {
                const only = event.target.value.replace(/\D/g, "").slice(0, phoneDigits);
                setAddr({ ...addr, phone: only });
              }}
              className={checkoutInputClass(phoneOk)}
              aria-invalid={!phoneOk}
            />
            <FieldHint
              ok={phoneOk}
              okText={`Telefonnummer ist korrekt (${phoneDigits} Ziffern).`}
              errorText={`Bitte genau ${phoneDigits} Ziffern eingeben.`}
            />
          </Field>

          {orderMode === "delivery" && (
            <>
              <div className="grid grid-cols-2 gap-3 md:col-span-2">
                <Field label="PLZ *" htmlFor="checkout-zip">
                  <input
                    id="checkout-zip"
                    autoComplete="postal-code"
                    placeholder="z. B. 13507"
                    inputMode="numeric"
                    value={addr.zip}
                    onChange={(event) => onZipChange(event.target.value)}
                    className={checkoutInputClass(zipOk)}
                    aria-invalid={!zipOk}
                  />
                  <FieldHint
                    ok={zipOk}
                    okText="PLZ ist gültig und im Liefergebiet."
                    errorText={
                      digitsOnly(addr.zip).length === 5
                        ? "Diese PLZ liegt nicht im Liefergebiet."
                        : "Bitte 5-stellige PLZ eingeben."
                    }
                  />
                </Field>

                <Field label="Straße *" htmlFor="checkout-street">
                  <div className="relative">
                    <input
                      id="checkout-street"
                      autoComplete="street-address"
                      value={streetQuery || addr.street}
                      onChange={(event) => {
                        const value = event.target.value;
                        const match = findOfficialStreet(streetOptions, value);

                        setStreetQuery(value);
                        setAddr((current) => ({
                          ...current,
                          street: match || "",
                        }));
                        setShowSug(true);
                      }}
                      onFocus={() => setShowSug(true)}
                      onBlur={() => {
                        window.setTimeout(() => setShowSug(false), 150);
                        setAddr((current) => {
                          const value = (streetQuery || current.street || "").trim();
                          const match = findOfficialStreet(streetOptions, value);

                          if (match) {
                            setStreetQuery(match);
                          }

                          return {
                            ...current,
                            street: match || "",
                          };
                        });
                      }}
                      placeholder={
                        streetOptions.length
                          ? "Straße aus der Liste auswählen"
                          : "Zuerst PLZ eingeben"
                      }
                      className={checkoutInputClass(streetOk)}
                      aria-invalid={!streetOk}
                    />
                    <FieldHint
                      ok={streetOk}
                      okText="Straße wurde aus der Liste ausgewählt."
                      errorText={
                        !zipOk
                          ? "Bitte zuerst gültige PLZ eingeben."
                          : streetOptions.length === 0
                            ? "Für diese PLZ ist keine Straße hinterlegt."
                            : "Bitte Straße aus der Liste auswählen."
                      }
                    />

                    {showSug &&
                      streetOptions.length > 0 &&
                      (streetQuery || "").length >= 2 && (
                        <div className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-stone-700/60 bg-stone-900/95 shadow-lg">
                          {filteredStreets.map((street) => (
                            <button
                              type="button"
                              key={street}
                              onMouseDown={(event) => event.preventDefault()}
                              onClick={() => {
                                setAddr((current) => ({ ...current, street }));
                                setStreetQuery(street);
                                setShowSug(false);
                              }}
                              className="block w-full px-3 py-2 text-left hover:bg-stone-800/70"
                            >
                              {street}
                            </button>
                          ))}

                          {filteredStreets.length === 0 && (
                            <div className="px-3 py-2 text-sm text-rose-300">
                              Keine Treffer. Bitte eine Straße aus unserer Liste wählen.
                            </div>
                          )}
                        </div>
                      )}
                  </div>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3 md:col-span-2">
                <Field label="Hausnummer *" htmlFor="checkout-house">
                  <input
                    id="checkout-house"
                    placeholder="z. B. 12A"
                    value={addr.house}
                    onChange={(event) => setAddr({ ...addr, house: event.target.value })}
                    className={checkoutInputClass(houseOk)}
                    aria-invalid={!houseOk}
                  />
                  <FieldHint
                    ok={houseOk}
                    okText="Hausnummer ist ausgefüllt."
                    errorText="Bitte Hausnummer eingeben."
                  />
                </Field>

                <Field label="Etage/Stockwerk" htmlFor="checkout-floor">
                  <input
                    id="checkout-floor"
                    placeholder="z. B. 3. OG"
                    value={addr.floor}
                    onChange={(event) => setAddr({ ...addr, floor: event.target.value })}
                    className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3 md:col-span-2">
                <Field label="Aufgang/Block" htmlFor="checkout-entrance">
                  <input
                    id="checkout-entrance"
                    placeholder="z. B. Block B / Aufgang 2"
                    value={addr.entrance}
                    onChange={(event) =>
                      setAddr({ ...addr, entrance: event.target.value })
                    }
                    className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
                  />
                </Field>

                <Field label="Stadt/Ort" htmlFor="checkout-city">
                  <input
                    id="checkout-city"
                    autoComplete="address-level2"
                    value={addr.city}
                    onChange={(event) => setAddr({ ...addr, city: event.target.value })}
                    className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
                  />
                </Field>
              </div>
            </>
          )}

          <Field label="E-Mail (optional)" htmlFor="checkout-email">
            <input
              id="checkout-email"
              autoComplete="email"
              type="email"
              placeholder="z. B. name@example.com"
              value={addr.email ?? ""}
              onChange={(event) => setAddr({ ...addr, email: event.target.value })}
              className={`w-full rounded-md bg-stone-800/60 p-2 outline-none ${
                addr.email && !emailValid ? "ring-1 ring-rose-500/60" : ""
              }`}
            />

            <div className="mt-2 flex items-center gap-2 text-xs text-stone-300/80">
              <input
                id="checkout-email-opt-in"
                type="checkbox"
                checked={!!addr.emailOptIn}
                onChange={(event) =>
                  setAddr({ ...addr, emailOptIn: event.target.checked })
                }
              />
              <label htmlFor="checkout-email-opt-in">
                Ja, ich möchte Angebote & Neuigkeiten per E-Mail erhalten.
              </label>
            </div>

            {addr.email && !emailValid && (
              <span className="mt-1 block text-xs text-rose-300">
                Bitte eine gültige E-Mail eingeben.
              </span>
            )}
          </Field>

          <div className="md:col-span-2">
            <Field
              label={
                orderMode === "pickup" ? "Hinweis zur Abholung" : "Lieferhinweis"
              }
              htmlFor="checkout-note"
            >
              <textarea
                id="checkout-note"
                rows={3}
                placeholder={
                  orderMode === "pickup"
                    ? "z. B. komme in 15 Min"
                    : "Klingeln bei Müller, Tor links, Hund vor, usw."
                }
                value={addr.note}
                onChange={(event) => setAddr({ ...addr, note: event.target.value })}
                className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
              />
            </Field>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-stone-700/60 bg-stone-950/40 p-4">
          <div className="mb-3">
            <div className="text-sm font-semibold text-stone-100">Zahlungsart</div>
            <div className="mt-1 text-xs text-stone-400">
              Wähle Barzahlung, sichere Stripe Online-Zahlung oder – wenn aktiviert –
              Getrennt zahlen. Online bezahlte Bestellungen werden erst nach erfolgreicher
              Zahlungsbestätigung an die Küche gesendet.
            </div>
          </div>

          {activePaymentRecovery && (
            <div className="mb-4 rounded-xl border border-amber-400/45 bg-amber-400/10 p-3 text-sm text-amber-50">
              <div className="font-bold">Offene Online-Zahlung</div>
              <div className="mt-1 text-xs text-stone-300">
                Du kannst dieselbe sichere Zahlung fortsetzen. Es wird dabei keine zweite Bestellung angelegt.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-lg bg-amber-400 px-3 py-2 font-bold text-black"
                  onClick={continueActivePayment}
                >
                  Zahlung fortsetzen
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-stone-600 px-3 py-2 text-stone-200"
                  disabled={paymentRecoveryBusy}
                  onClick={() => void cancelActivePaymentRecovery()}
                >
                  Offene Zahlung stornieren
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2">
            {paymentSettings.cash && (
              <button
                type="button"
                onClick={() => setPaymentMethod("cash")}
                className={`w-full rounded-xl border p-3 text-left transition ${
                  paymentMethod === "cash"
                    ? "border-emerald-500/70 bg-emerald-500/10"
                    : "border-stone-700/60 bg-stone-900/60 hover:bg-stone-800/60"
                }`}
              >
                <div className="font-medium">Barzahlung</div>
                <div className="mt-1 text-xs text-stone-400">
                  Bei Abholung oder Lieferung bar bezahlen. Die Bestellung wird sofort
                  gesendet.
                </div>
              </button>
            )}

            {paymentSettings.online && (
              <div
                className={`overflow-hidden rounded-xl border transition ${
                  paymentMethod === "online"
                    ? "border-sky-500/70 bg-sky-500/10"
                    : "border-stone-700/60 bg-stone-900/60"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setPaymentMethod("online")}
                  className={`w-full p-3 text-left transition ${
                    paymentMethod === "online" ? "bg-sky-500/5" : "hover:bg-stone-800/60"
                  }`}
                >
                  <div className="font-medium">Online-Zahlung</div>
                  <div className="mt-1 text-xs text-stone-400">
                    Sichere Zahlung über Stripe. Karten, Apple Pay, Google Pay, Link, PayPal,
                    Klarna und weitere aktivierte Methoden werden automatisch angezeigt.
                  </div>
                </button>

                {paymentMethod === "online" && (
                  <div className="border-t border-sky-500/25 px-3 pb-3 pt-3 sm:px-4 sm:pb-4">
                    {paymentProfileRemembered && paymentProfileMethods.length > 0 && (
                      <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-3 sm:p-4">
                        <div className="text-sm font-bold text-emerald-100">
                          Gespeicherte Zahlungsart
                        </div>
                        <div className="mt-1 text-xs leading-5 text-stone-400">
                          {selectedSavedPaymentMethodId
                            ? "Die ausgewählte Zahlungsart wird zuerst sicher direkt belastet. Nur wenn Bank oder Anbieter es verlangt, öffnet sich eine kurze Bestätigung."
                            : "Stripe wird geöffnet, damit du PayPal, Klarna, Apple Pay, Google Pay oder eine andere verfügbare Zahlungsart wählen kannst."}
                        </div>

                        <div className="mt-3 grid gap-2 sm:grid-cols-2">
                          {paymentProfileMethods.map((method) => (
                            <button
                              key={method.id}
                              type="button"
                              aria-pressed={selectedSavedPaymentMethodId === method.id}
                              onClick={() => setSelectedSavedPaymentMethodId(method.id)}
                              className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${
                                selectedSavedPaymentMethodId === method.id
                                  ? "border-emerald-300 bg-emerald-400/15 text-emerald-50"
                                  : "border-emerald-400/25 bg-stone-950/55 text-emerald-100"
                              }`}
                            >
                              {method.label}
                            </button>
                          ))}

                          <button
                            type="button"
                            aria-pressed={selectedSavedPaymentMethodId === ""}
                            onClick={() => setSelectedSavedPaymentMethodId("")}
                            className={`rounded-xl border px-3 py-2 text-left text-xs font-semibold transition ${
                              selectedSavedPaymentMethodId === ""
                                ? "border-sky-300 bg-sky-400/15 text-sky-50"
                                : "border-sky-400/25 bg-stone-950/55 text-sky-100"
                            }`}
                          >
                            <span className="block">Andere Zahlungsart wählen</span>
                            <span className="mt-1 block font-normal text-stone-400">
                              PayPal, Klarna, Wallet oder neue Karte
                            </span>
                          </button>
                        </div>
                      </div>
                    )}

                    {paymentSettings.rememberPaymentMethods && (
                      <>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={rememberPaymentMethod}
                          aria-label="Zahlungsart für zukünftige Bestellungen merken"
                          onClick={() => setRememberPaymentMethod((current) => !current)}
                          className="mt-3 flex w-full cursor-pointer items-start gap-3 rounded-xl border border-sky-500/30 bg-stone-950/45 p-3 text-left transition hover:bg-sky-500/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-950 sm:p-4"
                        >
                          <span
                            aria-hidden="true"
                            className={`relative mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
                              rememberPaymentMethod
                                ? "border-sky-400 bg-sky-500"
                                : "border-stone-500 bg-stone-700"
                            }`}
                          >
                            <span
                              className={`ml-0.5 inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                                rememberPaymentMethod ? "translate-x-5" : "translate-x-0"
                              }`}
                            />
                          </span>

                          <span className="min-w-0 flex-1">
                            <span className="block break-words text-sm font-semibold leading-5 text-sky-100">
                              Zahlungsart für zukünftige Bestellungen merken
                            </span>
                            <span className="mt-1 block break-words text-xs leading-5 text-stone-400">
                              {paymentProfileRemembered
                                ? "Deine gespeicherte Zahlungsart wird bei Stripe direkt angezeigt. "
                                : "Stripe speichert kompatible Zahlungsarten sicher. "}
                              Burger Brothers erhält keine Karten- oder PayPal-Zugangsdaten. Je nach
                              Bank oder Anbieter kann später trotzdem eine kurze Bestätigung nötig sein.
                            </span>
                          </span>
                        </button>

                        {paymentProfileRemembered && (
                          <button
                            type="button"
                            className="mt-2 text-xs text-stone-400 underline decoration-stone-600 underline-offset-4"
                            onClick={async () => {
                              try {
                                const response = await fetch("/api/payments/profile", {
                                  method: "DELETE",
                                  cache: "no-store",
                                });
                                if (!response.ok) {
                                  throw new Error(
                                    "Gespeicherte Zahlungsart konnte nicht entfernt werden.",
                                  );
                                }

                                setPaymentProfileRemembered(false);
                                setPaymentProfileMethods([]);
                                setSelectedSavedPaymentMethodId("");
                                setRememberPaymentMethod(false);
                                showCheckoutToast(
                                  "Gespeicherte Zahlungsart wurde entfernt.",
                                  "success",
                                );
                              } catch (error: unknown) {
                                reportCheckoutError("payment-profile-delete", error);
                                showCheckoutToast(
                                  errorMessage(
                                    error,
                                    "Gespeicherte Zahlungsart konnte nicht entfernt werden.",
                                  ),
                                  "error",
                                );
                              }
                            }}
                          >
                            Gespeicherte Zahlungsart auf diesem Gerät entfernen
                          </button>
                        )}
                      </>
                    )}

                    <PaymentTrustBadges compact className="mt-3" />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
            {paymentSettings.online && paymentSettings.split && (
              <button
                type="button"
                onClick={() => setPaymentMethod("split_contactless")}
                className={`rounded-xl border p-3 text-left transition ${
                  paymentMethod === "split_contactless"
                    ? "border-amber-500/70 bg-amber-500/10"
                    : "border-stone-700/60 bg-stone-900/60 hover:bg-stone-800/60"
                }`}
              >
                <div className="font-medium">Getrennt zahlen</div>
                <div className="mt-1 text-xs text-stone-400">
                  Produkte verteilen und jeder Person einen eigenen sicheren Zahlungslink
                  {paymentSettings.whatsappShareEnabled ? " per WhatsApp" : ""} senden.
                  Servicegebühr: {fmt(paymentSettings.splitServiceFee)} pro Person.
                </div>
              </button>
            )}

            {paymentSettings.contactless && (
              <div className="rounded-xl border border-stone-700/60 bg-stone-900/60 p-3 text-left opacity-70">
                <div className="font-medium">Kartenzahlung bei Lieferung</div>
                <div className="mt-1 text-xs text-stone-400">
                  Vorbereitung für später: Wird aktiv, sobald ein POS-Gerät vorhanden ist.
                </div>
              </div>
            )}

            {!paymentSettings.cash &&
              !paymentSettings.online &&
              !paymentSettings.contactless &&
              !paymentSettings.split && (
              <div className="rounded-xl border border-rose-500/50 bg-rose-500/10 p-3 text-sm text-rose-200 md:col-span-2">
                Es ist aktuell keine Zahlungsart aktiv. Bitte im Adminbereich mindestens
                Barzahlung aktivieren.
              </div>
            )}
          </div>

          {paymentMethod === "split_contactless" && (
            <div className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-amber-100">
                    Getrennt zahlen – Produkte verteilen
                  </div>
                  <div className="mt-1 text-xs text-stone-400">
                    Jede Person muss mindestens einen Artikel übernehmen. Danach erhält
                    jede Person einen eigenen Link für ihr Handy{paymentSettings.whatsappShareEnabled
                      ? "; die Links können direkt per WhatsApp gesendet werden"
                      : ""}. Rabatte, Aufschläge und Trinkgeld werden anteilig verteilt.
                  </div>
                </div>

                <div className="flex items-center gap-2 rounded-full border border-stone-700/60 bg-stone-950/70 p-1">
                  <button
                    type="button"
                    className="h-9 w-9 rounded-full bg-stone-800 text-lg"
                    onClick={() =>
                      setSplitPeople((current) => Math.max(2, current - 1))
                    }
                    disabled={splitPeople <= 2}
                  >
                    −
                  </button>
                  <div className="min-w-20 text-center text-sm font-bold">
                    {splitPeople} Personen
                  </div>
                  <button
                    type="button"
                    className="h-9 w-9 rounded-full bg-stone-800 text-lg"
                    onClick={() =>
                      setSplitPeople((current) =>
                        Math.min(paymentSettings.splitMaxPeople, current + 1),
                      )
                    }
                    disabled={splitPeople >= paymentSettings.splitMaxPeople}
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {splitUnits.map((unit) => (
                  <div
                    key={unit.key}
                    className="flex items-center justify-between gap-3 rounded-xl border border-stone-700/60 bg-stone-950/50 px-3 py-2"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {unit.label}
                    </span>
                    <select
                      value={String(splitAssignments[unit.key] ?? 0)}
                      onChange={(event) =>
                        setSplitAssignments((current) => ({
                          ...current,
                          [unit.key]: Number(event.target.value),
                        }))
                      }
                      className="rounded-lg border border-stone-700/60 bg-stone-900 px-2 py-1.5 text-sm outline-none"
                    >
                      {Array.from({ length: splitPeople }, (_, index) => (
                        <option key={index} value={index}>
                          Person {index + 1}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {splitShares.map((share) => (
                  <div
                    key={share.index}
                    className={`rounded-xl border p-3 ${
                      share.items.length > 0
                        ? "border-stone-700/60 bg-stone-950/50"
                        : "border-rose-500/50 bg-rose-500/10"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{share.label}</span>
                      <span className="font-bold">
                        {fmt(share.amountCents / 100)}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-stone-400">
                      Anteil {fmt(share.baseAmountCents / 100)} + Service{" "}
                      {fmt(share.serviceFeeCents / 100)}
                    </div>
                    <div className="mt-2 text-xs text-stone-300">
                      {share.items.length > 0
                        ? share.items.map((item) => item.label).join(", ")
                        : "Noch kein Artikel zugeordnet"}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center justify-between rounded-xl bg-black/30 px-3 py-2">
                <span className="text-sm">Gesamt inkl. Servicegebühr</span>
                <span className="font-black text-amber-300">
                  {fmt(splitGrandTotal)}
                </span>
              </div>

              {!splitPlanValid && (
                <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
                  Bitte jeder Person mindestens einen Artikel zuweisen.
                </div>
              )}
            </div>
          )}

          <div className="mt-4 border-t border-stone-800/70 pt-4">
            <div className="text-sm font-semibold text-stone-100">Trinkgeld</div>
            <div className="mt-1 text-xs text-stone-400">
              Optional. Wird zum Gesamtbetrag addiert.
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {[
                { key: "none" as TipChoice, label: "Kein Trinkgeld" },
                { key: "1" as TipChoice, label: "+1 €" },
                { key: "2" as TipChoice, label: "+2 €" },
                { key: "3" as TipChoice, label: "+3 €" },
                { key: "custom" as TipChoice, label: "Eigener Betrag" },
              ].map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setTipChoice(option.key)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    tipChoice === option.key
                      ? "border-emerald-500/70 bg-emerald-500/10 text-emerald-200"
                      : "border-stone-700/60 bg-stone-900/60 text-stone-200 hover:bg-stone-800/60"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {tipChoice === "custom" && (
              <div className="mt-3 max-w-xs">
                <input
                  inputMode="decimal"
                  placeholder="z. B. 2,50"
                  value={customTip}
                  onChange={(event) =>
                    setCustomTip(
                      event.target.value
                        .replace(/[^\d,.]/g, "")
                        .replace(/(,.*),/g, "$1"),
                    )
                  }
                  className="w-full rounded-md bg-stone-800/60 p-2 outline-none"
                />
              </div>
            )}

            <div className="mt-3 flex items-center justify-between rounded-lg bg-stone-900/70 px-3 py-2 text-sm">
              <span>Zu zahlen</span>
              <span className="font-semibold">
                {fmt(
                  paymentMethod === "split_contactless"
                    ? splitGrandTotal
                    : payableTotal,
                )}
              </span>
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {orderMode === "pickup" ? (
            <FieldGroup legend="Geplant optional / wenn geschlossen erforderlich">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Toggle
                    checked={mustPlanNow ? true : planned.enabledPickup}
                    onChange={(value) => enablePlanned(value)}
                    label="Geplante Abholzeit"
                    disabled={mustPlanNow}
                  />
                  <span>
                    Geplante Abholzeit
                    {mustPlanNow ? " – aktuell geschlossen" : ""}
                  </span>
                </div>

                <select
                  id="checkout-planned-pickup"
                  aria-label="Geplante Abholzeit auswählen"
                  disabled={!plannedEnabledVirtual}
                  value={planned.timePickup}
                  onChange={(event) =>
                    setPlanned((current) => ({
                      ...current,
                      timePickup: event.target.value,
                    }))
                  }
                  className={`rounded-md bg-stone-800/60 p-2 outline-none ${
                    !plannedEnabledVirtual ? "opacity-50" : ""
                  }`}
                >
                  <option value="" disabled>
                    Zeit wählen
                  </option>
                  {slotOptions.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </div>
            </FieldGroup>
          ) : (
            <FieldGroup legend="Geplant optional / wenn geschlossen erforderlich">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Toggle
                    checked={mustPlanNow ? true : planned.enabledDelivery}
                    onChange={(value) => enablePlanned(value)}
                    label="Geplante Lieferzeit"
                    disabled={mustPlanNow}
                  />
                  <span>
                    Geplante Lieferzeit
                    {mustPlanNow ? " – aktuell geschlossen" : ""}
                  </span>
                </div>

                <select
                  id="checkout-planned-delivery"
                  aria-label="Geplante Lieferzeit auswählen"
                  disabled={!plannedEnabledVirtual}
                  value={planned.timeDelivery}
                  onChange={(event) =>
                    setPlanned((current) => ({
                      ...current,
                      timeDelivery: event.target.value,
                    }))
                  }
                  className={`rounded-md bg-stone-800/60 p-2 outline-none ${
                    !plannedEnabledVirtual ? "opacity-50" : ""
                  }`}
                >
                  <option value="" disabled>
                    Zeit wählen
                  </option>
                  {slotOptions.map((time) => (
                    <option key={time} value={time}>
                      {time}
                    </option>
                  ))}
                </select>
              </div>
            </FieldGroup>
          )}

          <button
            type="button"
            onClick={async (event) => {
              if (!ensureValidPlanned()) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }

              if (disablePaymentSubmit) {
                event.preventDefault();
                return;
              }

              if (
                paymentMethod === "online" ||
                paymentMethod === "split_contactless"
              ) {
                await startStripeCheckout(paymentMethod);
                return;
              }

              await submitOrderWithPayment({
                method: "cash",
                status: "pending",
                testMode: false,
              });
            }}
            className={`card-cta card-cta--lg ${
              disablePaymentSubmit || submitBusy || submitted
                ? "pointer-events-none opacity-50"
                : ""
            }`}
            title={
              modePaused
                ? orderMode === "pickup"
                  ? "Abholung ist pausiert."
                  : "Lieferung ist pausiert."
                : disablePaymentSubmit
                  ? paymentPlanBlocked
                    ? "Bitte alle Artikel auf die Personen verteilen"
                    : "Bitte Pflichtfelder/PLZ/Minimalbetrag/Zeit prüfen"
                  : paymentMethod === "online"
                    ? "Sicher online bezahlen"
                    : paymentMethod === "split_contactless"
                      ? "Getrennte Zahlung starten"
                      : "Bestellung senden"
            }
            disabled={disablePaymentSubmit || submitBusy || submitted}
          >
            {submitBusy
              ? "Bestellung wird verarbeitet..."
              : paymentMethod === "online"
                ? `Online bezahlen • ${fmt(payableTotal)}`
                : paymentMethod === "split_contactless"
                  ? `Getrennt zahlen • ${fmt(splitGrandTotal)}`
                  : t("checkout.place_order")}
          </button>

          <button
            onClick={() => clear()}
            className="rounded-full border border-stone-700/60 bg-stone-800/60 px-5 py-2.5 font-semibold"
          >
            Warenkorb leeren
          </button>
        </div>
      </div>

      <TrackPanel variant="emphasized" />

      {confirm && submitted && !showConfirm && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          <div className="font-medium">
            {confirm.emergencyMode
              ? "Ihre Bestellung wurde im Notfallmodus übermittelt ✅"
              : "Ihre Bestellung ist eingegangen ✅"}
          </div>
          <div>
            Bestellnummer: <b>#{confirm.id}</b>
          </div>
          {confirm.emergencyMode ? (
            <div>
              Unser Team hat die Bestellung per Telegram erhalten. Wir melden uns bei
              Rückfragen telefonisch.
            </div>
          ) : (
            <div>
              {confirm.plannedTime ? (
                <>
                  {plannedConfirmationLabel(confirm.mode || orderMode)}:{" "}
                  <b>{confirm.plannedTime} Uhr</b>
                </>
              ) : (
                <>
                  {plannedEtaLabel(confirm.mode || orderMode)}:{" "}
                  <b>
                    {confirm.etaMin ??
                      ((confirm.mode || orderMode) === "pickup" ? avgPickupMinutes : avgDeliveryMinutes)}{" "}
                    Min
                  </b>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {showConfirm && confirm && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 pt-[max(1rem,env(safe-area-inset-top))]"
          onKeyDown={(event) => {
            if (event.key === "Escape") setShowConfirm(false);
          }}
        >
          <div className="w-full max-w-md rounded-2xl border border-stone-700/60 bg-stone-900/95 p-5 shadow-xl">
            <div className="mb-2 text-lg font-semibold">Bestellbestätigung</div>

            <div className="space-y-2 text-sm text-stone-200">
              <div>
                Bestellnummer: <b>#{confirm.id}</b>
              </div>
              {confirm.emergencyMode ? (
                <>
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-100">
                    Notfallmodus: Die Datenbank war nicht erreichbar. Ihre Bestellung
                    wurde direkt per Telegram an unser Team übermittelt und erscheint
                    aktuell nicht automatisch auf dem TV/Admin-Dashboard.
                  </div>
                  <div className="text-stone-400">
                    Wir melden uns bei Rückfragen telefonisch.
                  </div>
                </>
              ) : (
                <>
                  <div>
                    {confirm.plannedTime ? (
                      <>
                        {plannedConfirmationLabel(confirm.mode || orderMode)}:{" "}
                        <b>{confirm.plannedTime} Uhr</b>
                      </>
                    ) : (
                      <>
                        {plannedEtaLabel(confirm.mode || orderMode)}:{" "}
                        <b>
                          {confirm.etaMin ??
                            ((confirm.mode || orderMode) === "pickup" ? avgPickupMinutes : avgDeliveryMinutes)}{" "}
                          Min
                        </b>
                      </>
                    )}
                  </div>
                  {confirm.trackingToken ? (
                    <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-200">
                      Ihre Bestellnummer wurde unten automatisch in die
                      Bestellverfolgung übernommen.
                    </div>
                  ) : (
                    <div className="text-stone-400">
                      Bitte notieren Sie diese Bestellnummer.
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {confirm.trackingToken && !confirm.emergencyMode && (
                <button
                  type="button"
                  className="card-cta"
                  onClick={() => {
                    window.location.href = `/track/${encodeURIComponent(confirm.trackingToken || "")}`;
                  }}
                >
                  Bestellung verfolgen
                </button>
              )}

              <button
                type="button"
                className="card-cta"
                onClick={() => {
                  clear();
                  setShowConfirm(false);
                  window.location.assign("/menu");
                }}
              >
                Zum Menü
              </button>

              <button
                type="button"
                className="btn-ghost ml-auto"
                onClick={() => setShowConfirm(false)}
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}

      {drawer && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-stone-700/60 bg-stone-950/95">
          <div className="mx-auto flex max-h-[80svh] max-w-5xl flex-col p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-lg font-medium">
                {drawer === "drink" && "Getränke"}
                {drawer === "donut" && "Donuts"}
                {drawer === "sauce" && "Soßen"}
              </div>

              <button className="btn-ghost" onClick={() => setDrawer(null)}>
                Schließen
              </button>
            </div>

            {drawerList.length === 0 ? (
              <div className="flex-1 overflow-y-auto text-sm text-stone-400">
                Kein Artikel gefunden.
                <div className="mt-1 text-xs opacity-70">
                  Hinweis: Artikel-Kategorie/Tag prüfen.
                </div>
              </div>
            ) : (
              <div className="grid flex-1 grid-cols-1 gap-3 overflow-y-auto overscroll-contain sm:grid-cols-2 [WebkitOverflowScrolling:touch]">
                {drawerList.map((item) => (
                  <div
                    key={item.id || item.sku || item.name}
                    className="rounded-md border border-stone-700/60 p-3"
                  >
                    <div className="mb-2 font-medium">{item.name}</div>

                    {item.variants?.length ? (
                      <div className="space-y-2">
                        {item.variants.map((variant) => {
                          const key = `${item.id || item.sku}-${variant.id}`;
                          const qty = drawerSel[key] || 0;

                          return (
                            <div
                              key={key}
                              className="flex items-center justify-between gap-3"
                            >
                              <div className="text-sm">{variant.name}</div>

                              <div className="flex items-center gap-3">
                                <div className="text-sm opacity-80">{fmt(variant.price)}</div>

                                <div className="flex items-center gap-2">
                                  <button
                                    className="btn-ghost"
                                    onClick={() =>
                                      setDrawerSel((current) => ({
                                        ...current,
                                        [key]: Math.max(0, (current[key] || 0) - 1),
                                      }))
                                    }
                                  >
                                    −
                                  </button>

                                  <div className="w-6 text-center">{qty}</div>

                                  <button
                                    className="btn-ghost"
                                    onClick={() =>
                                      setDrawerSel((current) => ({
                                        ...current,
                                        [key]: (current[key] || 0) + 1,
                                      }))
                                    }
                                  >
                                    +
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex items-center justify-between">
                        <div className="text-sm opacity-80">{fmt(item.price || 0)}</div>

                        <div className="flex items-center gap-2">
                          <button
                            className="btn-ghost"
                            onClick={() =>
                              setDrawerSel((current) => {
                                const key = String(item.id || item.sku || item.name);

                                return {
                                  ...current,
                                  [key]: Math.max(0, (current[key] || 0) - 1),
                                };
                              })
                            }
                          >
                            −
                          </button>

                          <div className="w-6 text-center">
                            {drawerSel[String(item.id || item.sku || item.name)] || 0}
                          </div>

                          <button
                            className="btn-ghost"
                            onClick={() =>
                              setDrawerSel((current) => {
                                const key = String(item.id || item.sku || item.name);

                                return {
                                  ...current,
                                  [key]: (current[key] || 0) + 1,
                                };
                              })
                            }
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="mt-4 flex items-center justify-end gap-2 border-t border-stone-800/60 pt-2">
              <button className="btn-ghost" onClick={() => setDrawer(null)}>
                Abbrechen
              </button>

              <button
                className="card-cta"
                disabled={drawerCount === 0}
                onClick={applyDrawer}
              >
                Hinzufügen ({drawerCount}) • {fmt(drawerSum)}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );

  async function startStripeCheckout(
    method: "online" | "split_contactless",
  ) {
    try {
      const existingRecovery = readActivePaymentRecovery();
      if (existingRecovery) {
        setActivePaymentRecovery(existingRecovery);
        throw new Error(
          "Es gibt bereits eine offene Zahlung. Bitte zuerst auf ‚Zahlung fortsetzen‘ klicken oder die offene Zahlung verwerfen.",
        );
      }

      setSubmitBusy(true);
      const paymentRequestId = browserOpaqueToken();
      const recoveryToken = browserOpaqueToken();

      const orderBase = await buildCheckoutOrderDraft({
        method,
        status: "pending",
        testMode: false,
      });

      const shares =
        method === "split_contactless"
          ? splitShares.map((share) => ({
              index: share.index,
              label: share.label,
              baseAmountCents: share.baseAmountCents,
              serviceFeeCents: share.serviceFeeCents,
              amountCents: share.amountCents,
              items: share.items,
            }))
          : undefined;

      const response = await fetch("/api/payments/prepare", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          paymentKind: method,
          paymentRequestId,
          recoveryToken,
          order: orderBase,
          shares,
          rememberPayment:
            method === "online"
              ? paymentSettings.rememberPaymentMethods && rememberPaymentMethod
              : paymentSettings.rememberPaymentMethods,
          savedPaymentMethodId:
            method === "online" ? selectedSavedPaymentMethodId : "",
        }),
        cache: "no-store",
      });

      const raw: unknown = await response.json().catch(() => null);
      const payload = parsePaymentPrepareResponse(raw, recoveryToken);
      const destination =
        method === "split_contactless"
          ? payload.manageUrl || payload.url
          : payload.url;

      if (
        !response.ok ||
        !payload.ok ||
        !payload.paymentSessionId ||
        !isAllowedNavigationUrl(destination)
      ) {
        throw new Error(
          payload.message ||
            payload.error ||
            "Online-Zahlung konnte nicht gestartet werden.",
        );
      }

      const manageUrl = payload.manageUrl || destination;
      if (!isAllowedNavigationUrl(manageUrl)) {
        throw new Error("Ungültige Zahlungsadresse empfangen.");
      }

      const recovery: ActivePaymentRecovery = {
        paymentSessionId: payload.paymentSessionId,
        recoveryToken: payload.recoveryToken,
        manageUrl,
        paymentKind: method,
        expiresAt: payload.recoveryExpiresAt,
      };

      try {
        sessionStorage.setItem(
          "bb_active_payment_session",
          recovery.paymentSessionId,
        );
        localStorage.setItem(
          ACTIVE_PAYMENT_RECOVERY_KEY,
          JSON.stringify(recovery),
        );
      } catch (error: unknown) {
        reportCheckoutError("payment-recovery-storage", error);
      }
      setActivePaymentRecovery(recovery);

      if (payload.pricingAdjustment?.payableChanged && payload.canonicalPricing) {
        showCheckoutToast(
          `Der Gesamtbetrag wurde sicher auf ${fmt(
            payload.canonicalPricing.total,
          )} aktualisiert.`,
          "info",
        );
        await sleep(650);
      }

      window.location.assign(destination);
    } catch (error: unknown) {
      reportCheckoutError("stripe-start", error);
      showCheckoutToast(
        errorMessage(
          error,
          "Online-Zahlung konnte nicht gestartet werden. Bitte erneut versuchen.",
        ),
        "error",
      );
      setSubmitBusy(false);
    }
  }

  async function submitOrderWithPayment(payment: {
    method: PaymentMethod;
    status: "pending" | "paid" | "failed";
    testMode: boolean;
  }) {
    try {
      const existingRecovery = readActivePaymentRecovery();
      if (existingRecovery) {
        setActivePaymentRecovery(existingRecovery);
        throw new Error(
          "Bitte zuerst die offene Zahlung fortsetzen oder stornieren.",
        );
      }

      setSubmitBusy(true);

      const orderBase = await buildCheckoutOrderDraft(payment);
      const result = await createOrderWithRetryAndEmergency(orderBase);
      if (result.pricingAdjustment?.payableChanged && result.canonicalPricing) {
        showCheckoutToast(
          `Der Gesamtbetrag wurde sicher auf ${fmt(
            result.canonicalPricing.total,
          )} aktualisiert.`,
          "info",
        );
      }
      const emergencyMode = Boolean(result?.emergencyMode);
      const etaMin = emergencyMode
        ? undefined
        : Math.max(
            1,
            toNum(
              result?.etaMin,
              orderMode === "pickup" ? avgPickupMinutes : avgDeliveryMinutes,
            ),
          );
      const id = result?.id || String(Date.now());
      const trackingToken = String(result?.trackingToken || "").trim();

      if (!emergencyMode && trackingToken) {
        rememberLastDeliveryTrackId(trackingToken, id);
      }

      if (activeCode) {
        clearActiveCoupon();
      }

      const confirmedPlannedTime = normalizePlannedHHMM(
        result?.planned ||
          (orderMode === "pickup" ? planned.timePickup : planned.timeDelivery),
      );

      setOrderRetryState(null);
      setConfirm({
        id,
        etaMin,
        emergencyMode,
        mode: orderMode,
        plannedTime: confirmedPlannedTime || null,
        trackingToken: trackingToken || undefined,
      });
      setSubmitted(true);
      setShowConfirm(true);
    } catch (error: unknown) {
      reportCheckoutError("order-submit", error);
      showCheckoutToast(
        errorMessage(
          error,
          "Es ist ein Fehler aufgetreten. Bitte erneut versuchen.",
        ),
        "error",
      );
    } finally {
      setOrderRetryState(null);
      setSubmitBusy(false);
    }
  }

  function mapCartToOrderItems(): CheckoutOrderItem[] {
    return items.map((cartItem) => {
      const addSum = (cartItem.add ?? []).reduce(
        (total, extra) => total + toNum(extra.price, 0),
        0,
      );

      return {
        id: cartItem.item.id || cartItem.id,
        sku: cartItem.item.sku || cartItem.item.id || cartItem.id,
        name: cartItem.item.name || "Artikel",
        description:
          cartItem.item.description || cartItem.item.desc || undefined,
        category: cartItem.item.category || undefined,
        price: toNum(cartItem.item.price, 0) + addSum,
        qty: toNum(cartItem.qty, 1),
        add: (cartItem.add ?? []).map((extra) => ({
          label: extra.label || extra.name,
          name: extra.name,
          price: toNum(extra.price, 0),
        })),
        note: cartItem.note != null ? String(cartItem.note) : undefined,
        rm: Array.isArray(cartItem.rm) ? cartItem.rm : undefined,
      };
    });
  }

  async function buildCheckoutOrderDraft(payment: {
    method: PaymentMethod;
    status: CheckoutPaymentStatus;
    testMode: boolean;
  }): Promise<CheckoutOrderDraft> {
    const ts = Date.now();
    const officialStreetForOrder =
      orderMode === "delivery"
        ? findOfficialStreet(streetOptions, addr.street || streetQuery)
        : "";
    const streetFinal =
      orderMode === "delivery"
        ? officialStreetForOrder
        : (addr.street || streetQuery || "").trim();

    if (orderMode === "delivery" && !officialStreetForOrder) {
      throw new Error("Bitte Straße aus der Liste auswählen.");
    }

    const plannedValue =
      orderMode === "pickup"
        ? plannedEnabledVirtual && normalizePlannedHHMM(planned.timePickup)
          ? normalizePlannedHHMM(planned.timePickup)
          : undefined
        : plannedEnabledVirtual && normalizePlannedHHMM(planned.timeDelivery)
          ? normalizePlannedHHMM(planned.timeDelivery)
          : undefined;

    if (activeCode) {
      try {
        await Coupons.syncCouponsFromServer();
      } catch (error: unknown) {
        reportCheckoutError("coupon-sync", error);
      }
    }

    const latestCoupon = computeCouponDiscount(
      activeCode,
      items,
      afterDiscount,
      (addr.phone || "").replace(/\D/g, "") || null,
    );

    if (activeCode && latestCoupon.error) {
      clearActiveCoupon();
      throw new Error(latestCoupon.error);
    }

    const latestCouponAmount = Math.min(
      afterDiscount,
      Math.max(0, latestCoupon.amount || 0),
    );

    const latestRouteDeal = findActiveRouteDealForCheckout({
      routeDeals: settingsRaw?.routeDeals,
      mode: orderMode,
      zip: addr.zip || plzStore || "",
      street: streetFinal,
      nowMs: ts,
    });

    const latestRouteDealBaseTotal = +((afterDiscount - latestCouponAmount) + surcharges).toFixed(2);
    const latestRouteDealBenefit = computeRouteDealBenefit({
      deal: latestRouteDeal,
      baseTotal: latestRouteDealBaseTotal,
      netMerchandise: +(afterDiscount - latestCouponAmount).toFixed(2),
      deliverySurcharges: surcharges,
      nowMs: ts,
    });
    const latestRouteDealDiscount = latestRouteDealBenefit.discountAmount;
    const latestPfand = computePfand(items).amount;
    const latestTotalFinal = roundToNearest10Cents(
      Math.max(0, latestRouteDealBaseTotal - latestRouteDealDiscount) + latestPfand,
    );
    const latestTipAmount = +Math.max(0, tipAmount).toFixed(2);
    const latestPayableTotal = roundToNearest10Cents(latestTotalFinal + latestTipAmount);

    const couponMeta = safeJsonParse(
      typeof window !== "undefined"
        ? localStorage.getItem(LS_ACTIVE_COUPON_META)
        : null,
    );

    const orderBase: CheckoutOrderDraft = {
      ts,
      mode: orderMode,
      source: "web",
      channel: "web",
      orderChannel: orderMode === "pickup" ? "abholung" : "lieferung",
      plz: orderMode === "delivery" ? addr.zip || null : null,
      items: attachPfandToOrderItems(
        mapCartToOrderItems(),
      ) as CheckoutOrderItem[],
      merchandise,
      discount: +(discount + latestRouteDealDiscount).toFixed(2),
      surcharges: +(surcharges + latestPfand).toFixed(2),
      total: latestPayableTotal,
      coupon: activeCode || undefined,
      couponDiscount: latestCouponAmount || 0,
      orderNote: (addr.note || "").trim() ? (addr.note || "").trim() : undefined,
      customer: {
        name: addr.name,
        phone: addr.phone,
        ...(orderMode === "delivery"
          ? {
              deliveryHint: (addr.note || "").trim() || undefined,
            }
          : {}),
        address:
          orderMode === "delivery"
            ? [
                `${streetFinal} ${addr.house}`.trim(),
                `${addr.zip} ${addr.city}`.trim(),
                [addr.floor, addr.entrance].filter(Boolean).join(" • "),
              ]
                .filter(Boolean)
                .join(" | ")
            : addr.note || undefined,
        street: streetFinal || undefined,
        house: addr.house || undefined,
        zip: addr.zip || undefined,
        plz: addr.zip || undefined,
        city: addr.city || undefined,
        floor: addr.floor || undefined,
        entrance: addr.entrance || undefined,
        email: addr.email || undefined,
        emailOptIn: !!addr.emailOptIn,
      },
      planned: plannedValue,
      meta: {
        coupon: activeCode || null,
        couponMeta: couponMeta || null,
        conditionalCampaign: base?.conditionalCampaign?.hasCampaign
          ? {
              id: base.conditionalCampaign.campaign?.id || null,
              name: base.conditionalCampaign.campaignName,
              percent: base.conditionalCampaign.percent,
              eligible: base.conditionalCampaign.eligible,
              minNetTotal: base.conditionalCampaign.minNetTotal,
              discountAmount: base.conditionalCampaign.discountAmount,
              overridesStandardDiscount:
                base.conditionalCampaign.overridesStandardDiscount,
            }
          : null,
        emailOptIn: !!addr.emailOptIn,
        payment: {
          method: payment.method,
          status: payment.status,
          provider: payment.method === "cash" ? "manual" : "stripe_checkout",
          testMode: payment.testMode,
          tip: latestTipAmount,
          baseTotal: latestTotalFinal,
          payableTotal: latestPayableTotal,
        },
        routeDeal: latestRouteDealBenefit.applied
          ? {
              id: latestRouteDeal?.id || null,
              ruleId: latestRouteDeal?.ruleId || null,
              name: latestRouteDeal?.name || "Nachbarschafts-Deal",
              plz: latestRouteDeal?.plz || addr.zip || null,
              street: latestRouteDeal?.street || streetFinal || null,
              reward: latestRouteDeal?.reward || null,
              label: latestRouteDealBenefit.label,
              discountAmount: latestRouteDealDiscount,
              rewardType: latestRouteDealBenefit.rewardType,
              baseTotal: latestRouteDealBaseTotal,
              finalTotal: latestTotalFinal,
              expiresAt: latestRouteDeal?.expiresAt || null,
            }
          : null,
        routeDealDiscount: latestRouteDealDiscount,
        tip: latestTipAmount,
        pfand: {
          amount: latestPfand,
          lines: computePfand(items).lines,
          excludedFromDiscounts: true,
        },
        couponLifecycle: activeCode
          ? {
              code: activeCode,
              state: "reserved",
              reservedAt: ts,
              source: "checkout",
            }
          : null,
      },
    };

    return orderBase;
  }


  async function createOrderWithRetryAndEmergency(
    orderBase: CheckoutOrderDraft,
  ): Promise<OrderCreateResult> {
    const startedAt = Date.now();
    let attempt = 1;
    let lastError: unknown = null;

    const parseOrderCreateResponse = async (
      response: Response,
    ): Promise<OrderCreateResult> => {
      const raw: unknown = await response.json().catch(() => null);
      const created = parseOrderCreateEnvelope(raw);

      if (!response.ok || !created.ok) {
        reportCheckoutError("order-create-response", {
          status: response.status,
          payload: created,
        });

        if (created.couponError) {
          clearActiveCoupon();
          const couponError = new Error(
            created.message || created.error || "COUPON_ERROR",
          ) as Error & { couponError: true };
          couponError.couponError = true;
          throw couponError;
        }

        throw new Error(
          created.message || created.error || "ORDER_CREATE_FAILED",
        );
      }

      const order = created.order ?? {};
      const data = created.data ?? {};
      const orderMeta = recordValue(order.meta);
      const dataMeta = recordValue(data.meta);
      const id =
        created.orderId ||
        created.id ||
        stringValue(order.id) ||
        stringValue(data.id) ||
        String(Date.now());
      const etaMin = toNum(
        created.etaMin ?? order.etaMin ?? data.etaMin,
        orderMode === "pickup" ? avgPickupMinutes : avgDeliveryMinutes,
      );
      const plannedFromResponse = normalizePlannedHHMM(
        created.planned ?? order.planned ?? data.planned,
      );
      const trackingToken = String(
        created.trackingToken ??
          order.trackingToken ??
          data.trackingToken ??
          orderMeta.trackingToken ??
          dataMeta.trackingToken ??
          "",
      ).trim();

      return {
        id,
        etaMin,
        planned: plannedFromResponse,
        trackingToken,
        emergencyMode: created.emergencyMode === true,
        pricingAdjusted: created.pricingAdjusted === true,
        pricingAdjustment: created.pricingAdjustment,
        canonicalPricing: created.canonicalPricing,
      };
    };

    while (Date.now() - startedAt < ORDER_RETRY_TOTAL_MS) {
      try {
        const response = await fetch("/api/orders/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            order: orderBase,
            notify: true,
          }),
          keepalive: true,
        });

        return await parseOrderCreateResponse(response);
      } catch (error: unknown) {
        if (
          error instanceof Error &&
          "couponError" in error &&
          error.couponError === true
        ) {
          throw error;
        }

        lastError = error;
        const elapsed = Date.now() - startedAt;
        const remaining = ORDER_RETRY_TOTAL_MS - elapsed;

        if (remaining <= 0) break;

        const waitMs = Math.min(ORDER_RETRY_INTERVAL_MS, remaining);

        setOrderRetryState({
          attempt,
          elapsedSec: Math.max(1, Math.round(elapsed / 1000)),
          nextRetryInSec: Math.max(1, Math.ceil(waitMs / 1000)),
        });

        await sleep(waitMs);
        attempt += 1;
      }
    }

    setOrderRetryState({
      attempt,
      elapsedSec: Math.round((Date.now() - startedAt) / 1000),
      nextRetryInSec: 0,
      emergencySending: true,
    });

    const emergencyResponse = await fetch("/api/orders/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        order: {
          ...orderBase,
          meta: {
            ...(orderBase?.meta || {}),
            emergencyMode: true,
            emergencyStartedAt: new Date(startedAt).toISOString(),
            emergencySubmittedAt: new Date().toISOString(),
            emergencyLastError: errorMessage(lastError, "unknown"),
          },
        },
        notify: true,
        emergencyMode: true,
        emergencyReason: "DB bağlantısı 5 dakika boyunca kurulamadı.",
        emergencyWaitMs: ORDER_RETRY_TOTAL_MS,
      }),
      keepalive: true,
    });

    return await parseOrderCreateResponse(emergencyResponse);
  }
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="block text-sm">
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-stone-300/80"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function FieldGroup({
  legend,
  children,
}: {
  legend: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="block min-w-0 text-sm">
      <legend className="mb-1 block text-stone-300/80">{legend}</legend>
      {children}
    </fieldset>
  );
}
