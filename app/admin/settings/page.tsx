// app/admin/settings/page.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { WeekSchedule, TimeRange } from "@/lib/settings";
import { LS_SETTINGS } from "@/lib/settings";

/* ───────────────────────── constants ───────────────────────── */

const CATS = [
  "burger",
  "vegan",
  "extras",
  "sauces",
  "drinks",
  "hotdogs",
  "donuts",
  "bubbleTea",
] as const;

const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

const DAY_LABELS: Record<(typeof DAY_KEYS)[number], string> = {
  mon: "Montag",
  tue: "Dienstag",
  thu: "Donnerstag",
  wed: "Mittwoch",
  fri: "Freitag",
  sat: "Samstag",
  sun: "Sonntag",
};

const DAY_ABBR: Record<
  (typeof DAY_KEYS)[number],
  "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun"
> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

type PlanEntry = {
  day: string;
  open: string;
  close: string;
};

type SettingsModel = Record<string, any>;

type SettingsSource = "db" | "cache_fallback" | "local_fallback" | "default_fallback" | "error";

const DEFAULT_MODEL: SettingsModel = {
  site: {
    closed: false,
    message: "",
    maintenanceStart: "",
    maintenanceEnd: "",
  },

  validation: {
    phoneDigits: 11,
    nameCapitalizeFirst: true,
  },

  orders: {
    idLength: 6,
  },

  hours: {
    tz: "Europe/Berlin",
    timezone: "Europe/Berlin",
    slotMinutes: 15,
    slotMinutesDelivery: 15,
    slotMinutesPickup: 15,
    daysAhead: 2,
    allowPreorder: true,
    avgPickupMinutes: 15,
    avgDeliveryMinutes: 35,
    plan: {
      pickup: [],
      delivery: [],
    },
    pickup: {},
    delivery: {},
  },

  delivery: {
    discountRate: 0,
    surcharges: {},
    minOrderAfterDiscountByPLZ: {},
  },

  pickup: {
    discountRate: 0,
  },

  discount: {
    lifaRate: 0,
    apollonRate: 0,
  },

  discounts: {
    deliveryPercent: 0,
    pickupPercent: 0,
    lifaPercent: 0,
    apolloPercent: 0,
  },

  pricingOverrides: {
    plzMin: {},
  },

  surcharges: {},

  freebies: {
    enabled: false,
    category: "sauces",
    mode: "both",
    tiers: [],
  },

  offers: {
    freebies: {
      enabled: false,
      category: "sauces",
      mode: "both",
      tiers: [],
    },
  },

  theme: {
    active: "classic",
    bgVideoUrl: "",
    logos: {
      classic: "",
      neon: "",
      christmas: "",
      halloween: "",
    },
    snow: false,
  },

  printing: {
    logoUrl: "/logo.png",
    footerNote: "Vielen Dank!",
    footerHinweise: "Vielen Dank!",
    paper: "80mm",
    showBarcode: true,
    showQR: true,
    groupingOrder: ["burger", "vegan", "hotdogs", "extras", "drinks", "sauces"],
  },

  colors: {
    statusColors: {
      eingegangen: "#38bdf8",
      zubereitung: "#f59e0b",
      abholbereit: "#10b981",
      unterwegs: "#22d3ee",
      abgeschlossen: "#9ca3af",
      storniert: "#ef4444",
    },
    modeColors: {
      pickup: "#60a5fa",
      delivery: "#a78bfa",
    },
  },

  statusColors: {
    new: "#38bdf8",
    preparing: "#f59e0b",
    ready: "#10b981",
    out_for_delivery: "#22d3ee",
    done: "#9ca3af",
    cancelled: "#ef4444",
  },

  dashboard: {
    password: "",
    pollSeconds: 3,
    targets: {
      deliveryMins: 30,
      pickupMins: 15,
    },
    sound: {
      newOrder: "",
    },
  },

  announcements: {
    enabled: false,
    items: [],
  },

  routeDeals: {
    enabled: false,
    maxActiveDeals: 2,
    defaultDurationMinutes: 12,
    rules: [],
    active: [],
  },

  features: {
    bubbleTea: {
      enabled: false,
    },
    donuts: {
      enabled: false,
    },
    payments: {
      cashPayment: true,
      onlinePayment: false,
      contactlessPayment: false,
      splitPayment: false,
    },
    cashPayment: {
      enabled: true,
    },
    onlinePayment: {
      enabled: false,
    },
    contactlessPayment: {
      enabled: false,
    },
    splitPayment: {
      enabled: false,
    },
    liveTracking: {
      enabled: true,
    },
    tracking: {
      enabled: true,
      showEtaClock: true,
    },
  },

  payments: {
    cash: {
      enabled: true,
    },
    online: {
      enabled: false,
    },
    contactless: {
      enabled: false,
    },
    split: {
      enabled: false,
    },
  },

  tracking: {
    enabled: true,
    showEtaClock: true,
  },

  telegram: {
    enabled: false,
    botToken: "",
    chatId: "",
  },

  contact: {
    phone: "",
    email: "",
    address: "",
    whatsapp: "",
    whatsappNumber: "",
    instagram: "",
    tiktok: "",
    facebook: "",
    mapsUrl: "",
    reviewsUrl: "",
  },
};

/* ───────────────────────── generic helpers ───────────────────────── */

function isPlainObject(value: any): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeKey(key: string) {
  if (!key) return false;
  if (key === "__proto__") return false;
  if (key === "prototype") return false;
  if (key === "constructor") return false;
  return true;
}

function deepMerge<T = any>(base: T, override: any): T {
  if (override === undefined) return base;

  if (Array.isArray(base) || Array.isArray(override)) {
    return override as T;
  }

  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override as T;
  }

  const result: Record<string, any> = { ...base };

  for (const [key, value] of Object.entries(override)) {
    if (isPlainObject(result[key]) && isPlainObject(value)) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}

function num(value: any, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function bool(value: any, fallback = false) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return fallback;

  const s = String(value).toLowerCase().trim();
  if (["1", "true", "yes", "ja", "on"].includes(s)) return true;
  if (["0", "false", "no", "nein", "off"].includes(s)) return false;

  return fallback;
}

function safeIso(value: any) {
  if (!value) return "";

  const d = new Date(value);
  return Number.isFinite(d.valueOf()) ? d.toISOString() : "";
}

function safeStringify(value: any) {
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function cleanList(value: any): string[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[;,\n]/g)
      : [];

  return Array.from(
    new Set(
      list
        .map((item) => String(item ?? "").trim())
        .filter(Boolean)
    )
  );
}

function listToText(value: any) {
  return cleanList(value).join("\n");
}

function rewardLabel(type: string) {
  switch (type) {
    case "fixed":
      return "Sabit indirim";
    case "free_delivery":
      return "Teslimat ücreti bedava";
    case "free_sauce":
      return "Bedava sos";
    case "free_drink":
      return "Bedava içecek";
    case "percent":
    default:
      return "Yüzde indirim";
  }
}

const RESPONSE_META_KEYS = new Set([
  "ok",
  "source",
  "tenant",
  "count",
  "counts",
  "saved",
  "keys",
  "error",
  "message",
  "dbError",
  "fallbackSaved",
  "createdAt",
  "updatedAt",
]);

function stripResponseMetadata(raw: any) {
  const source =
    isPlainObject(raw?.settings)
      ? raw.settings
      : isPlainObject(raw?.data)
        ? raw.data
        : raw;

  if (!isPlainObject(source)) return source || {};

  const out: Record<string, any> = {};

  for (const [key, value] of Object.entries(source)) {
    if (!isSafeKey(key)) continue;
    if (RESPONSE_META_KEYS.has(key)) continue;
    out[key] = value;
  }

  return out;
}

function pickSavedSettingsFromResponse(response: any, fallback: any) {
  const stripped = stripResponseMetadata(response);

  if (isPlainObject(stripped) && Object.keys(stripped).length > 0) {
    return normalizeForSave(stripped);
  }

  return normalizeForSave(fallback || {});
}

function dispatchSettingsChanged(next: any) {
  try {
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: LS_SETTINGS,
        newValue: safeStringify(next),
        storageArea: window.localStorage,
      })
    );
  } catch {
    try {
      window.dispatchEvent(new Event("storage"));
    } catch {}
  }

  try {
    window.dispatchEvent(new CustomEvent("bb_settings_changed", { detail: next }));
    window.dispatchEvent(new CustomEvent("bb:settings-sync", { detail: next }));
  } catch {}
}

function mirrorSettingsToLocalStorage(next: any) {
  try {
    localStorage.setItem(LS_SETTINGS, safeStringify(next));
    dispatchSettingsChanged(next);
  } catch {}
}

/* ───────────────────── helper: hours plan <-> week ───────────────────── */

function dayKeyFromPlanDay(day: string): Array<(typeof DAY_KEYS)[number]> {
  const raw = String(day || "").trim();

  if (!raw) return [];

  if (raw.includes("-")) {
    return [...DAY_KEYS];
  }

  const found = Object.entries(DAY_ABBR).find(([, abbr]) => abbr === raw);
  return found ? [found[0] as (typeof DAY_KEYS)[number]] : [];
}

function toWeekScheduleFromPlan(plan?: {
  pickup?: PlanEntry[];
  delivery?: PlanEntry[];
}): {
  pickup?: WeekSchedule;
  delivery?: WeekSchedule;
} {
  if (!plan) return {};

  const parse = (arr?: PlanEntry[]) => {
    const ws: WeekSchedule = {};
    if (!Array.isArray(arr)) return ws;

    arr.forEach((entry) => {
      const dayKeys = dayKeyFromPlanDay(entry.day);

      dayKeys.forEach((dayKey) => {
        const list = ws[dayKey] || [];
        list.push({ start: entry.open, end: entry.close });
        ws[dayKey] = list;
      });
    });

    return ws;
  };

  return {
    pickup: parse(plan.pickup),
    delivery: parse(plan.delivery),
  };
}

function toPlanFromWeekSchedule(week?: {
  pickup?: WeekSchedule;
  delivery?: WeekSchedule;
}) {
  const build = (ws?: WeekSchedule): PlanEntry[] => {
    if (!ws) return [];

    const out: PlanEntry[] = [];

    DAY_KEYS.forEach((dayKey) => {
      const ranges = ws[dayKey] || [];
      ranges.forEach((range) => {
        out.push({
          day: DAY_ABBR[dayKey],
          open: range.start,
          close: range.end,
        });
      });
    });

    return out;
  };

  return {
    pickup: build(week?.pickup),
    delivery: build(week?.delivery),
  };
}

/* ─────────────── normalize & defaults ─────────────── */

function normalizeForSave(raw: any) {
  const m = deepMerge(DEFAULT_MODEL, raw || {});
  const next: any = { ...m };

  next.validation = {
    ...(next.validation || {}),
    phoneDigits: num(next.validation?.phoneDigits, 11),
    nameCapitalizeFirst: bool(next.validation?.nameCapitalizeFirst, true),
  };

  next.orders = {
    ...(next.orders || {}),
    idLength: Math.min(Math.max(num(next.orders?.idLength, 6), 4), 12),
  };

  const tz = next.hours?.tz || next.hours?.timezone || "Europe/Berlin";

  const week: {
    pickup?: WeekSchedule;
    delivery?: WeekSchedule;
  } = {
    pickup: next.hours?.pickup,
    delivery: next.hours?.delivery,
  };

  const plan = next.hours?.plan || toPlanFromWeekSchedule(week);

  const deliverySlot = Math.max(
    1,
    num(next.hours?.slotMinutesDelivery ?? next.hours?.slotMinutes, 15)
  );

  const pickupSlot = Math.max(
    1,
    num(next.hours?.slotMinutesPickup ?? next.hours?.slotMinutes, 15)
  );

  next.hours = {
    ...(next.hours || {}),
    tz,
    timezone: tz,
    slotMinutes: deliverySlot,
    slotMinutesDelivery: deliverySlot,
    slotMinutesPickup: pickupSlot,
    daysAhead: Math.max(0, num(next.hours?.daysAhead, 2)),
    allowPreorder: bool(next.hours?.allowPreorder, true),
    avgPickupMinutes: Math.max(1, num(next.hours?.avgPickupMinutes, 15)),
    avgDeliveryMinutes: Math.max(1, num(next.hours?.avgDeliveryMinutes, 35)),
    forceClosed: bool(next.hours?.forceClosed, false),
    plan,
    pickup: week.pickup || {},
    delivery: week.delivery || {},
  };

  const deliveryDiscountRate = num(
    next.delivery?.discountRate ??
      next.discount?.lifaRate ??
      next.discounts?.deliveryPercent ??
      next.discounts?.lifaPercent,
    0
  );

  const pickupDiscountRate = num(
    next.pickup?.discountRate ??
      next.discount?.apollonRate ??
      next.discounts?.pickupPercent ??
      next.discounts?.apolloPercent,
    0
  );

  const deliverySurcharges = {
    ...(next.delivery?.surcharges || next.surcharges || {}),
  };

  const plzMin = {
    ...(next.delivery?.minOrderAfterDiscountByPLZ ||
      next.pricingOverrides?.plzMin ||
      {}),
  };

  next.delivery = {
    ...(next.delivery || {}),
    discountRate: deliveryDiscountRate,
    surcharges: deliverySurcharges,
    minOrderAfterDiscountByPLZ: plzMin,
  };

  next.pickup = {
    ...(next.pickup || {}),
    discountRate: pickupDiscountRate,
  };

  next.discount = {
    ...(next.discount || {}),
    lifaRate: deliveryDiscountRate,
    apollonRate: pickupDiscountRate,
  };

  next.discounts = {
    ...(next.discounts || {}),
    deliveryPercent: deliveryDiscountRate,
    pickupPercent: pickupDiscountRate,
    lifaPercent: deliveryDiscountRate,
    apolloPercent: pickupDiscountRate,
  };

  next.surcharges = deliverySurcharges;

  next.pricingOverrides = {
    ...(next.pricingOverrides || {}),
    plzMin,
  };

  const footerNote =
    next.printing?.footerNote ??
    next.printing?.footerHinweise ??
    "Vielen Dank!";

  next.printing = {
    ...(next.printing || {}),
    logoUrl: next.printing?.logoUrl ?? "/logo.png",
    footerNote,
    footerHinweise: footerNote,
    paper: next.printing?.paper ?? "80mm",
    showBarcode: next.printing?.showBarcode !== false,
    showQR: next.printing?.showQR !== false,
    groupingOrder:
      Array.isArray(next.printing?.groupingOrder) && next.printing.groupingOrder.length
        ? next.printing.groupingOrder
        : ["burger", "vegan", "hotdogs", "extras", "drinks", "sauces"],
  };

  next.colors = {
    ...(next.colors || {}),
    statusColors: {
      eingegangen: next.colors?.statusColors?.eingegangen ?? "#38bdf8",
      zubereitung: next.colors?.statusColors?.zubereitung ?? "#f59e0b",
      abholbereit: next.colors?.statusColors?.abholbereit ?? "#10b981",
      unterwegs: next.colors?.statusColors?.unterwegs ?? "#22d3ee",
      abgeschlossen: next.colors?.statusColors?.abgeschlossen ?? "#9ca3af",
      storniert: next.colors?.statusColors?.storniert ?? "#ef4444",
    },
    modeColors: {
      pickup: next.colors?.modeColors?.pickup ?? "#60a5fa",
      delivery: next.colors?.modeColors?.delivery ?? "#a78bfa",
    },
  };

  next.statusColors = {
    ...(next.statusColors || {}),
    new: next.statusColors?.new ?? next.colors.statusColors.eingegangen,
    preparing: next.statusColors?.preparing ?? next.colors.statusColors.zubereitung,
    ready: next.statusColors?.ready ?? next.colors.statusColors.abholbereit,
    out_for_delivery:
      next.statusColors?.out_for_delivery ?? next.colors.statusColors.unterwegs,
    done: next.statusColors?.done ?? next.colors.statusColors.abgeschlossen,
    cancelled: next.statusColors?.cancelled ?? next.colors.statusColors.storniert,
  };

  next.announcements = {
    ...(next.announcements || {}),
    enabled: bool(next.announcements?.enabled, false),
    items: Array.isArray(next.announcements?.items)
      ? next.announcements.items.map((item: any) => ({
          title: item?.title || "",
          text: item?.text || "",
          imageUrl: item?.imageUrl || "",
          ctaLabel: item?.ctaLabel || "",
          ctaHref: item?.ctaHref || "",
          enabled: item?.enabled !== false,
          startsAt: item?.startsAt ? safeIso(item.startsAt) : "",
          endsAt: item?.endsAt ? safeIso(item.endsAt) : "",
        }))
      : [],
  };

  next.routeDeals = {
    ...(next.routeDeals || {}),
    enabled: bool(next.routeDeals?.enabled, false),
    maxActiveDeals: Math.min(
      5,
      Math.max(1, num(next.routeDeals?.maxActiveDeals, 2))
    ),
    defaultDurationMinutes: Math.min(
      60,
      Math.max(1, num(next.routeDeals?.defaultDurationMinutes, 12))
    ),
    rules: Array.isArray(next.routeDeals?.rules)
      ? next.routeDeals.rules.map((rule: any, index: number) => {
          const rewardType = [
            "percent",
            "fixed",
            "free_delivery",
            "free_sauce",
            "free_drink",
          ].includes(String(rule?.reward?.type || rule?.type))
            ? String(rule?.reward?.type || rule?.type)
            : "percent";

          return {
            ...rule,
            id: String(rule?.id || `route-deal-${index + 1}`).trim(),
            name: String(rule?.name || "Nachbarschafts-Deal").trim(),
            enabled: rule?.enabled !== false,
            plz: cleanList(rule?.plz || rule?.plzList || rule?.postalCodes),
            streets: cleanList(rule?.streets || rule?.streetList),
            durationMinutes: Math.min(
              60,
              Math.max(
                1,
                num(
                  rule?.durationMinutes,
                  next.routeDeals?.defaultDurationMinutes || 12
                )
              )
            ),
            minTotal: Math.max(0, num(rule?.minTotal ?? rule?.minimumTotal, 0)),
            reward: {
              ...(rule?.reward || {}),
              type: rewardType,
              percent: Math.min(
                100,
                Math.max(0, num(rule?.reward?.percent ?? rule?.percent ?? 15))
              ),
              amount: Math.max(
                0,
                num(rule?.reward?.amount ?? rule?.amount ?? 0)
              ),
              maxDiscount: Math.max(
                0,
                num(rule?.reward?.maxDiscount ?? rule?.maxDiscount ?? 0)
              ),
              freeItemName: String(
                rule?.reward?.freeItemName || rule?.freeItemName || ""
              ).trim(),
              freeItemCategory: String(
                rule?.reward?.freeItemCategory ||
                  rule?.freeItemCategory ||
                  (rewardType === "free_drink" ? "drinks" : "sauces")
              ).trim(),
            },
            message: String(
              rule?.message ||
                "Unser Fahrer ist gleich in Ihrer Nähe. Bestellen Sie jetzt und sichern Sie sich Ihr Nachbarschafts-Angebot."
            ).trim(),
            priority: num(rule?.priority, index),
          };
        })
      : [],
    active: Array.isArray(next.routeDeals?.active)
      ? next.routeDeals.active.map((deal: any, index: number) => ({
          ...deal,
          id: String(deal?.id || `active-route-deal-${index + 1}`).trim(),
          ruleId: String(deal?.ruleId || "").trim(),
          name: String(deal?.name || "Nachbarschafts-Deal").trim(),
          plz: String(deal?.plz || "").trim(),
          street: String(deal?.street || "").trim(),
          orderId: String(deal?.orderId || "").trim(),
          startedAt: deal?.startedAt ? safeIso(deal.startedAt) : "",
          expiresAt: deal?.expiresAt ? safeIso(deal.expiresAt) : "",
          durationMinutes: Math.min(
            60,
            Math.max(1, num(deal?.durationMinutes, 12))
          ),
          minTotal: Math.max(0, num(deal?.minTotal, 0)),
          reward: {
            ...(deal?.reward || {}),
            type: [
              "percent",
              "fixed",
              "free_delivery",
              "free_sauce",
              "free_drink",
            ].includes(String(deal?.reward?.type))
              ? String(deal?.reward?.type)
              : "percent",
          },
          message: String(deal?.message || "").trim(),
        }))
      : [],
  };

  next.telegram = {
    ...(next.telegram || {}),
    enabled: bool(next.telegram?.enabled, false),
    botToken: next.telegram?.botToken || "",
    chatId: next.telegram?.chatId || "",
  };

  const whatsapp =
    next.contact?.whatsapp ??
    next.contact?.whatsappNumber ??
    "";

  next.contact = {
    ...(next.contact || {}),
    phone: next.contact?.phone || "",
    email: next.contact?.email || "",
    address: next.contact?.address || "",
    whatsapp,
    whatsappNumber: whatsapp,
    instagram: next.contact?.instagram || "",
    tiktok: next.contact?.tiktok || "",
    facebook: next.contact?.facebook || "",
    mapsUrl: next.contact?.mapsUrl || "",
    reviewsUrl: next.contact?.reviewsUrl || "",
  };

  const trackingEnabled = next.tracking?.enabled !== false;
  const showEtaClock = next.tracking?.showEtaClock !== false;

  const cashPaymentEnabled = bool(
    next.payments?.cash?.enabled ??
      next.features?.payments?.cashPayment ??
      next.features?.cashPayment?.enabled,
    true
  );

  const onlinePaymentEnabled = bool(
    next.payments?.online?.enabled ??
      next.features?.payments?.onlinePayment ??
      next.features?.onlinePayment?.enabled,
    false
  );

  const contactlessPaymentEnabled = bool(
    next.payments?.contactless?.enabled ??
      next.features?.payments?.contactlessPayment ??
      next.features?.contactlessPayment?.enabled,
    false
  );

  const splitPaymentEnabled = bool(
    next.payments?.split?.enabled ??
      next.features?.payments?.splitPayment ??
      next.features?.splitPayment?.enabled,
    false
  );

  next.payments = {
    ...(next.payments || {}),
    cash: {
      ...(next.payments?.cash || {}),
      enabled: cashPaymentEnabled,
    },
    online: {
      ...(next.payments?.online || {}),
      enabled: onlinePaymentEnabled,
    },
    contactless: {
      ...(next.payments?.contactless || {}),
      enabled: contactlessPaymentEnabled,
    },
    split: {
      ...(next.payments?.split || {}),
      enabled: splitPaymentEnabled,
    },
  };

  next.features = {
    ...(next.features || {}),
    bubbleTea: {
      ...(next.features?.bubbleTea || {}),
      enabled: bool(next.features?.bubbleTea?.enabled, false),
    },
    donuts: {
      ...(next.features?.donuts || {}),
      enabled: bool(next.features?.donuts?.enabled, false),
    },
    payments: {
      ...(next.features?.payments || {}),
      cashPayment: cashPaymentEnabled,
      onlinePayment: onlinePaymentEnabled,
      contactlessPayment: contactlessPaymentEnabled,
      splitPayment: splitPaymentEnabled,
    },
    cashPayment: {
      ...(next.features?.cashPayment || {}),
      enabled: cashPaymentEnabled,
    },
    onlinePayment: {
      ...(next.features?.onlinePayment || {}),
      enabled: onlinePaymentEnabled,
    },
    contactlessPayment: {
      ...(next.features?.contactlessPayment || {}),
      enabled: contactlessPaymentEnabled,
    },
    splitPayment: {
      ...(next.features?.splitPayment || {}),
      enabled: splitPaymentEnabled,
    },
    liveTracking: {
      ...(next.features?.liveTracking || {}),
      enabled: trackingEnabled,
    },
    tracking: {
      ...(next.features?.tracking || {}),
      enabled: trackingEnabled,
      showEtaClock,
    },
  };

  next.tracking = {
    ...(next.tracking || {}),
    enabled: trackingEnabled,
    showEtaClock,
  };

  next.freebies = {
    ...(next.freebies || next.offers?.freebies || {}),
    enabled: bool(next.freebies?.enabled ?? next.offers?.freebies?.enabled, false),
    category: next.freebies?.category || next.offers?.freebies?.category || "sauces",
    mode: next.freebies?.mode || next.offers?.freebies?.mode || "both",
    tiers: Array.isArray(next.freebies?.tiers)
      ? next.freebies.tiers
      : Array.isArray(next.offers?.freebies?.tiers)
        ? next.offers.freebies.tiers
        : [],
  };

  next.offers = {
    ...(next.offers || {}),
    freebies: { ...next.freebies },
  };

  next.dashboard = {
    ...(next.dashboard || {}),
    password: String(next.dashboard?.password ?? ""),
    pollSeconds: Math.max(1, num(next.dashboard?.pollSeconds, 3)),
    targets: {
      deliveryMins: Math.max(1, num(next.dashboard?.targets?.deliveryMins, 30)),
      pickupMins: Math.max(1, num(next.dashboard?.targets?.pickupMins, 15)),
    },
    sound: {
      newOrder: String(next.dashboard?.sound?.newOrder ?? ""),
    },
  };

  next.site = {
    ...(next.site || {}),
    closed: bool(next.site?.closed, false),
    message: String(next.site?.message ?? ""),
    maintenanceStart: next.site?.maintenanceStart
      ? safeIso(next.site.maintenanceStart)
      : "",
    maintenanceEnd: next.site?.maintenanceEnd ? safeIso(next.site.maintenanceEnd) : "",
  };

  next.theme = {
    ...(next.theme || {}),
    active: next.theme?.active || "classic",
    bgVideoUrl: next.theme?.bgVideoUrl || "",
    logos: {
      ...(next.theme?.logos || {}),
      classic: next.theme?.logos?.classic || "",
      neon: next.theme?.logos?.neon || "",
      christmas: next.theme?.logos?.christmas || "",
      halloween: next.theme?.logos?.halloween || "",
    },
    snow: bool(next.theme?.snow, false),
  };

  return next;
}

/* ─────────────────────── DB-first autosave ─────────────────────── */

function useDebouncedAutosave(model: any, enabled: boolean, delay = 400) {
  const tRef = useRef<number | null>(null);
  const first = useRef(true);

  useEffect(() => {
    if (!enabled || model == null) return;

    if (first.current) {
      first.current = false;
      return;
    }

    if (tRef.current) {
      window.clearTimeout(tRef.current);
    }

    tRef.current = window.setTimeout(() => {
      (async () => {
        try {
          const next = normalizeForSave(model);

          const res = await fetch("/api/settings", {
            method: "POST",
            headers: { "Content-Type": "application/json", accept: "application/json" },
            body: safeStringify({ settings: next }),
          });

          const json = await res.json().catch(() => null);

          if (!res.ok || json?.ok === false) {
            console.error("Autosave /api/settings failed:", json?.error || res.status);
            return;
          }

          const saved = pickSavedSettingsFromResponse(json, next);
          mirrorSettingsToLocalStorage(saved);
        } catch (error) {
          console.error("Autosave failed:", error);
        }
      })();
    }, delay);

    return () => {
      if (tRef.current) {
        window.clearTimeout(tRef.current);
      }
    };
  }, [model, enabled, delay]);
}

/* ───────────────────────── UI helpers ───────────────────────── */

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-stone-300/90">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
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
    </label>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-stone-300/80">{label}</span>
      {children}
    </label>
  );
}

/* ───────────────────────── Page ───────────────────────── */

export default function AdminSettingsPage() {
  const [mounted, setMounted] = useState(false);
  const [model, setModel] = useState<any>(null);
  const [settingsSource, setSettingsSource] = useState<SettingsSource>("db");
  const [settingsDbError, setSettingsDbError] = useState("");

  const settingsReadOnly = settingsSource !== "db";

  useEffect(() => {
    let cancelled = false;
    setMounted(true);

    const init = async () => {
      try {
        const res = await fetch("/api/settings", {
          method: "GET",
          cache: "no-store",
          headers: {
            accept: "application/json",
          },
        });

        const data = await res.json().catch(() => ({} as any));

        if (!res.ok || data?.ok === false) {
          throw new Error(data?.error || `SETTINGS_${res.status}`);
        }

        const source =
          data?.source === "cache_fallback"
            ? "cache_fallback"
            : data?.source === "default_fallback"
              ? "default_fallback"
              : "db";

        if (!cancelled) {
          setSettingsSource(source);
          setSettingsDbError(String(data?.dbError || ""));
        }

        const rawSettings = stripResponseMetadata(data);
        const week = toWeekScheduleFromPlan(rawSettings?.hours?.plan);

        const initModel = normalizeForSave({
          ...rawSettings,
          hours: {
            ...(rawSettings?.hours || {}),
            pickup: rawSettings?.hours?.pickup || week.pickup,
            delivery: rawSettings?.hours?.delivery || week.delivery,
            tz:
              rawSettings?.hours?.tz ||
              rawSettings?.hours?.timezone ||
              "Europe/Berlin",
            timezone:
              rawSettings?.hours?.timezone ||
              rawSettings?.hours?.tz ||
              "Europe/Berlin",
          },
        });

        if (!cancelled) {
          setModel(initModel);
        }

        mirrorSettingsToLocalStorage(initModel);
      } catch (error) {
        console.warn("/api/settings GET failed, using safe local fallback:", error);

        try {
          const raw = localStorage.getItem(LS_SETTINGS);
          const parsed = raw ? JSON.parse(raw) : {};
          const week = toWeekScheduleFromPlan(parsed?.hours?.plan);

          const initModel = normalizeForSave({
            ...parsed,
            hours: {
              ...(parsed?.hours || {}),
              pickup: parsed?.hours?.pickup || week.pickup,
              delivery: parsed?.hours?.delivery || week.delivery,
              tz: parsed?.hours?.tz || parsed?.hours?.timezone || "Europe/Berlin",
              timezone:
                parsed?.hours?.timezone || parsed?.hours?.tz || "Europe/Berlin",
            },
          });

          if (!cancelled) {
            setSettingsSource("local_fallback");
            setSettingsDbError(error instanceof Error ? error.message : String(error || ""));
            setModel(initModel);
          }
        } catch {
          if (!cancelled) {
            setSettingsSource("default_fallback");
            setSettingsDbError(error instanceof Error ? error.message : String(error || ""));
            setModel(normalizeForSave({}));
          }
        }
      }
    };

    init();

    return () => {
      cancelled = true;
    };
  }, []);

  useDebouncedAutosave(model, mounted && model != null && !settingsReadOnly, 400);

  const setNested = (path: string[], value: any) =>
    setModel((current: any) => {
      const next = { ...(current || {}) };
      let cursor: any = next;

      for (let i = 0; i < path.length - 1; i += 1) {
        cursor[path[i]] = { ...(cursor[path[i]] || {}) };
        cursor = cursor[path[i]];
      }

      cursor[path[path.length - 1]] = value;
      return next;
    });

  const doExport = () => {
    const blob = new Blob([JSON.stringify(normalizeForSave(model), null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = "settings.json";
    link.click();

    URL.revokeObjectURL(url);
  };

  const doImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (settingsReadOnly) {
      event.target.value = "";
      alert("DB-Verbindung ist gestört. Einstellungen werden nur angezeigt und können erst gespeichert/importiert werden, wenn die Datenbank wieder erreichbar ist.");
      return;
    }

    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const normalized = normalizeForSave(stripResponseMetadata(parsed));

      event.target.value = "";

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: safeStringify({ settings: normalized }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `Status ${res.status}`);
      }

      const saved = pickSavedSettingsFromResponse(json, normalized);
      setModel(saved);
      mirrorSettingsToLocalStorage(saved);

      alert("Settings wurden importiert ✅");
    } catch (error: any) {
      event.target.value = "";
      alert("Import fehlgeschlagen: " + (error?.message || ""));
    }
  };

  const saveNow = async () => {
    if (settingsReadOnly) {
      alert("DB-Verbindung ist gestört. Letzte gespeicherte Einstellungen werden angezeigt. Speichern ist erst wieder möglich, wenn source=db ist.");
      return;
    }

    try {
      const next = normalizeForSave(model);

      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: safeStringify({ settings: next }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || json?.ok === false) {
        throw new Error(json?.error || `Status ${res.status}`);
      }

      const saved = pickSavedSettingsFromResponse(json, next);
      setModel(saved);
      mirrorSettingsToLocalStorage(saved);
      alert("Gespeichert ✅");
    } catch (error: any) {
      alert("Speichern fehlgeschlagen: " + (error?.message || ""));
    }
  };

  if (!mounted || model == null) {
    return (
      <main className="mx-auto max-w-6xl p-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold">Einstellungen</h1>
            <span className="text-sm text-stone-400">wird geladen…</span>
          </div>
          <div className="h-9 w-40 rounded-md bg-stone-800/50" />
        </div>
        <div className="grid gap-6">
          <div className="h-40 rounded-xl bg-stone-900/50" />
          <div className="h-72 rounded-xl bg-stone-900/50" />
          <div className="h-60 rounded-xl bg-stone-900/50" />
        </div>
      </main>
    );
  }

  const m = model as any;

  return (
    <main className="mx-auto max-w-6xl p-6">
      {/* HEADER */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-semibold">Einstellungen</h1>
          <Link href="/admin" className="text-sm text-stone-300 hover:text-stone-100">
            ← Admin
          </Link>
        </div>

        <div className="flex items-center gap-2">
          <button className="btn-ghost" onClick={doExport}>
            Export
          </button>
          <label
            className={`btn-ghost cursor-pointer ${
              settingsReadOnly ? "pointer-events-none opacity-50" : ""
            }`}
            title={settingsReadOnly ? "DB-Verbindung gestört – Import ist gesperrt." : undefined}
          >
            Import
            <input
              type="file"
              accept="application/json,.json"
              hidden
              disabled={settingsReadOnly}
              onChange={doImport}
            />
          </label>
          <button
            className={`pill ${settingsReadOnly ? "cursor-not-allowed opacity-50" : ""}`}
            onClick={saveNow}
            disabled={settingsReadOnly}
            title={settingsReadOnly ? "DB-Verbindung gestört – Speichern ist gesperrt." : undefined}
          >
            Speichern
          </button>
        </div>
      </div>

      {settingsReadOnly && (
        <div className="mb-5 rounded-xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <div className="font-semibold">
            DB-Verbindung vorübergehend gestört. Letzte gespeicherte Einstellungen werden angezeigt.
          </div>
          <div className="mt-1 text-amber-100/80">
            Quelle: {settingsSource}. Speichern und Import sind gesperrt, damit keine falschen Daten
            überschrieben werden. Sobald die DB wieder erreichbar ist, lädt die Seite automatisch wieder
            mit source=db nach einem Refresh.
            {settingsDbError ? ` Fehler: ${settingsDbError}` : ""}
          </div>
        </div>
      )}

      <div className={`grid gap-6 ${settingsReadOnly ? "pointer-events-none opacity-70" : ""}`}>
        {/* SITE STATUS */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Shop-Status</div>
          <div className="mb-3 max-w-md">
            <Toggle
              label="Shop geschlossen / Wartung aktiv"
              checked={!!m.site?.closed}
              onChange={(value) => setNested(["site", "closed"], value)}
            />
          </div>

          <Field label="Hinweistext bei geschlossenem Shop">
            <input
              className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              value={m.site?.message || ""}
              onChange={(event) => setNested(["site", "message"], event.target.value)}
              placeholder='z. B. "Wegen Wartungsarbeiten vorübergehend geschlossen. Wir öffnen heute um 18:00 Uhr."'
            />
          </Field>

          <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Wartung Start optional">
              <DateTimeWithPicker
                valueISO={m.site?.maintenanceStart || ""}
                onChangeISO={(value) => setNested(["site", "maintenanceStart"], value)}
              />
            </Field>
            <Field label="Wartung Ende optional">
              <DateTimeWithPicker
                valueISO={m.site?.maintenanceEnd || ""}
                onChangeISO={(value) => setNested(["site", "maintenanceEnd"], value)}
              />
            </Field>
          </div>
        </section>

        {/* FEATURES & TRACKING */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Funktionen & Tracking</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-md border border-stone-700/60 p-3">
              <div className="mb-2 font-medium">Menü-Funktionen</div>
              <div className="space-y-2">
                <Toggle
                  label="Bubble Tea aktiv"
                  checked={!!m.features?.bubbleTea?.enabled}
                  onChange={(value) =>
                    setNested(["features", "bubbleTea", "enabled"], value)
                  }
                />
                <Toggle
                  label="Donuts aktiv"
                  checked={!!m.features?.donuts?.enabled}
                  onChange={(value) => setNested(["features", "donuts", "enabled"], value)}
                />
              </div>
            </div>

            <div className="rounded-md border border-stone-700/60 p-3">
              <div className="mb-2 font-medium">Bestellung verfolgen</div>
              <div className="space-y-2">
                <Toggle
                  label="Tracking aktiv"
                  checked={!!m.tracking?.enabled}
                  onChange={(value) => {
                    setNested(["tracking", "enabled"], value);
                    setNested(["features", "tracking", "enabled"], value);
                    setNested(["features", "liveTracking", "enabled"], value);
                  }}
                />
                <Toggle
                  label="ETA-Uhr anzeigen"
                  checked={!!m.tracking?.showEtaClock}
                  onChange={(value) => {
                    setNested(["tracking", "showEtaClock"], value);
                    setNested(["features", "tracking", "showEtaClock"], value);
                  }}
                />
              </div>
            </div>
          </div>
        </section>

        {/* PAYMENT METHODS */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Zahlungsarten</div>

          <div className="mb-3 rounded-md border border-amber-700/40 bg-amber-950/20 p-3 text-sm text-amber-100">
            Aktuell arbeitet der Shop nur mit Barzahlung. Online-Zahlung und Kartenzahlung
            bei Lieferung bleiben vorbereitet, sind aber für Kunden unsichtbar, solange sie hier
            deaktiviert sind.
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-md border border-stone-700/60 p-3">
              <div className="mb-2 font-medium">Aktive Zahlung</div>
              <div className="space-y-2">
                <Toggle
                  label="Barzahlung / Nakit ödeme aktiv"
                  checked={!!m.payments?.cash?.enabled}
                  onChange={(value) => {
                    setNested(["payments", "cash", "enabled"], value);
                    setNested(["features", "payments"], {
                      ...(m.features?.payments || {}),
                      cashPayment: value,
                      onlinePayment: !!m.payments?.online?.enabled,
                      contactlessPayment: !!m.payments?.contactless?.enabled,
                      splitPayment: !!m.payments?.split?.enabled,
                    });
                    setNested(["features", "cashPayment", "enabled"], value);
                  }}
                />
              </div>

              <p className="mt-3 text-xs text-stone-400">
                Şu an müşteriye sadece bu ödeme yöntemi gösterilecek.
              </p>
            </div>

            <div className="rounded-md border border-stone-700/60 p-3">
              <div className="mb-2 font-medium">Hazır ama gizli ödeme altyapıları</div>
              <div className="space-y-2">
                <Toggle
                  label="Online ödeme aktiv"
                  checked={!!m.payments?.online?.enabled}
                  onChange={(value) => {
                    setNested(["payments", "online", "enabled"], value);
                    setNested(["features", "payments"], {
                      ...(m.features?.payments || {}),
                      cashPayment: !!m.payments?.cash?.enabled,
                      onlinePayment: value,
                      contactlessPayment: !!m.payments?.contactless?.enabled,
                      splitPayment: !!m.payments?.split?.enabled,
                    });
                    setNested(["features", "onlinePayment", "enabled"], value);
                  }}
                />
                <Toggle
                  label="Kapıda kart / POS ödeme aktiv"
                  checked={!!m.payments?.contactless?.enabled}
                  onChange={(value) => {
                    setNested(["payments", "contactless", "enabled"], value);
                    setNested(["features", "payments"], {
                      ...(m.features?.payments || {}),
                      cashPayment: !!m.payments?.cash?.enabled,
                      onlinePayment: !!m.payments?.online?.enabled,
                      contactlessPayment: value,
                      splitPayment: !!m.payments?.split?.enabled,
                    });
                    setNested(["features", "contactlessPayment", "enabled"], value);
                  }}
                />
                <Toggle
                  label="Split / Alman usulü ödeme aktiv"
                  checked={!!m.payments?.split?.enabled}
                  onChange={(value) => {
                    setNested(["payments", "split", "enabled"], value);
                    setNested(["features", "payments"], {
                      ...(m.features?.payments || {}),
                      cashPayment: !!m.payments?.cash?.enabled,
                      onlinePayment: !!m.payments?.online?.enabled,
                      contactlessPayment: !!m.payments?.contactless?.enabled,
                      splitPayment: value,
                    });
                    setNested(["features", "splitPayment", "enabled"], value);
                  }}
                />
              </div>

              <p className="mt-3 text-xs text-stone-400">
                Kapalı olan ödeme yöntemleri checkout tarafında görünmez. İleride açmak için
                buradan aktif etmen yeterli olacak.
              </p>
            </div>
          </div>
        </section>

        {/* VALIDATION */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Formular-Prüfung</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Telefonlänge">
              <input
                type="number"
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.validation?.phoneDigits ?? 11)}
                onChange={(event) =>
                  setNested(["validation", "phoneDigits"], Number(event.target.value || 0))
                }
              />
            </Field>

            <Field label="Bestellnummer Länge">
              <input
                type="number"
                min={4}
                max={12}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.orders?.idLength ?? 6)}
                onChange={(event) =>
                  setNested(
                    ["orders", "idLength"],
                    Math.min(Math.max(Number(event.target.value || 6), 4), 12)
                  )
                }
              />
            </Field>

            <div className="flex items-end">
              <Toggle
                label="Name: ersten Buchstaben groß"
                checked={!!m.validation?.nameCapitalizeFirst}
                onChange={(value) =>
                  setNested(["validation", "nameCapitalizeFirst"], value)
                }
              />
            </div>
          </div>
        </section>

        {/* PRICING */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Preise & Rabatte</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Rabatt Lifa / Lieferung (0.10 = 10%)">
              <input
                type="number"
                step="0.01"
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.delivery?.discountRate ?? 0)}
                onChange={(event) => {
                  const value = Number(event.target.value || 0);
                  setNested(["delivery", "discountRate"], value);
                  setNested(["discount", "lifaRate"], value);
                  setNested(["discounts", "deliveryPercent"], value);
                  setNested(["discounts", "lifaPercent"], value);
                }}
              />
            </Field>

            <Field label="Rabatt Apollon / Abholung (0.10 = 10%)">
              <input
                type="number"
                step="0.01"
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.pickup?.discountRate ?? 0)}
                onChange={(event) => {
                  const value = Number(event.target.value || 0);
                  setNested(["pickup", "discountRate"], value);
                  setNested(["discount", "apollonRate"], value);
                  setNested(["discounts", "pickupPercent"], value);
                  setNested(["discounts", "apolloPercent"], value);
                }}
              />
            </Field>
          </div>

          <div className="mt-3">
            <div className="mb-2 text-sm opacity-80">
              Kategorie-Aufschläge nur Lieferung
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {CATS.map((cat) => (
                <div key={cat} className="flex items-center gap-2">
                  <div className="w-36 text-sm">{cat.toUpperCase()}</div>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    value={String(m.delivery?.surcharges?.[cat] ?? "")}
                    onChange={(event) => {
                      const value = Number(event.target.value || 0);
                      const nextSurcharges = {
                        ...(m.delivery?.surcharges || {}),
                        [cat]: value,
                      };
                      setNested(["delivery", "surcharges"], nextSurcharges);
                      setNested(["surcharges"], nextSurcharges);
                    }}
                    placeholder="z. B. 1.0"
                  />
                </div>
              ))}
            </div>
          </div>

          <PLZTable
            value={m.delivery?.minOrderAfterDiscountByPLZ || {}}
            onChange={(value) => {
              setNested(["delivery", "minOrderAfterDiscountByPLZ"], value);
              setNested(["pricingOverrides", "plzMin"], value);
            }}
          />
        </section>

        {/* FREEBIES */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Gratis-Artikel Regel</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex items-end">
              <Toggle
                label="Gratis-Regel aktiv"
                checked={!!m.freebies?.enabled}
                onChange={(value) => setNested(["freebies", "enabled"], value)}
              />
            </div>

            <Field label="Kategorie">
              <select
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.freebies?.category || "sauces"}
                onChange={(event) =>
                  setNested(["freebies", "category"], event.target.value)
                }
              >
                <option value="sauces">Soßen</option>
                <option value="drinks">Getränke</option>
              </select>
            </Field>

            <Field label="Modus">
              <select
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.freebies?.mode || "both"}
                onChange={(event) => setNested(["freebies", "mode"], event.target.value)}
              >
                <option value="delivery">Lifa / Lieferung</option>
                <option value="pickup">Apollon / Abholung</option>
                <option value="both">Beide</option>
              </select>
            </Field>
          </div>

          <div className="mt-3">
            <div className="mb-2 text-sm opacity-80">Schwellenwerte</div>
            <TierEditor
              value={m.freebies?.tiers || []}
              onChange={(tiers) => setNested(["freebies", "tiers"], tiers)}
            />
          </div>
        </section>

        {/* THEME / BRAND */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Design & Marke</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Aktives Design">
              <select
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.theme?.active || "classic"}
                onChange={(event) => setNested(["theme", "active"], event.target.value)}
              >
                <option value="classic">Classic</option>
                <option value="neon">Neon</option>
                <option value="christmas">Christmas</option>
                <option value="halloween">Halloween</option>
              </select>
            </Field>

            <Field label="Hintergrundvideo URL (.mp4)">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.theme?.bgVideoUrl || ""}
                onChange={(event) => setNested(["theme", "bgVideoUrl"], event.target.value)}
                placeholder="https://.../background.mp4"
              />
            </Field>

            <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-2">
              <Field label="Logo Classic URL">
                <input
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  value={m.theme?.logos?.classic || ""}
                  onChange={(event) =>
                    setNested(["theme", "logos"], {
                      ...(m.theme?.logos || {}),
                      classic: event.target.value,
                    })
                  }
                  placeholder="/logo-classic.png"
                />
              </Field>

              <Field label="Logo Neon URL">
                <input
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  value={m.theme?.logos?.neon || ""}
                  onChange={(event) =>
                    setNested(["theme", "logos"], {
                      ...(m.theme?.logos || {}),
                      neon: event.target.value,
                    })
                  }
                  placeholder="/logo-neon.png"
                />
              </Field>

              <Field label="Logo Christmas URL">
                <input
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  value={m.theme?.logos?.christmas || ""}
                  onChange={(event) =>
                    setNested(["theme", "logos"], {
                      ...(m.theme?.logos || {}),
                      christmas: event.target.value,
                    })
                  }
                  placeholder="/logo-christmas.png"
                />
              </Field>

              <Field label="Logo Halloween URL">
                <input
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  value={m.theme?.logos?.halloween || ""}
                  onChange={(event) =>
                    setNested(["theme", "logos"], {
                      ...(m.theme?.logos || {}),
                      halloween: event.target.value,
                    })
                  }
                  placeholder="/logo-halloween.png"
                />
              </Field>
            </div>

            <div className="flex items-center">
              <Toggle
                label="Christmas: Schnee-Effekt"
                checked={!!m.theme?.snow}
                onChange={(value) => setNested(["theme", "snow"], value)}
              />
            </div>
          </div>
        </section>

        {/* HOURS */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Öffnungszeiten & Vorbestellung</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Zeitzone IANA">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.hours?.tz || m.hours?.timezone || "Europe/Berlin"}
                onChange={(event) => {
                  setNested(["hours", "tz"], event.target.value);
                  setNested(["hours", "timezone"], event.target.value);
                }}
                placeholder="Europe/Berlin"
              />
            </Field>

            <Field label="Tage im Voraus">
              <input
                type="number"
                step={1}
                min={0}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.hours?.daysAhead ?? 2)}
                onChange={(event) =>
                  setNested(["hours", "daysAhead"], Math.max(0, Number(event.target.value || 0)))
                }
              />
            </Field>

            <Field label="Slot Lieferung Minuten">
              <input
                type="number"
                step={1}
                min={1}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.hours?.slotMinutesDelivery ?? m.hours?.slotMinutes ?? 15)}
                onChange={(event) =>
                  setNested(
                    ["hours", "slotMinutesDelivery"],
                    Math.max(1, Number(event.target.value || 15))
                  )
                }
              />
            </Field>

            <Field label="Slot Abholung Minuten">
              <input
                type="number"
                step={1}
                min={1}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.hours?.slotMinutesPickup ?? m.hours?.slotMinutes ?? 15)}
                onChange={(event) =>
                  setNested(
                    ["hours", "slotMinutesPickup"],
                    Math.max(1, Number(event.target.value || 15))
                  )
                }
              />
            </Field>

            <Field label="Durchschnitt Abholung Minuten">
              <input
                type="number"
                step={1}
                min={1}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.hours?.avgPickupMinutes ?? 15)}
                onChange={(event) =>
                  setNested(
                    ["hours", "avgPickupMinutes"],
                    Math.max(1, Number(event.target.value || 15))
                  )
                }
              />
            </Field>

            <Field label="Durchschnitt Lieferung Minuten">
              <input
                type="number"
                step={1}
                min={1}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.hours?.avgDeliveryMinutes ?? 35)}
                onChange={(event) =>
                  setNested(
                    ["hours", "avgDeliveryMinutes"],
                    Math.max(1, Number(event.target.value || 35))
                  )
                }
              />
            </Field>

            <div className="flex items-end">
              <Toggle
                label="Vorbestellung aktiv"
                checked={!!m.hours?.allowPreorder}
                onChange={(value) => setNested(["hours", "allowPreorder"], value)}
              />
            </div>

            <div className="flex items-end">
              <Toggle
                label="Shop manuell geschlossen"
                checked={!!m.hours?.forceClosed}
                onChange={(value) => setNested(["hours", "forceClosed"], value)}
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <div className="mb-2 font-medium">Abholung</div>
              <HoursEditor
                value={m.hours?.pickup}
                onChange={(weekSchedule) => {
                  setNested(["hours", "pickup"], weekSchedule);

                  const plan = toPlanFromWeekSchedule({
                    pickup: weekSchedule,
                    delivery: m.hours?.delivery,
                  });

                  setNested(["hours", "plan"], {
                    ...(m.hours?.plan || {}),
                    pickup: plan.pickup,
                    delivery: plan.delivery,
                  });
                }}
              />
            </div>

            <div>
              <div className="mb-2 font-medium">Lieferung</div>
              <HoursEditor
                value={m.hours?.delivery}
                onChange={(weekSchedule) => {
                  setNested(["hours", "delivery"], weekSchedule);

                  const plan = toPlanFromWeekSchedule({
                    pickup: m.hours?.pickup,
                    delivery: weekSchedule,
                  });

                  setNested(["hours", "plan"], {
                    ...(m.hours?.plan || {}),
                    pickup: plan.pickup,
                    delivery: plan.delivery,
                  });
                }}
              />
            </div>
          </div>
        </section>

        {/* PRINTING */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Druckeinstellungen</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Logo URL">
              <input
                value={m.printing?.logoUrl || ""}
                onChange={(event) => setNested(["printing", "logoUrl"], event.target.value)}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              />
            </Field>

            <Field label="Fußnote">
              <input
                value={m.printing?.footerNote || m.printing?.footerHinweise || ""}
                onChange={(event) => {
                  setNested(["printing", "footerNote"], event.target.value);
                  setNested(["printing", "footerHinweise"], event.target.value);
                }}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              />
            </Field>

            <Field label="Papier">
              <select
                value={m.printing?.paper || "80mm"}
                onChange={(event) => setNested(["printing", "paper"], event.target.value)}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
              >
                <option value="80mm">80mm</option>
                <option value="A5">A5</option>
                <option value="A4">A4</option>
              </select>
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Toggle
                label="Barcode anzeigen"
                checked={!!m.printing?.showBarcode}
                onChange={(value) => setNested(["printing", "showBarcode"], value)}
              />
              <Toggle
                label="Adress-QR anzeigen"
                checked={!!m.printing?.showQR}
                onChange={(value) => setNested(["printing", "showQR"], value)}
              />
            </div>
          </div>

          <div className="mt-3">
            <div className="mb-2 text-sm opacity-80">Gruppierungs-Reihenfolge</div>
            <GroupingEditor
              value={m.printing?.groupingOrder || []}
              onChange={(value) => setNested(["printing", "groupingOrder"], value)}
            />
          </div>
        </section>

        {/* COLORS */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Farben</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ColorEditor
              title="Status-Farben"
              value={m.colors?.statusColors || {}}
              onChange={(value) => setNested(["colors", "statusColors"], value)}
              keys={[
                ["eingegangen", "Eingegangen"],
                ["zubereitung", "Zubereitung"],
                ["abholbereit", "Abholbereit"],
                ["unterwegs", "Unterwegs"],
                ["abgeschlossen", "Abgeschlossen"],
                ["storniert", "Storniert"],
              ]}
            />

            <ColorEditor
              title="Modus-Farben"
              value={m.colors?.modeColors || {}}
              onChange={(value) => setNested(["colors", "modeColors"], value)}
              keys={[
                ["pickup", "Abholung"],
                ["delivery", "Lieferung"],
              ]}
            />
          </div>
        </section>

        {/* DASHBOARD */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Dashboard</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field label="Dashboard-Passwort">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.dashboard?.password || ""}
                onChange={(event) => setNested(["dashboard", "password"], event.target.value)}
                placeholder="z. B. 1234"
              />
            </Field>

            <Field label="Aktualisierung Sekunden">
              <input
                type="number"
                min={1}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.dashboard?.pollSeconds ?? 3)}
                onChange={(event) =>
                  setNested(
                    ["dashboard", "pollSeconds"],
                    Math.max(1, Number(event.target.value || 3))
                  )
                }
              />
            </Field>

            <Field label="Ton für neue Bestellung URL">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.dashboard?.sound?.newOrder || ""}
                onChange={(event) =>
                  setNested(["dashboard", "sound"], {
                    ...(m.dashboard?.sound || {}),
                    newOrder: event.target.value,
                  })
                }
                placeholder="/sounds/new-order.mp3"
              />
            </Field>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Zielzeit Lieferung Minuten">
              <input
                type="number"
                min={1}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.dashboard?.targets?.deliveryMins ?? 30)}
                onChange={(event) =>
                  setNested(["dashboard", "targets"], {
                    ...(m.dashboard?.targets || {}),
                    deliveryMins: Math.max(1, Number(event.target.value || 30)),
                    pickupMins: Number(m.dashboard?.targets?.pickupMins ?? 15),
                  })
                }
              />
            </Field>

            <Field label="Zielzeit Abholung Minuten">
              <input
                type="number"
                min={1}
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={String(m.dashboard?.targets?.pickupMins ?? 15)}
                onChange={(event) =>
                  setNested(["dashboard", "targets"], {
                    ...(m.dashboard?.targets || {}),
                    pickupMins: Math.max(1, Number(event.target.value || 15)),
                    deliveryMins: Number(m.dashboard?.targets?.deliveryMins ?? 30),
                  })
                }
              />
            </Field>
          </div>

          <p className="mt-2 text-xs text-stone-400">
            Farben werden im Dashboard aus <b>Farben → Modus-Farben / Status-Farben</b>{" "}
            gelesen.
          </p>
        </section>

        {/* ANNOUNCEMENTS */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Ankündigungen / Kampagnen-Banner</div>
          <div className="mb-2 max-w-md">
            <Toggle
              label="Ankündigungen aktiv"
              checked={!!m.announcements?.enabled}
              onChange={(value) => setNested(["announcements", "enabled"], value)}
            />
          </div>

          <AnnouncementsEditor
            value={m.announcements?.items || []}
            onChange={(value) => setNested(["announcements", "items"], value)}
          />
        </section>

        {/* ROUTE DEALS */}
        <section className="card">
          <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-lg font-medium">Akıllı Rota Fırsatı</div>
              <p className="mt-1 text-sm text-stone-400">
                Bu yeni alan alışana kadar Türkçe bırakıldı. Uzak PLZ veya sokaktan
                sipariş gelince aynı bölgedeki müşteriye kısa süreli otomatik fırsat
                gösterilecek.
              </p>
            </div>
          </div>

          <RouteDealsEditor
            value={m.routeDeals || {}}
            onChange={(value) => setNested(["routeDeals"], value)}
          />
        </section>

        {/* TELEGRAM */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Telegram Benachrichtigung</div>
          <div className="mb-3 max-w-md">
            <Toggle
              label="Telegram aktiv"
              checked={!!m.telegram?.enabled}
              onChange={(value) => setNested(["telegram", "enabled"], value)}
            />
          </div>

          <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label="Bot Token">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.telegram?.botToken || ""}
                onChange={(event) => setNested(["telegram", "botToken"], event.target.value)}
                placeholder="123456:ABC-DEF..."
              />
            </Field>

            <Field label="Chat ID / Kanal">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.telegram?.chatId || ""}
                onChange={(event) => setNested(["telegram", "chatId"], event.target.value)}
                placeholder="@kanalName oder -100123456"
              />
            </Field>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              className="rounded-md border border-stone-700/60 bg-stone-800/60 px-3 py-2 text-sm"
              onClick={async () => {
                try {
                  const token = model?.telegram?.botToken || "";
                  const chatId = model?.telegram?.chatId || "";

                  if (!model?.telegram?.enabled) {
                    alert("Bitte zuerst Telegram aktivieren.");
                    return;
                  }

                  if (!token || !chatId) {
                    alert("Bot Token und Chat ID sind erforderlich.");
                    return;
                  }

                  const res = await fetch("/api/telegram/send", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      token,
                      chatId,
                      text: "Testnachricht ✅\n(Burger Admin Settings)",
                      parseMode: "HTML",
                    }),
                  });

                  const json = await res.json().catch(() => ({}));

                  if (!res.ok || !json?.ok) {
                    alert("Telegram-Test fehlgeschlagen: " + (json?.error || res.status));
                  } else {
                    alert("Telegram-Test erfolgreich ✅");
                  }
                } catch (error: any) {
                  alert("Fehler: " + (error?.message || ""));
                }
              }}
            >
              Bot testen
            </button>

            <span className="text-xs text-stone-400">
              Der Test nutzt die aktuellen Formularwerte.
            </span>
          </div>
        </section>

        {/* CONTACT */}
        <section className="card">
          <div className="mb-3 text-lg font-medium">Kontakt</div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <Field label="Telefon">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.contact?.phone || ""}
                onChange={(event) => setNested(["contact", "phone"], event.target.value)}
              />
            </Field>

            <Field label="E-Mail">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.contact?.email || ""}
                onChange={(event) => setNested(["contact", "email"], event.target.value)}
              />
            </Field>

            <Field label="Adresse">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.contact?.address || ""}
                onChange={(event) => setNested(["contact", "address"], event.target.value)}
              />
            </Field>

            <Field label="WhatsApp Nummer">
              <input
                className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                value={m.contact?.whatsappNumber || m.contact?.whatsapp || ""}
                onChange={(event) => {
                  setNested(["contact", "whatsappNumber"], event.target.value);
                  setNested(["contact", "whatsapp"], event.target.value);
                }}
              />
            </Field>
          </div>
        </section>
      </div>
    </main>
  );
}

/* ───────────────────── subcomponents ───────────────────── */

function PLZTable({
  value,
  onChange,
}: {
  value: Record<string, number>;
  onChange: (value: Record<string, number>) => void;
}) {
  const add = () => {
    const code = prompt("PLZ 5-stellig:")?.replace(/\D/g, "").slice(0, 5) || "";
    if (!code) return;

    const minimum = Number(prompt("Mindestbestellwert nach Rabatt in €:") || "0");
    onChange({ ...(value || {}), [code]: Math.max(0, minimum || 0) });
  };

  const remove = (key: string) => {
    const copy = { ...(value || {}) };
    delete copy[key];
    onChange(copy);
  };

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="text-sm opacity-80">PLZ Mindestbestellwert nach Rabatt</div>
        <button className="pill" onClick={add}>
          Neue PLZ
        </button>
      </div>

      <div className="overflow-hidden rounded border border-stone-700/60">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left opacity-70">
              <th className="p-2">PLZ</th>
              <th className="p-2">Min €</th>
              <th className="p-2"></th>
            </tr>
          </thead>

          <tbody>
            {Object.entries(value || {}).map(([key, item]) => (
              <tr key={key} className="border-t border-stone-700/60">
                <td className="p-2">{key}</td>
                <td className="p-2">
                  <input
                    type="number"
                    step="0.01"
                    className="w-32 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
                    value={String(item)}
                    onChange={(event) =>
                      onChange({
                        ...(value || {}),
                        [key]: Number(event.target.value || 0),
                      })
                    }
                  />
                </td>
                <td className="p-2 text-right">
                  <button className="btn-ghost" onClick={() => remove(key)}>
                    Löschen
                  </button>
                </td>
              </tr>
            ))}

            {Object.keys(value || {}).length === 0 && (
              <tr>
                <td className="p-2 text-sm opacity-70" colSpan={3}>
                  Keine Einträge.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TierEditor({
  value,
  onChange,
}: {
  value: Array<{ minTotal: number; freeSauces: number }>;
  onChange: (value: Array<{ minTotal: number; freeSauces: number }>) => void;
}) {
  const safe = value || [];

  const add = () => onChange([...safe, { minTotal: 15, freeSauces: 1 }]);
  const remove = (index: number) => onChange(safe.filter((_, idx) => idx !== index));

  const set = (
    index: number,
    patch: Partial<{ minTotal: number; freeSauces: number }>
  ) => {
    const copy = safe.map((tier, idx) => (idx === index ? { ...tier, ...patch } : tier));
    onChange(copy);
  };

  return (
    <div>
      <div className="mb-2">
        <button className="pill" onClick={add}>
          Schwelle hinzufügen
        </button>
      </div>

      {safe.length === 0 ? (
        <div className="text-sm opacity-70">Noch keine Schwelle vorhanden.</div>
      ) : (
        <div className="space-y-2">
          {safe.map((tier, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <label className="text-sm">Min €</label>
              <input
                type="number"
                step="0.01"
                className="w-28 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
                value={String(tier.minTotal)}
                onChange={(event) =>
                  set(index, { minTotal: Number(event.target.value || 0) })
                }
              />

              <label className="ml-1 text-sm">Gratis Anzahl</label>
              <input
                type="number"
                step={1}
                min={0}
                className="w-24 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
                value={String(tier.freeSauces)}
                onChange={(event) =>
                  set(index, {
                    freeSauces: Math.max(0, Number(event.target.value || 0)),
                  })
                }
              />

              <button className="btn-ghost ml-auto" onClick={() => remove(index)}>
                Löschen
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HoursEditor({
  value,
  onChange,
}: {
  value?: WeekSchedule;
  onChange: (weekSchedule: WeekSchedule) => void;
}) {
  const weekSchedule: WeekSchedule = value || {};

  const ensureDay = (day: (typeof DAY_KEYS)[number]) => weekSchedule[day] ?? [];

  const setDay = (day: (typeof DAY_KEYS)[number], ranges: TimeRange[]) => {
    const next: WeekSchedule = { ...weekSchedule, [day]: ranges };
    onChange(next);
  };

  return (
    <div className="divide-y divide-stone-700/60 rounded border border-stone-700/60">
      {DAY_KEYS.map((dayKey) => (
        <DayRow
          key={dayKey}
          label={DAY_LABELS[dayKey]}
          ranges={ensureDay(dayKey) || []}
          onChange={(ranges) => setDay(dayKey, ranges || [])}
        />
      ))}
    </div>
  );
}

function DayRow({
  label,
  ranges,
  onChange,
}: {
  label: string;
  ranges: TimeRange[] | undefined | null;
  onChange: (ranges: TimeRange[] | null) => void;
}) {
  const isClosed = !ranges || ranges.length === 0;

  const add = () => {
    const next = [...(ranges || []), { start: "11:00", end: "22:00" }];
    onChange(next);
  };

  const toggleClosed = (closed: boolean) => {
    onChange(closed ? [] : [{ start: "11:00", end: "22:00" }]);
  };

  const setRange = (index: number, patch: Partial<TimeRange>) => {
    const base = ranges || [];
    const current = base[index] || { start: "11:00", end: "22:00" };
    const next = base.map((range, idx) => (idx === index ? { ...current, ...patch } : range));
    onChange(next);
  };

  const remove = (index: number) => onChange((ranges || []).filter((_, idx) => idx !== index));

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="font-medium">{label}</div>
        <button
          type="button"
          role="switch"
          aria-checked={!isClosed}
          onClick={() => toggleClosed(!isClosed)}
          className={`inline-flex h-6 w-11 items-center rounded-full transition ${
            !isClosed ? "bg-emerald-500" : "bg-stone-600"
          }`}
        >
          <span
            className={`ml-0.5 inline-block h-5 w-5 transform rounded-full bg-white transition ${
              !isClosed ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <div className="mb-2 text-xs text-stone-400">
        {isClosed ? "Geschlossen" : "Geöffnet"}
      </div>

      {!isClosed && (
        <div className="space-y-2">
          {(ranges || []).map((range, index) => (
            <RangeRow
              key={index}
              range={range}
              onChange={(patch) => setRange(index, patch)}
              onDelete={() => remove(index)}
            />
          ))}

          <button className="pill" onClick={add}>
            Zeitraum hinzufügen
          </button>
        </div>
      )}
    </div>
  );
}

function RangeRow({
  range,
  onChange,
  onDelete,
}: {
  range: TimeRange;
  onChange: (patch: Partial<TimeRange>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="time"
        className="rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
        value={range.start}
        onChange={(event) => onChange({ start: event.target.value })}
      />

      <span className="opacity-70">—</span>

      <input
        type="time"
        className="rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
        value={range.end}
        onChange={(event) => onChange({ end: event.target.value })}
      />

      <button className="btn-ghost ml-auto" onClick={onDelete}>
        Löschen
      </button>
    </div>
  );
}

function GroupingEditor({
  value,
  onChange,
}: {
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const list = value?.length
    ? value
    : ["burger", "vegan", "hotdogs", "extras", "drinks", "sauces"];

  const move = (index: number, direction: -1 | 1) => {
    const copy = [...list];
    const target = index + direction;

    if (target < 0 || target >= copy.length) return;

    [copy[index], copy[target]] = [copy[target], copy[index]];
    onChange(copy);
  };

  const toggle = (cat: string, checked: boolean) => {
    if (checked && !list.includes(cat)) onChange([...list, cat]);
    if (!checked && list.includes(cat)) onChange(list.filter((item) => item !== cat));
  };

  return (
    <div className="space-y-2">
      {list.map((cat, index) => (
        <div key={cat} className="flex items-center gap-2">
          <div className="w-40">{cat}</div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => move(index, -1)}>
              ↑
            </button>
            <button className="btn-ghost" onClick={() => move(index, 1)}>
              ↓
            </button>
          </div>
        </div>
      ))}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {CATS.map((cat) => (
          <label key={cat} className="inline-flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={list.includes(cat)}
              onChange={(event) => toggle(cat, event.target.checked)}
            />
            {cat}
          </label>
        ))}
      </div>
    </div>
  );
}

function ColorEditor({
  title,
  value,
  onChange,
  keys,
}: {
  title: string;
  value: Record<string, string>;
  onChange: (value: Record<string, string>) => void;
  keys: Array<[string, string]>;
}) {
  const set = (key: string, color: string) => {
    onChange({ ...(value || {}), [key]: color });
  };

  return (
    <div className="rounded-md border border-stone-700/60 p-3">
      <div className="mb-2 font-medium">{title}</div>
      <div className="grid grid-cols-1 gap-2">
        {keys.map(([key, label]) => (
          <div key={key} className="flex items-center gap-3">
            <div className="w-36 text-sm">{label}</div>

            <input
              type="color"
              value={value?.[key] || "#000000"}
              onChange={(event) => set(key, event.target.value)}
              className="h-8 w-12 rounded border border-stone-700/60 bg-stone-950"
            />

            <input
              value={value?.[key] || "#000000"}
              onChange={(event) => set(key, event.target.value)}
              className="w-40 rounded-md border border-stone-700/60 bg-stone-950 px-2 py-1 outline-none"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function DateTimeWithPicker({
  valueISO,
  onChangeISO,
}: {
  valueISO: string;
  onChangeISO: (value: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);

  const toLocal = (iso?: string) => {
    if (!iso) return "";

    try {
      const date = new Date(iso);
      if (!Number.isFinite(date.valueOf())) return "";

      const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);

      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
        date.getDate()
      )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    } catch {
      return "";
    }
  };

  return (
    <div className="relative">
      <input
        ref={ref}
        type="datetime-local"
        className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
        value={toLocal(valueISO)}
        onChange={(event) =>
          onChangeISO(event.target.value ? safeIso(event.target.value) : "")
        }
      />

      <button
        type="button"
        className="absolute right-1.5 top-1.5 rounded-md border border-stone-700/60 bg-stone-800/60 px-2 py-1 text-xs"
        title="Kalender"
        onClick={() => (ref.current as any)?.showPicker?.()}
      >
        📅
      </button>
    </div>
  );
}


function RouteDealsEditor({
  value,
  onChange,
}: {
  value: any;
  onChange: (value: any) => void;
}) {
  const safe = {
    enabled: bool(value?.enabled, false),
    maxActiveDeals: Math.min(5, Math.max(1, num(value?.maxActiveDeals, 2))),
    defaultDurationMinutes: Math.min(
      60,
      Math.max(1, num(value?.defaultDurationMinutes, 12))
    ),
    rules: Array.isArray(value?.rules) ? value.rules : [],
    active: Array.isArray(value?.active) ? value.active : [],
  };

  const updateRoot = (patch: Record<string, any>) => {
    onChange({
      ...(value || {}),
      ...safe,
      ...patch,
    });
  };

  const updateRule = (index: number, patch: Record<string, any>) => {
    const rules = safe.rules.map((rule: any, idx: number) =>
      idx === index ? { ...rule, ...patch } : rule
    );

    updateRoot({ rules });
  };

  const updateReward = (index: number, patch: Record<string, any>) => {
    const current = safe.rules[index] || {};
    const reward = {
      ...(current.reward || {}),
      ...patch,
    };

    updateRule(index, { reward });
  };

  const addRule = () => {
    const index = safe.rules.length + 1;

    updateRoot({
      rules: [
        ...safe.rules,
        {
          id: `route-deal-${Date.now().toString(36)}`,
          name: `Rota Fırsatı ${index}`,
          enabled: true,
          plz: [],
          streets: [],
          durationMinutes: safe.defaultDurationMinutes,
          minTotal: 20,
          reward: {
            type: "percent",
            percent: 15,
            amount: 0,
            maxDiscount: 5,
            freeItemName: "",
            freeItemCategory: "sauces",
          },
          message:
            "Unser Fahrer ist gleich in Ihrer Nähe. Bestellen Sie jetzt und sichern Sie sich Ihr Nachbarschafts-Angebot.",
          priority: index,
        },
      ],
    });
  };

  const removeRule = (index: number) => {
    updateRoot({
      rules: safe.rules.filter((_: any, idx: number) => idx !== index),
    });
  };

  const clearActiveDeals = () => {
    if (!window.confirm("Aktif rota fırsatları temizlensin mi?")) return;
    updateRoot({ active: [] });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-100">
        <div className="font-medium">Mantık</div>
        <p className="mt-1 leading-relaxed">
          Örnek: 13469 veya seçtiğin sokaktan uzak sipariş geldiğinde sistem
          bu bölge için 10-15 dakikalık fırsat açar. Aynı PLZ/sokak ile siteye
          giren müşteri banner görür ve indirim sepete otomatik düşer.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-md border border-stone-700/60 p-3">
          <Toggle
            label="Rota fırsatı aktif"
            checked={safe.enabled}
            onChange={(enabled) => updateRoot({ enabled })}
          />
          <p className="mt-2 text-xs text-stone-400">
            Kapalı olursa sistem hiçbir bölge fırsatı oluşturmaz.
          </p>
        </div>

        <Field label="Varsayılan süre dakika">
          <input
            type="number"
            min={1}
            max={60}
            className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            value={String(safe.defaultDurationMinutes)}
            onChange={(event) =>
              updateRoot({
                defaultDurationMinutes: Math.min(
                  60,
                  Math.max(1, Number(event.target.value || 12))
                ),
              })
            }
          />
        </Field>

        <Field label="Aynı anda maksimum aktif bölge">
          <input
            type="number"
            min={1}
            max={5}
            className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
            value={String(safe.maxActiveDeals)}
            onChange={(event) =>
              updateRoot({
                maxActiveDeals: Math.min(
                  5,
                  Math.max(1, Number(event.target.value || 2))
                ),
              })
            }
          />
        </Field>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-medium">Bölge kuralları</div>
          <div className="text-xs text-stone-400">
            PLZ zorunlu. Sokak boş kalırsa o PLZ içindeki tüm uygun müşteriler görür.
          </div>
        </div>

        <button type="button" className="pill w-full sm:w-auto" onClick={addRule}>
          Yeni rota kuralı ekle
        </button>
      </div>

      {safe.rules.length === 0 ? (
        <div className="rounded-md border border-stone-700/60 p-3 text-sm text-stone-400">
          Henüz rota kuralı yok. Başlamak için örnek: PLZ 13469, indirim %15,
          süre 12 dakika.
        </div>
      ) : (
        <div className="space-y-3">
          {safe.rules.map((rule: any, index: number) => {
            const reward = rule?.reward || {};
            const rewardType = reward?.type || "percent";

            return (
              <div key={rule?.id || index} className="rounded-xl border border-stone-700/60 p-3">
                <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-medium">
                      {rule?.name || `Rota Fırsatı ${index + 1}`}
                    </div>
                    <div className="text-xs text-stone-400">
                      {cleanList(rule?.plz).join(", ") || "PLZ yok"} ·{" "}
                      {rewardLabel(rewardType)}
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Toggle
                      label="Kural aktif"
                      checked={rule?.enabled !== false}
                      onChange={(enabled) => updateRule(index, { enabled })}
                    />
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => removeRule(index)}
                    >
                      Sil
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  <Field label="Kural adı">
                    <input
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      value={rule?.name || ""}
                      onChange={(event) =>
                        updateRule(index, { name: event.target.value })
                      }
                      placeholder="Örn. 13469 Lotos çevresi"
                    />
                  </Field>

                  <Field label="Müşteriye gösterilecek yazı">
                    <input
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      value={rule?.message || ""}
                      onChange={(event) =>
                        updateRule(index, { message: event.target.value })
                      }
                      placeholder="Unser Fahrer ist gleich in Ihrer Nähe..."
                    />
                  </Field>

                  <Field label="Posta kodları / PLZ">
                    <textarea
                      rows={4}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      value={listToText(rule?.plz)}
                      onChange={(event) =>
                        updateRule(index, { plz: cleanList(event.target.value) })
                      }
                      placeholder={"13469\n13507"}
                    />
                    <p className="mt-1 text-xs text-stone-400">
                      Her satıra bir PLZ yazabilirsin.
                    </p>
                  </Field>

                  <Field label="Sokaklar opsiyonel">
                    <textarea
                      rows={4}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      value={listToText(rule?.streets)}
                      onChange={(event) =>
                        updateRule(index, { streets: cleanList(event.target.value) })
                      }
                      placeholder={"Lotosweg\nBerliner Straße"}
                    />
                    <p className="mt-1 text-xs text-stone-400">
                      Boş bırakırsan sadece PLZ eşleşmesi yeterli olur.
                    </p>
                  </Field>

                  <Field label="Fırsat süresi dakika">
                    <input
                      type="number"
                      min={1}
                      max={60}
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      value={String(rule?.durationMinutes ?? safe.defaultDurationMinutes)}
                      onChange={(event) =>
                        updateRule(index, {
                          durationMinutes: Math.min(
                            60,
                            Math.max(1, Number(event.target.value || safe.defaultDurationMinutes))
                          ),
                        })
                      }
                    />
                  </Field>

                  <Field label="Minimum sepet tutarı €">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      value={String(rule?.minTotal ?? 0)}
                      onChange={(event) =>
                        updateRule(index, {
                          minTotal: Math.max(0, Number(event.target.value || 0)),
                        })
                      }
                    />
                  </Field>

                  <Field label="Fırsat tipi">
                    <select
                      className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                      value={rewardType}
                      onChange={(event) =>
                        updateReward(index, { type: event.target.value })
                      }
                    >
                      <option value="percent">Yüzde indirim</option>
                      <option value="fixed">Sabit € indirim</option>
                      <option value="free_delivery">Teslimat ücreti bedava</option>
                      <option value="free_sauce">Bedava sos</option>
                      <option value="free_drink">Bedava içecek</option>
                    </select>
                  </Field>

                  {rewardType === "percent" && (
                    <Field label="İndirim yüzdesi">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step="1"
                        className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                        value={String(reward?.percent ?? 15)}
                        onChange={(event) =>
                          updateReward(index, {
                            percent: Math.min(
                              100,
                              Math.max(0, Number(event.target.value || 0))
                            ),
                          })
                        }
                      />
                    </Field>
                  )}

                  {rewardType === "fixed" && (
                    <Field label="Sabit indirim €">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                        value={String(reward?.amount ?? 0)}
                        onChange={(event) =>
                          updateReward(index, {
                            amount: Math.max(0, Number(event.target.value || 0)),
                          })
                        }
                      />
                    </Field>
                  )}

                  {(rewardType === "free_sauce" || rewardType === "free_drink") && (
                    <Field label="Bedava ürün adı">
                      <input
                        className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                        value={reward?.freeItemName || ""}
                        onChange={(event) =>
                          updateReward(index, {
                            freeItemName: event.target.value,
                            freeItemCategory:
                              rewardType === "free_drink" ? "drinks" : "sauces",
                          })
                        }
                        placeholder={
                          rewardType === "free_drink"
                            ? "Örn. Coca-Cola 0,33l"
                            : "Örn. Ketchup"
                        }
                      />
                    </Field>
                  )}

                  {(rewardType === "percent" || rewardType === "fixed") && (
                    <Field label="Maksimum indirim €">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                        value={String(reward?.maxDiscount ?? 0)}
                        onChange={(event) =>
                          updateReward(index, {
                            maxDiscount: Math.max(
                              0,
                              Number(event.target.value || 0)
                            ),
                          })
                        }
                        placeholder="0 = sınırsız"
                      />
                    </Field>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-xl border border-stone-700/60 p-3">
        <div className="mb-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="font-medium">Şu an aktif fırsatlar</div>
            <div className="text-xs text-stone-400">
              Bunlar sipariş gelince backend tarafından otomatik açılacak. Gerekirse
              buradan temizleyebilirsin.
            </div>
          </div>

          <button
            type="button"
            className="btn-ghost w-full sm:w-auto"
            onClick={clearActiveDeals}
            disabled={safe.active.length === 0}
          >
            Aktifleri temizle
          </button>
        </div>

        {safe.active.length === 0 ? (
          <div className="text-sm text-stone-400">Şu an aktif rota fırsatı yok.</div>
        ) : (
          <div className="space-y-2">
            {safe.active.map((deal: any, index: number) => (
              <div
                key={deal?.id || index}
                className="rounded-md border border-stone-700/60 bg-stone-950/40 p-2 text-sm"
              >
                <div className="font-medium">
                  {deal?.name || "Nachbarschafts-Deal"}
                </div>
                <div className="mt-1 text-xs text-stone-400">
                  PLZ: {deal?.plz || "-"} · Sokak: {deal?.street || "-"} · Bitiş:{" "}
                  {deal?.expiresAt
                    ? new Date(deal.expiresAt).toLocaleString("de-DE")
                    : "-"}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AnnouncementsEditor({
  value,
  onChange,
}: {
  value: Array<{
    title?: string;
    text?: string;
    imageUrl?: string;
    ctaLabel?: string;
    ctaHref?: string;
    enabled?: boolean;
    startsAt?: string;
    endsAt?: string;
  }>;
  onChange: (
    value: Array<{
      title?: string;
      text?: string;
      imageUrl?: string;
      ctaLabel?: string;
      ctaHref?: string;
      enabled?: boolean;
      startsAt?: string;
      endsAt?: string;
    }>
  ) => void;
}) {
  const list = value || [];

  const add = () =>
    onChange([
      ...list,
      {
        title: "",
        text: "",
        imageUrl: "",
        ctaLabel: "",
        ctaHref: "",
        enabled: true,
        startsAt: "",
        endsAt: "",
      },
    ]);

  const remove = (index: number) => onChange(list.filter((_, idx) => idx !== index));

  const set = (index: number, patch: any) =>
    onChange(list.map((item, idx) => (idx === index ? { ...item, ...patch } : item)));

  return (
    <div className="space-y-3">
      <button className="pill" onClick={add}>
        Banner hinzufügen
      </button>

      {list.length === 0 ? (
        <div className="text-sm opacity-70">Noch kein Banner vorhanden.</div>
      ) : (
        list.map((item, index) => (
          <div key={index} className="rounded-md border border-stone-700/60 p-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label="Titel">
                <input
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  value={item.title || ""}
                  onChange={(event) => set(index, { title: event.target.value })}
                />
              </Field>

              <Field label="Bild URL">
                <input
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  value={item.imageUrl || ""}
                  onChange={(event) => set(index, { imageUrl: event.target.value })}
                />
              </Field>

              <Field label="Text">
                <input
                  className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                  value={item.text || ""}
                  onChange={(event) => set(index, { text: event.target.value })}
                />
              </Field>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Field label="CTA Label">
                  <input
                    className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    value={item.ctaLabel || ""}
                    onChange={(event) => set(index, { ctaLabel: event.target.value })}
                  />
                </Field>

                <Field label="CTA Link">
                  <input
                    className="w-full rounded-md border border-stone-700/60 bg-stone-950 px-3 py-2 outline-none"
                    value={item.ctaHref || ""}
                    onChange={(event) => set(index, { ctaHref: event.target.value })}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 md:col-span-2 md:grid-cols-3">
                <div className="flex items-end">
                  <Toggle
                    label="Banner aktiv"
                    checked={item.enabled !== false}
                    onChange={(value) => set(index, { enabled: value })}
                  />
                </div>

                <Field label="Start">
                  <DateTimeWithPicker
                    valueISO={item.startsAt || ""}
                    onChangeISO={(value) => set(index, { startsAt: value })}
                  />
                </Field>

                <Field label="Ende">
                  <DateTimeWithPicker
                    valueISO={item.endsAt || ""}
                    onChangeISO={(value) => set(index, { endsAt: value })}
                  />
                </Field>
              </div>
            </div>

            <div className="mt-2 text-right">
              <button className="btn-ghost" onClick={() => remove(index)}>
                Löschen
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}