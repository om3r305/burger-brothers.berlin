import type { ShowcaseScene, ShowcaseWeekday } from "./types";

export const SHOWCASE_SCHEDULE_TIMEZONE = "Europe/Berlin";
export const DEFAULT_SHOWCASE_WEEKDAYS: ShowcaseWeekday[] = [1, 2, 3, 4, 5];

export const SHOWCASE_WEEKDAY_OPTIONS: Array<{
  value: ShowcaseWeekday;
  short: string;
  label: string;
}> = [
  { value: 1, short: "Pzt", label: "Pazartesi" },
  { value: 2, short: "Sal", label: "Salı" },
  { value: 3, short: "Çar", label: "Çarşamba" },
  { value: 4, short: "Per", label: "Perşembe" },
  { value: 5, short: "Cum", label: "Cuma" },
  { value: 6, short: "Cmt", label: "Cumartesi" },
  { value: 7, short: "Paz", label: "Pazar" },
];

type ZonedClock = {
  weekday: ShowcaseWeekday;
  minutes: number;
  formatted: string;
};

const WEEKDAY_BY_NAME: Record<string, ShowcaseWeekday> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function safeTimeZone(value?: string) {
  const candidate = String(value || SHOWCASE_SCHEDULE_TIMEZONE).trim();
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return SHOWCASE_SCHEDULE_TIMEZONE;
  }
}

function timeToMinutes(value?: string, fallback = "00:00") {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ""));
  const selected = match || /^([01]\d|2[0-3]):([0-5]\d)$/.exec(fallback);
  if (!selected) return 0;
  return Number(selected[1]) * 60 + Number(selected[2]);
}

function previousWeekday(day: ShowcaseWeekday): ShowcaseWeekday {
  return (day === 1 ? 7 : day - 1) as ShowcaseWeekday;
}

export function getShowcaseZonedClock(
  now = Date.now(),
  timeZone = SHOWCASE_SCHEDULE_TIMEZONE,
): ZonedClock {
  const date = new Date(now);
  const zone = safeTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = WEEKDAY_BY_NAME[values.weekday] || 1;
  const hour = Number(values.hour || 0);
  const minute = Number(values.minute || 0);

  const formatted = new Intl.DateTimeFormat("tr-TR", {
    timeZone: zone,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);

  return {
    weekday,
    minutes: hour * 60 + minute,
    formatted,
  };
}

export function weeklyScheduleIsActive(scene: ShowcaseScene, now = Date.now()) {
  if (!scene.weeklyScheduleEnabled) return true;

  const days = Array.isArray(scene.weeklyScheduleDays)
    ? scene.weeklyScheduleDays
    : DEFAULT_SHOWCASE_WEEKDAYS;
  if (!days.length) return false;

  const daySet = new Set(days);
  const clock = getShowcaseZonedClock(
    now,
    scene.scheduleTimezone || SHOWCASE_SCHEDULE_TIMEZONE,
  );
  const start = timeToMinutes(scene.weeklyStartTime, "10:00");
  const end = timeToMinutes(scene.weeklyEndTime, "16:00");

  // Aynı başlangıç/bitiş saati seçilirse seçili günün tamamı aktif kabul edilir.
  if (start === end) return daySet.has(clock.weekday);

  if (start < end) {
    return daySet.has(clock.weekday) &&
      clock.minutes >= start &&
      clock.minutes < end;
  }

  // Gece yarısını aşan program: örn. Pazartesi 20:00 -> Salı 02:00.
  if (clock.minutes >= start) return daySet.has(clock.weekday);
  return clock.minutes < end && daySet.has(previousWeekday(clock.weekday));
}

export function describeShowcaseWeeklySchedule(
  scene: ShowcaseScene,
  now = Date.now(),
) {
  const zone = scene.scheduleTimezone || SHOWCASE_SCHEDULE_TIMEZONE;
  const clock = getShowcaseZonedClock(now, zone);

  if (!scene.weeklyScheduleEnabled) {
    return {
      active: true,
      currentTime: clock.formatted,
      summary: "Her gün, her saat gösterilir",
      status: "Program kapalı — sahne her zaman yayında",
    };
  }

  const days = Array.isArray(scene.weeklyScheduleDays)
    ? scene.weeklyScheduleDays
    : DEFAULT_SHOWCASE_WEEKDAYS;
  const dayLabels = SHOWCASE_WEEKDAY_OPTIONS
    .filter((option) => days.includes(option.value))
    .map((option) => option.short)
    .join(", ");
  const start = scene.weeklyStartTime || "10:00";
  const end = scene.weeklyEndTime || "16:00";
  const active = weeklyScheduleIsActive(scene, now);

  return {
    active,
    currentTime: clock.formatted,
    summary: `${dayLabels || "Gün seçilmedi"} · ${start}–${end}`,
    status: active
      ? "Şu anda gösterilir"
      : "Şu anda program dışında — TV bu sahneyi atlar",
  };
}
