import type { ShowcaseScene, ShowcaseWeather } from "./types";

export type SpecialDayTheme =
  | "classic"
  | "love"
  | "mother"
  | "father"
  | "halloween"
  | "christmas"
  | "new-year"
  | "easter"
  | "germany"
  | "berlin"
  | "celebration"
  | "winter";

export type SpecialDayPresetKey =
  | "classic"
  | "love"
  | "mother"
  | "father"
  | "women-berlin"
  | "easter"
  | "may-day"
  | "germany-unity"
  | "oktoberfest"
  | "halloween"
  | "st-martin"
  | "advent"
  | "nikolaus"
  | "christmas"
  | "new-year"
  | "berlin"
  | "winter"
  | "celebration";

export type SpecialDayPreset = {
  key: SpecialDayPresetKey;
  label: string;
  theme: SpecialDayTheme;
  emoji: string;
  title: string;
  body: string;
  badge?: string;
  scheduleLabel: string;
};

export const SPECIAL_DAY_PRESETS: Record<SpecialDayPresetKey, SpecialDayPreset> = {
  classic: {
    key: "classic",
    label: "Manuel / Klasik",
    theme: "classic",
    emoji: "✨",
    title: "EIN BESONDERER TAG",
    body: "Heute ist ein guter Tag für einen richtig guten Burger.",
    scheduleLabel: "Manuel tarih",
  },
  love: {
    key: "love",
    label: "Sevgililer Günü / Valentinstag",
    theme: "love",
    emoji: "💝",
    title: "LIEBE GEHT DURCH DEN MAGEN",
    body: "Feiert den Valentinstag mit Burgern, die man teilen möchte. Oder auch nicht.",
    badge: "14. FEBRUAR",
    scheduleLabel: "10–14 Şubat",
  },
  mother: {
    key: "mother",
    label: "Anneler Günü / Muttertag",
    theme: "mother",
    emoji: "🌷",
    title: "ALLES LIEBE ZUM MUTTERTAG",
    body: "Heute sagen wir Danke – mit ganz viel Liebe und gutem Geschmack.",
    badge: "DANKE, MAMA",
    scheduleLabel: "Mayıs ayının 2. pazarı ± 3 gün",
  },
  father: {
    key: "father",
    label: "Babalar Günü / Vatertag",
    theme: "father",
    emoji: "🍔",
    title: "ALLES GUTE ZUM VATERTAG",
    body: "Ein starker Tag verdient einen starken Burger.",
    badge: "VATERTAG",
    scheduleLabel: "Christi Himmelfahrt ± 2 gün",
  },
  "women-berlin": {
    key: "women-berlin",
    label: "Berlin Dünya Kadınlar Günü",
    theme: "love",
    emoji: "💜",
    title: "ALLES GUTE ZUM FRAUENTAG",
    body: "Berlin feiert starke Frauen – wir feiern mit Geschmack.",
    badge: "8. MÄRZ · BERLIN",
    scheduleLabel: "6–8 Mart",
  },
  easter: {
    key: "easter",
    label: "Paskalya / Ostern",
    theme: "easter",
    emoji: "🐣",
    title: "FROHE OSTERN",
    body: "Wir wünschen euch schöne Feiertage und eine besonders leckere Auszeit.",
    badge: "OSTERN",
    scheduleLabel: "Paskalya tarihine göre otomatik",
  },
  "may-day": {
    key: "may-day",
    label: "1 Mayıs / Tag der Arbeit",
    theme: "germany",
    emoji: "🌼",
    title: "SCHÖNEN 1. MAI",
    body: "Ein freier Tag, gute Gesellschaft und ein richtig guter Burger.",
    badge: "TAG DER ARBEIT",
    scheduleLabel: "30 Nisan–1 Mayıs",
  },
  "germany-unity": {
    key: "germany-unity",
    label: "Alman Birliği Günü",
    theme: "germany",
    emoji: "🇩🇪",
    title: "TAG DER DEUTSCHEN EINHEIT",
    body: "Gemeinsam feiern, gemeinsam genießen.",
    badge: "3. OKTOBER",
    scheduleLabel: "1–3 Ekim",
  },
  oktoberfest: {
    key: "oktoberfest",
    label: "Oktoberfest",
    theme: "celebration",
    emoji: "🥨",
    title: "OKTOBERFEST-GEFÜHL IN TEGEL",
    body: "Herzhafter Geschmack, goldene Pommes und gute Laune.",
    badge: "O'ZAPFT IS",
    scheduleLabel: "15 Eylül–6 Ekim",
  },
  halloween: {
    key: "halloween",
    label: "Cadılar Bayramı / Halloween",
    theme: "halloween",
    emoji: "🎃",
    title: "SCHAURIG GUTER GESCHMACK",
    body: "Heute wird es gruselig lecker bei Burger Brothers Berlin.",
    badge: "HALLOWEEN",
    scheduleLabel: "24–31 Ekim",
  },
  "st-martin": {
    key: "st-martin",
    label: "St. Martin",
    theme: "mother",
    emoji: "🏮",
    title: "EIN LICHT FÜR ST. MARTIN",
    body: "Teilen macht Freude – Pommes manchmal auch.",
    badge: "11. NOVEMBER",
    scheduleLabel: "9–11 Kasım",
  },
  advent: {
    key: "advent",
    label: "Advent",
    theme: "christmas",
    emoji: "🕯️",
    title: "EINE LECKERE ADVENTSZEIT",
    body: "Draußen leuchten die Lichter. Bei uns glüht der Grill.",
    badge: "ADVENT IN BERLIN",
    scheduleLabel: "1–17 Aralık",
  },
  nikolaus: {
    key: "nikolaus",
    label: "Nikolaus",
    theme: "christmas",
    emoji: "🎅",
    title: "SCHÖNEN NIKOLAUSTAG",
    body: "Heute gibt es gute Laune im Stiefel und Geschmack auf dem Teller.",
    badge: "6. DEZEMBER",
    scheduleLabel: "5–6 Aralık",
  },
  christmas: {
    key: "christmas",
    label: "Noel / Weihnachten",
    theme: "christmas",
    emoji: "🎄",
    title: "FROHE WEIHNACHTEN",
    body: "Wir wünschen euch genussvolle Feiertage voller Wärme, Freude und guter Burger.",
    badge: "FROHE FESTTAGE",
    scheduleLabel: "18–27 Aralık",
  },
  "new-year": {
    key: "new-year",
    label: "Yılbaşı / Silvester",
    theme: "new-year",
    emoji: "🎆",
    title: "GUTEN RUTSCH",
    body: "Auf ein neues Jahr voller Geschmack, Freude und gemeinsamer Burger-Momente.",
    badge: "SILVESTER",
    scheduleLabel: "28 Aralık–2 Ocak",
  },
  berlin: {
    key: "berlin",
    label: "Berlin özel günü",
    theme: "berlin",
    emoji: "🐻",
    title: "BERLIN, WIR FEIERN DICH",
    body: "Tegel, Geschmack und echte Berliner Burgerliebe.",
    badge: "BERLIN-TEGEL",
    scheduleLabel: "Manuel tarih",
  },
  winter: {
    key: "winter",
    label: "Kış / Winter",
    theme: "winter",
    emoji: "❄️",
    title: "WINTER IN BERLIN",
    body: "Draußen kalt. Drinnen heiß, frisch und käsig.",
    badge: "WINTERZEIT",
    scheduleLabel: "Aralık–Şubat",
  },
  celebration: {
    key: "celebration",
    label: "Genel kutlama",
    theme: "celebration",
    emoji: "🎉",
    title: "WIR HABEN ETWAS ZU FEIERN",
    body: "Feiert mit uns – natürlich mit richtig gutem Geschmack.",
    badge: "WIR FEIERN",
    scheduleLabel: "Manuel tarih",
  },
};

export function applySpecialDayPreset(key: SpecialDayPresetKey): Partial<ShowcaseScene> {
  const preset = SPECIAL_DAY_PRESETS[key] || SPECIAL_DAY_PRESETS.classic;
  return {
    messageVariant: "special-day",
    specialPreset: preset.key,
    specialTheme: preset.theme,
    specialEmoji: preset.emoji,
    title: preset.title,
    body: preset.body,
    badge: preset.badge || "",
  };
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
  const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month, day, 12, 0, 0, 0);
}

function sameLocalDay(date: Date, target: Date, toleranceDays = 0) {
  const start = new Date(target.getFullYear(), target.getMonth(), target.getDate() - toleranceDays).valueOf();
  const end = new Date(target.getFullYear(), target.getMonth(), target.getDate() + toleranceDays + 1).valueOf();
  return date.valueOf() >= start && date.valueOf() < end;
}

function fixedRange(date: Date, startMonth: number, startDay: number, endMonth: number, endDay: number) {
  const year = date.getFullYear();
  let start = new Date(year, startMonth - 1, startDay).valueOf();
  let end = new Date(year, endMonth - 1, endDay + 1).valueOf();
  if (end < start) {
    if (date.getMonth() + 1 <= endMonth) start = new Date(year - 1, startMonth - 1, startDay).valueOf();
    else end = new Date(year + 1, endMonth - 1, endDay + 1).valueOf();
  }
  return date.valueOf() >= start && date.valueOf() < end;
}

function secondSundayOfMay(year: number) {
  const first = new Date(year, 4, 1, 12);
  const firstSunday = 1 + ((7 - first.getDay()) % 7);
  return new Date(year, 4, firstSunday + 7, 12);
}

export function specialDayPresetIsActive(key: string | undefined, now = Date.now()) {
  const date = new Date(now);
  const year = date.getFullYear();
  switch (key) {
    case "love": return fixedRange(date, 2, 10, 2, 14);
    case "mother": return sameLocalDay(date, secondSundayOfMay(year), 3);
    case "father": {
      const ascension = easterSunday(year);
      ascension.setDate(ascension.getDate() + 39);
      return sameLocalDay(date, ascension, 2);
    }
    case "women-berlin": return fixedRange(date, 3, 6, 3, 8);
    case "easter": return sameLocalDay(date, easterSunday(year), 4);
    case "may-day": return fixedRange(date, 4, 30, 5, 1);
    case "germany-unity": return fixedRange(date, 10, 1, 10, 3);
    case "oktoberfest": return fixedRange(date, 9, 15, 10, 6);
    case "halloween": return fixedRange(date, 10, 24, 10, 31);
    case "st-martin": return fixedRange(date, 11, 9, 11, 11);
    case "advent": return fixedRange(date, 12, 1, 12, 17);
    case "nikolaus": return fixedRange(date, 12, 5, 12, 6);
    case "christmas": return fixedRange(date, 12, 18, 12, 27);
    case "new-year": return fixedRange(date, 12, 28, 1, 2);
    case "winter": return fixedRange(date, 12, 1, 2, 29);
    default: return true;
  }
}

export type WeatherCopyKey =
  | "rainMorning"
  | "rainEvening"
  | "snowCold"
  | "hot"
  | "lateNight"
  | "evening"
  | "lunch"
  | "cloudy"
  | "sunny";

export const DEFAULT_WEATHER_MESSAGES: Record<WeatherCopyKey, string> = {
  rainMorning: "Regen in Tegel? Zeit für einen heißen Burger.",
  rainEvening: "Draußen nass. Dein Burger kommt heiß nach Hause.",
  snowCold: "Kalt draußen. Heiß, frisch und käsig bei uns.",
  hot: "Burger heiß. Getränke eiskalt. So schmeckt der Sommer.",
  lateNight: "Später Hunger? Wir haben da eine sehr gute Idee.",
  evening: "Feierabend in Berlin. Jetzt fehlt nur noch der Burger.",
  lunch: "Mittagspause? Mach sie richtig lecker.",
  cloudy: "Grauer Himmel. Goldene Pommes. Gute Entscheidung.",
  sunny: "Sonne über Tegel. Zeit für einen richtig guten Burger.",
};

export function weatherMessageKey(weather: ShowcaseWeather | null | undefined, hour: number): WeatherCopyKey {
  const label = String(weather?.label || "").toLowerCase();
  const rainy = label.includes("regen") || label.includes("schauer") || label.includes("gewitter");
  const snowy = label.includes("schnee");
  const cloudy = label.includes("bewölkt") || label.includes("wolk") || label.includes("nebel");
  const temperature = weather && Number.isFinite(weather.temperature) ? Math.round(weather.temperature) : null;
  if (rainy) return hour >= 17 ? "rainEvening" : "rainMorning";
  if (snowy || (temperature != null && temperature <= 4)) return "snowCold";
  if (temperature != null && temperature >= 27) return "hot";
  if (hour >= 21 || hour < 5) return "lateNight";
  if (hour >= 17) return "evening";
  if (hour >= 11 && hour < 15) return "lunch";
  if (cloudy) return "cloudy";
  return "sunny";
}

export function resolveWeatherMessage(
  weather: ShowcaseWeather | null | undefined,
  date = new Date(),
  overrides?: Partial<Record<WeatherCopyKey, string>>,
) {
  const key = weatherMessageKey(weather, date.getHours());
  return String(overrides?.[key] || DEFAULT_WEATHER_MESSAGES[key]).trim();
}
