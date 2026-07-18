import { readFileSync } from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/db";
import {
  DEFAULT_PLAN,
  isOpenAt,
  nowInTZ,
  planFromSettings,
  validatePlannedTime,
} from "@/lib/availability";
import { normalizeStreetForMatch } from "@/lib/streets";

type OrderMode = "pickup" | "delivery";
type StreetDatabase = Record<string, string[]>;

export class OrderValidationError extends Error {
  code: string;
  status: number;
  details?: Record<string, any>;

  constructor(
    code: string,
    message: string,
    status = 400,
    details?: Record<string, any>,
  ) {
    super(message);
    this.name = "OrderValidationError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

let streetDatabase: StreetDatabase | null | undefined;

function object(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function text(value: any) {
  return String(value ?? "").trim();
}

function digits(value: any) {
  return String(value ?? "").replace(/\D/g, "");
}

function number(value: any, fallback = 0) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function modeFrom(value: any): OrderMode {
  const normalized = text(value).toLowerCase();
  return ["pickup", "abholung", "apollo", "apollon"].includes(normalized)
    ? "pickup"
    : "delivery";
}

function loadStreetDatabase() {
  if (streetDatabase !== undefined) return streetDatabase;

  try {
    const file = path.join(process.cwd(), "public", "data", "streets.json");
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    streetDatabase = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as StreetDatabase
      : null;
  } catch (error) {
    console.error("[order-validation] official street data unavailable", error);
    streetDatabase = null;
  }

  return streetDatabase;
}

function officialStreetExists(plz: string, value: string) {
  const database = loadStreetDatabase();
  if (!database) {
    throw new OrderValidationError(
      "ORDER_STREET_DATA_UNAVAILABLE",
      "Die Straßenliste ist vorübergehend nicht verfügbar.",
      503,
    );
  }

  const target = normalizeStreetForMatch(value);
  const streets = [
    ...(Array.isArray(database[plz]) ? database[plz] : []),
    ...(plz === "13503" ? ["Alt-Heiligensee"] : []),
  ];
  return Boolean(
    target && streets.some((street) => normalizeStreetForMatch(street) === target),
  );
}

function todayAt(hhmm: string, timezone: string) {
  const [hours, minutes] = hhmm.split(":").map((part) => Number(part));
  const base = nowInTZ(timezone);
  const iso = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(
    base.getDate(),
  ).padStart(2, "0")}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
  return new Date(new Date(`${iso} GMT`).toLocaleString("en-US", { timeZone: timezone }));
}

function normalizePlanned(value: any) {
  const match = text(value).match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return "";
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return "";
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

async function readPauseState(tenantId: string) {
  const row = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId, key: "pause" } },
    select: { value: true },
  });
  const raw = object(row?.value);
  const pause = object(raw.pause ?? raw.state ?? raw.value ?? raw);
  return { pickup: pause.pickup === true, delivery: pause.delivery === true };
}

function validateCustomer(order: any, settings: any, mode: OrderMode) {
  const customer = object(order?.customer);
  const name = text(customer.name ?? order?.customerName);
  const phone = digits(customer.phone ?? order?.phone);
  const email = text(customer.email ?? order?.email);
  const phoneDigits = Math.min(
    20,
    Math.max(1, Math.round(number(settings?.validation?.phoneDigits, 11))),
  );

  if (!name || name.length > 120) {
    throw new OrderValidationError("ORDER_CUSTOMER_NAME_INVALID", "Bitte einen gültigen Namen eingeben.");
  }
  if (phone.length !== phoneDigits) {
    throw new OrderValidationError(
      "ORDER_CUSTOMER_PHONE_INVALID",
      `Die Telefonnummer muss genau ${phoneDigits} Ziffern enthalten.`,
    );
  }
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    throw new OrderValidationError("ORDER_CUSTOMER_EMAIL_INVALID", "Bitte eine gültige E-Mail-Adresse eingeben.");
  }

  if (mode === "pickup") return { customer, phone, plz: "", street: "" };

  const plz = digits(customer.plz ?? customer.zip ?? customer.postalCode ?? order?.plz).slice(0, 5);
  const street = text(customer.street);
  const house = text(customer.house ?? customer.houseNo);
  const checkoutMinimums = object(settings?.delivery?.plzMin);
  const minimums = Object.keys(checkoutMinimums).length
    ? checkoutMinimums
    : {
        ...object(settings?.pricingOverrides?.plzMin),
        ...object(settings?.delivery?.minOrderAfterDiscountByPLZ),
      };

  if (plz.length !== 5 || !Object.prototype.hasOwnProperty.call(minimums, plz)) {
    throw new OrderValidationError(
      "ORDER_DELIVERY_AREA_INVALID",
      "Diese Postleitzahl liegt nicht im Liefergebiet.",
      409,
    );
  }
  if (!street || !officialStreetExists(plz, street)) {
    throw new OrderValidationError(
      "ORDER_STREET_INVALID",
      "Bitte eine offizielle Straße aus der Liste auswählen.",
      409,
    );
  }
  if (!house || house.length > 30) {
    throw new OrderValidationError("ORDER_HOUSE_INVALID", "Bitte eine gültige Hausnummer eingeben.");
  }

  return { customer, phone, plz, street, minimum: Math.max(0, number(minimums[plz], 0)) };
}

function validateMinimum(pricing: any, customer: ReturnType<typeof validateCustomer>) {
  if (!("minimum" in customer)) return;
  const minimum = Math.max(0, number(customer.minimum, 0));

  const pfandCents = Math.max(
    0,
    Math.round(number(pricing?.pricingMeta?.surcharges?.pfand, 0) * 100),
  );
  const qualifyingCents = Math.max(0, Math.round(number(pricing?.orderBeforeTipCents, 0)) - pfandCents);
  const minimumCents = Math.round(minimum * 100);

  if (qualifyingCents < minimumCents) {
    throw new OrderValidationError(
      "ORDER_MINIMUM_NOT_MET",
      `Mindestbestellwert für ${customer.plz}: ${minimum.toFixed(2)}€.`,
      409,
      {
        plz: customer.plz,
        minimum,
        qualifyingTotal: +(qualifyingCents / 100).toFixed(2),
      },
    );
  }
}

function validateAvailability(order: any, settings: any, mode: OrderMode) {
  const config = planFromSettings(settings?.hours);
  const hours = object(settings?.hours);
  const configuredWeek = object(mode === "pickup" ? hours.pickup : hours.delivery);
  if (!Object.keys(configuredWeek).length) {
    config.plan = DEFAULT_PLAN;
  }
  const now = nowInTZ(config.tz);
  const forceClosed = settings?.hours?.forceClosed === true;
  const plannedRaw = order?.planned ?? order?.plannedTime;
  const hasPlanned = plannedRaw !== undefined && plannedRaw !== null && text(plannedRaw) !== "";
  const planned = hasPlanned ? normalizePlanned(plannedRaw) : "";

  if (forceClosed) {
    throw new OrderValidationError("ORDER_SITE_CLOSED", "Heute sind Online-Bestellungen geschlossen.", 409);
  }

  if (!hasPlanned) {
    if (!isOpenAt(mode, now, config.plan, config.tz).open) {
      throw new OrderValidationError(
        "ORDER_PLANNED_REQUIRED",
        "Der Betrieb ist derzeit geschlossen. Bitte eine verfügbare Vorbestellzeit wählen.",
        409,
      );
    }
    return;
  }

  if (!planned) {
    throw new OrderValidationError("ORDER_PLANNED_INVALID", "Die gewählte Vorbestellzeit ist ungültig.");
  }

  const result = validatePlannedTime(mode, todayAt(planned, config.tz), {
    plan: config.plan,
    tz: config.tz,
    leadPickupMin: Math.max(1, number(settings?.hours?.avgPickupMinutes, 15)),
    leadDeliveryMin: Math.max(1, number(settings?.hours?.avgDeliveryMinutes, 35)),
    lastOrderBufferMin: 15,
    siteClosed: false,
    allowPreorder: settings?.hours?.allowPreorder !== false,
    daysAhead: config.daysAhead,
  });

  if (!result.ok) {
    throw new OrderValidationError("ORDER_PLANNED_UNAVAILABLE", result.reason, 409);
  }
}

export async function validateOrderForCheckout(params: {
  tenantId: string;
  order: any;
  settings: any;
  pricing: any;
}) {
  const mode = modeFrom(params.pricing?.mode ?? params.order?.mode);
  const customer = validateCustomer(params.order, params.settings, mode);
  validateMinimum(params.pricing, customer);

  const pause = await readPauseState(params.tenantId);
  if (pause[mode]) {
    throw new OrderValidationError(
      "ORDER_MODE_PAUSED",
      mode === "pickup"
        ? "Abholung ist vorübergehend pausiert."
        : "Lieferung ist vorübergehend pausiert.",
      409,
    );
  }

  validateAvailability(params.order, params.settings, mode);
  return { mode, customer };
}
