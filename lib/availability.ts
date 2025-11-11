// lib/availability.ts
// Gel-al (Abholung) / Teslimat (Lieferung) saat kontrol yardımcıları.
// PURE: Tarayıcı API’sine veya localStorage’a bağımlı değildir.

import type { OrderMode as Mode } from "@/components/types";
import type { SettingsV6, WeekSchedule, TimeRange } from "@/lib/settings";

/** Varsayılan saat dilimi (Settings yoksa) */
export const DEFAULT_TZ = "Europe/Berlin";

/** Haftanın günü 0=Mon … 6=Sun (ISO haftası mantığına uyduk) */
export type DayIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Bir günde birden çok açık pencere olabilsin diye dizi yaptık */
export type DayHours = TimeRange[] | null; // null → tüm gün kapalı

export type WeekHours = Record<DayIndex, DayHours>;

export type OpeningPlan = {
  /** Abholung için haftalık saatler */
  pickup: WeekHours;
  /** Lieferung için haftalık saatler */
  delivery: WeekHours;
  /**
   * Özel günler (örn. resmi tatiller) – ISO tarih "YYYY-MM-DD"
   * - null → tüm gün kapalı
   * - TimeRange[] → o gün özel saat pencereleri
   */
  specials?: Record<string, DayHours>;
};

/** Settings.hours → OpeningPlan adapter’i ve opsiyonlar */
export type AvailabilityConfig = {
  tz: string;
  plan: OpeningPlan;
  /** Ön sipariş aktif mi? (Settings.hours.allowPreorder) */
  allowPreorder: boolean;
  /** Slot süresi (dakika) – sadece slot üretirken kullanılır */
  slotMinutes: number;
  /** En fazla kaç gün ileriye plan? 0=sadece bugün */
  daysAhead: number;
};

/** Varsayılan plan (tek pencere/gün) – gerekirse override edin */
export const DEFAULT_PLAN: OpeningPlan = {
  pickup: {
    0: [{ start: "11:30", end: "22:00" }],
    1: [{ start: "11:30", end: "22:00" }],
    2: [{ start: "11:30", end: "22:00" }],
    3: [{ start: "11:30", end: "23:00" }],
    4: [{ start: "11:30", end: "23:00" }],
    5: [{ start: "12:00", end: "23:00" }],
    6: [{ start: "12:00", end: "22:00" }],
  },
  delivery: {
    0: [{ start: "12:00", end: "21:30" }],
    1: [{ start: "12:00", end: "21:30" }],
    2: [{ start: "12:00", end: "21:30" }],
    3: [{ start: "12:00", end: "22:30" }],
    4: [{ start: "12:00", end: "22:30" }],
    5: [{ start: "12:30", end: "22:30" }],
    6: [{ start: "12:30", end: "21:30" }],
  },
  specials: {
    // "2025-01-01": null,
    // "2025-12-24": [{ start: "12:00", end: "18:00" }],
  },
};

/** Settings.hours’ı OpeningPlan’e çevir (PURE) */
export function planFromSettings(hours?: SettingsV6["hours"]): AvailabilityConfig {
  const tz = (hours?.timezone || DEFAULT_TZ).trim() || DEFAULT_TZ;

  const wk = (ws?: WeekSchedule): WeekHours => {
    // DayIndex: 0=Mon … 6=Sun — Settings’te mon..sun
    const mapDay = (day?: TimeRange[] | null): DayHours => {
      if (day == null) return null;
      const arr = Array.isArray(day) ? day : [];
      const norm = arr
        .map((r) => safeTimeRange(r))
        .filter((r): r is TimeRange => !!r && r.start < r.end);
      return norm.length ? norm : null;
    };
    return {
      0: mapDay(ws?.mon),
      1: mapDay(ws?.tue),
      2: mapDay(ws?.wed),
      3: mapDay(ws?.thu),
      4: mapDay(ws?.fri),
      5: mapDay(ws?.sat),
      6: mapDay(ws?.sun),
    };
  };

  const plan: OpeningPlan = {
    pickup: wk(hours?.pickup),
    delivery: wk(hours?.delivery),
    specials: undefined,
  };

  return {
    tz,
    plan,
    allowPreorder: !!hours?.allowPreorder,
    slotMinutes: Math.max(1, Number(hours?.slotMinutes ?? 15)),
    daysAhead: Math.max(0, Number(hours?.daysAhead ?? 0)),
  };
}

/** TimeRange sanitizasyonu (örn. "8:0" → "08:00") */
function safeTimeRange(r?: TimeRange | null): TimeRange | null {
  if (!r || !r.start || !r.end) return null;
  const s = normHHMM(r.start);
  const e = normHHMM(r.end);
  if (!s || !e) return null;
  if (s >= e) return null;
  return { start: s, end: e };
}

/* =================== Zaman yardımcıları (TZ) =================== */

function pad2(n: number) { return n < 10 ? `0${n}` : String(n); }

export function isoDateInTZ(d: Date, tz: string): string {
  const dd = new Date(d.toLocaleString("en-US", { timeZone: tz }));
  const y = dd.getFullYear();
  const m = dd.getMonth() + 1;
  const day = dd.getDate();
  return `${y}-${pad2(m)}-${pad2(day)}`;
}

export function nowInTZ(tz: string): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: tz }));
}

function timeOn(dateInTZ: Date, hhmm: string, tz: string): Date {
  const [hh, mm] = hhmm.split(":").map((v) => parseInt(v, 10));
  const y = dateInTZ.getFullYear();
  const m = dateInTZ.getMonth();
  const d = dateInTZ.getDate();
  const isoLocal = `${y}-${pad2(m + 1)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}:00`;
  const fixed = new Date(new Date(`${isoLocal} GMT`).toLocaleString("en-US", { timeZone: tz }));
  return isNaN(fixed.getTime()) ? new Date(isoLocal) : fixed;
}

function dayIndexInTZ(d: Date, tz: string): DayIndex {
  const local = new Date(d.toLocaleString("en-US", { timeZone: tz }));
  const js = local.getDay(); // 0=Sun..6=Sat
  return (((js + 6) % 7) as DayIndex); // Mon=0..Sun=6
}

function normHHMM(s?: string): `${number}:${number}` | null {
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const hh = Math.max(0, Math.min(23, parseInt(m[1], 10)));
  const mm = Math.max(0, Math.min(59, parseInt(m[2], 10)));
  return `${pad2(hh)}:${pad2(mm)}` as `${number}:${number}`;
}

/* =================== Pencere & açık/kapalı =================== */

export type Interval = { start: Date; end: Date };

function getWindowsFor(mode: Mode, atInTZ: Date, plan: OpeningPlan, tz: string): Interval[] {
  const iso = isoDateInTZ(atInTZ, tz);
  let ranges: DayHours | undefined = plan.specials?.[iso];
  if (ranges === undefined) {
    const day = dayIndexInTZ(atInTZ, tz);
    ranges = mode === "pickup" ? plan.pickup[day] : plan.delivery[day];
  }
  if (!ranges || !ranges.length) return [];
  return ranges.map((r) => ({
    start: timeOn(atInTZ, r.start, tz),
    end: timeOn(atInTZ, r.end, tz),
  }));
}

export function isOpenAt(
  mode: Mode,
  at: Date = nowInTZ(DEFAULT_TZ),
  plan: OpeningPlan = DEFAULT_PLAN,
  tz: string = DEFAULT_TZ
): { open: boolean; window?: Interval } {
  const wins = getWindowsFor(mode, at, plan, tz);
  for (const w of wins) {
    if (at >= w.start && at <= w.end) return { open: true, window: w };
  }
  return wins.length ? { open: false, window: wins[0] } : { open: false };
}

export function nextOpenWindow(
  mode: Mode,
  from: Date = nowInTZ(DEFAULT_TZ),
  plan: OpeningPlan = DEFAULT_PLAN,
  tz: string = DEFAULT_TZ,
  maxDaysScan = 7
): Interval | null {
  const base = new Date(from.toLocaleString("en-US", { timeZone: tz }));
  for (let i = 0; i <= maxDaysScan; i++) {
    const probe = new Date(base);
    probe.setDate(probe.getDate() + i);
    const wins = getWindowsFor(mode, probe, plan, tz);
    if (!wins.length) continue;

    if (i === 0) {
      for (const w of wins) {
        if (from <= w.end) return { start: w.start, end: w.end };
      }
    } else {
      return { start: wins[0].start, end: wins[0].end };
    }
  }
  return null;
}

/* =================== Planlı zaman doğrulama =================== */

export type ValidateOpts = {
  leadPickupMin?: number;
  leadDeliveryMin?: number;
  lastOrderBufferMin?: number;
  plan?: OpeningPlan;
  tz?: string;
  siteClosed?: boolean;
  allowPreorder?: boolean;
  daysAhead?: number;
};

export type ValidationResult =
  | { ok: true; reason?: undefined; suggest?: undefined; window: Interval }
  | { ok: false; reason: string; suggest?: Date; window?: Interval };

export function validatePlannedTime(
  mode: Mode,
  plannedAt: Date,
  opts: ValidateOpts = {}
): ValidationResult {
  const {
    plan = DEFAULT_PLAN,
    tz = DEFAULT_TZ,
    leadPickupMin = 15,
    leadDeliveryMin = 35,
    lastOrderBufferMin = 15,
    siteClosed = false,
    allowPreorder = true,
    daysAhead = 0,
  } = opts;

  if (siteClosed) return { ok: false, reason: "Heute geschlossen." };

  const now = nowInTZ(tz);
  const leadMin = mode === "pickup" ? leadPickupMin : leadDeliveryMin;

  if (!allowPreorder) {
    const open = isOpenAt(mode, now, plan, tz);
    if (!open.open) return { ok: false, reason: "Derzeit geschlossen (Vorbestellung deaktiviert)." };
    if (isoDateInTZ(now, tz) !== isoDateInTZ(plannedAt, tz)) {
      return { ok: false, reason: "Nur heute verfügbar (Vorbestellung deaktiviert)." };
    }
  }

  if (daysAhead >= 0) {
    const dNow = isoDateInTZ(now, tz);
    const dPln = isoDateInTZ(plannedAt, tz);
    const diffDays = dateDiffInDays(dNow, dPln);
    if (diffDays > daysAhead) {
      const next = nextOpenWindow(mode, now, plan, tz);
      return { ok: false, reason: `Nur bis ${daysAhead} Tag(e) im Voraus.`, suggest: next?.start };
    }
  }

  const minAllowed = new Date(now.getTime() + leadMin * 60 * 1000);
  if (plannedAt < minAllowed) {
    const next = nextOpenWindow(mode, minAllowed, plan, tz);
    const suggest = next ? new Date(Math.max(next.start.getTime(), minAllowed.getTime())) : undefined;
    return {
      ok: false,
      reason:
        mode === "pickup"
          ? `Abholzeit zu früh. Minimum Vorlauf ${leadPickupMin} Min.`
          : `Lieferzeit zu früh. Minimum Vorlauf ${leadDeliveryMin} Min.`,
      suggest,
      window: next ?? undefined,
    };
  }

  const wins = getWindowsFor(mode, plannedAt, plan, tz);
  if (!wins.length) {
    const next = nextOpenWindow(mode, plannedAt, plan, tz);
    return { ok: false, reason: "An diesem Tag geschlossen.", suggest: next?.start };
  }

  for (const w of wins) {
    const lastAccept = new Date(w.end.getTime() - lastOrderBufferMin * 60 * 1000);
    if (plannedAt < w.start) {
      return {
        ok: false,
        reason: "Vor Öffnungszeit.",
        suggest: new Date(Math.max(minAllowed.getTime(), w.start.getTime())),
        window: w,
      };
    }
    if (plannedAt >= w.start && plannedAt <= lastAccept) {
      return { ok: true, window: w };
    }
    if (plannedAt > lastAccept && plannedAt <= w.end) {
      const next = nextOpenWindow(mode, plannedAt, plan, tz);
      return {
        ok: false,
        reason: `Zu nah an der Schließzeit (letzte Annahme ${lastOrderBufferMin} Min vorher).`,
        suggest: next?.start,
        window: w,
      };
    }
  }

  const next = nextOpenWindow(mode, plannedAt, plan, tz);
  return { ok: false, reason: "Außerhalb der Öffnungszeiten.", suggest: next?.start };
}

/* =================== UI helpers & slot üretim =================== */

export function statusLabel(
  mode: Mode,
  at: Date = nowInTZ(DEFAULT_TZ),
  plan: OpeningPlan = DEFAULT_PLAN,
  tz: string = DEFAULT_TZ
): { open: boolean; text: string; window?: Interval } {
  const st = isOpenAt(mode, at, plan, tz);
  if (st.open && st.window) {
    return { open: true, text: `Geöffnet bis ${fmtTime(st.window.end, tz)} (${mode === "pickup" ? "Abholung" : "Lieferung"})`, window: st.window };
  }
  const next = nextOpenWindow(mode, at, plan, tz);
  if (next) {
    return { open: false, text: `Geschlossen – öffnet um ${fmtTime(next.start, tz)} (${mode === "pickup" ? "Abholung" : "Lieferung"})`, window: next };
  }
  return { open: false, text: "Heute geschlossen" };
}

export function fmtTime(d: Date, tz: string = DEFAULT_TZ): string {
  const dd = new Date(d.toLocaleString("de-DE", { timeZone: tz }));
  const hh = pad2(dd.getHours());
  const mm = pad2(dd.getMinutes());
  return `${hh}:${mm}`;
}

export function buildSlotsForDate(
  mode: Mode,
  dateInTZ: Date,
  cfg: {
    plan: OpeningPlan;
    tz?: string;
    slotMinutes?: number;
    leadPickupMin?: number;
    leadDeliveryMin?: number;
    lastOrderBufferMin?: number;
    allowPreorder?: boolean;
    daysAhead?: number;
  }
): Date[] {
  const tz = cfg.tz || DEFAULT_TZ;
  const slotMin = Math.max(1, Number(cfg.slotMinutes ?? 15));
  const now = nowInTZ(tz);
  const leadMin = mode === "pickup" ? (cfg.leadPickupMin ?? 15) : (cfg.leadDeliveryMin ?? 35);
  const minAllowed = new Date(now.getTime() + leadMin * 60 * 1000);

  if (cfg.allowPreorder === false) {
    const open = isOpenAt(mode, now, cfg.plan, tz);
    if (!open.open || !open.window) return [];
    if (isoDateInTZ(now, tz) !== isoDateInTZ(dateInTZ, tz)) return [];
  } else {
    const diff = dateDiffInDays(isoDateInTZ(now, tz), isoDateInTZ(dateInTZ, tz));
    if (diff > Math.max(0, Number(cfg.daysAhead ?? 0))) return [];
  }

  const wins = getWindowsFor(mode, dateInTZ, cfg.plan, tz);
  const out: Date[] = [];

  for (const w of wins) {
    const lastAccept = new Date(w.end.getTime() - (cfg.lastOrderBufferMin ?? 15) * 60 * 1000);
    for (let t = new Date(w.start); t <= lastAccept; t = new Date(t.getTime() + slotMin * 60 * 1000)) {
      if (t < minAllowed) continue;
      out.push(t);
    }
  }
  return out;
}

/** Dakika bazlı yukarı yuvarla (slot’a)—ör. 13:02 → 13:15 */
export function ceilToSlot(d: Date, slotMinutes: number): Date {
  const ms = Math.max(1, slotMinutes) * 60 * 1000;
  return new Date(Math.ceil(d.getTime() / ms) * ms);
}

/** “HH:MM” → Date (verilen gün & TZ) */
export function parseHHMMToDateInTZ(hhmm: string, baseDayInTZ: Date, tz: string): Date {
  const [hh, mm] = (hhmm || "00:00").split(":").map((n) => parseInt(n, 10) || 0);
  const y = baseDayInTZ.getFullYear();
  const m = baseDayInTZ.getMonth();
  const d = baseDayInTZ.getDate();
  const isoLocal = `${y}-${pad2(m + 1)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}:00`;
  const fixed = new Date(new Date(`${isoLocal} GMT`).toLocaleString("en-US", { timeZone: tz }));
  return isNaN(fixed.getTime()) ? new Date(isoLocal) : fixed;
}

/** Date → “HH:MM” (TZ) */
export function formatHHMMInTZ(d: Date, tz: string = DEFAULT_TZ): string {
  const dd = new Date(d.toLocaleString("en-US", { timeZone: tz }));
  return `${pad2(dd.getHours())}:${pad2(dd.getMinutes())}`;
}

/** En erken mümkün zamanı (lead + pencere + tamponlara göre) döndürür. */
export function earliestPossibleTime(
  mode: Mode,
  cfg: AvailabilityConfig,
  opts?: Pick<ValidateOpts, "leadPickupMin" | "leadDeliveryMin" | "lastOrderBufferMin">
): Date {
  const tz = cfg.tz || DEFAULT_TZ;
  const now = nowInTZ(tz);
  const leadPickupMin = opts?.leadPickupMin ?? 15;
  const leadDeliveryMin = opts?.leadDeliveryMin ?? 35;
  const lastBuffer = opts?.lastOrderBufferMin ?? 15;

  const minAllowed = new Date(now.getTime() + (mode === "pickup" ? leadPickupMin : leadDeliveryMin) * 60 * 1000);

  const vr = validatePlannedTime(mode, minAllowed, {
    plan: cfg.plan,
    tz,
    leadPickupMin,
    leadDeliveryMin,
    lastOrderBufferMin: lastBuffer,
    allowPreorder: true,
    daysAhead: cfg.daysAhead,
  });

  return vr.ok ? minAllowed : (vr.suggest ?? minAllowed);
}

function dateDiffInDays(isoA: string, isoB: string): number {
  const [aY, aM, aD] = isoA.split("-").map(Number);
  const [bY, bM, bD] = isoB.split("-").map(Number);
  const a = Date.UTC(aY, aM - 1, aD);
  const b = Date.UTC(bY, bM - 1, bD);
  return Math.round((b - a) / 86400000);
}
