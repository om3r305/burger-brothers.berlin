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
  | "school"
  | "vegan"
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
  | "school-report"
  | "school-start"
  | "vegan-week"
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
  "school-report": {
    key: "school-report",
    label: "Karne / Zeugnis hediyesi",
    theme: "school",
    emoji: "🎓",
    title: "ZEUGNIS GESCHAFFT? DAS MUSS GEFEIERT WERDEN!",
    body: "Starke Leistung verdient eine leckere Belohnung. Feiert euren Erfolg gemeinsam bei Burger Brothers.",
    badge: "ZEUGNIS-BELOHNUNG",
    scheduleLabel: "25 Ocak–5 Şubat · Berlin tarihini kontrol et",
  },
  "school-start": {
    key: "school-start",
    label: "Okula dönüş / Schulstart",
    theme: "school",
    emoji: "⭐",
    title: "EIN STARKER START INS NEUE SCHULJAHR",
    body: "Wir wünschen allen Schülerinnen und Schülern einen großartigen Start – mit Mut, Freude und gutem Geschmack.",
    badge: "SCHULSTART IN BERLIN",
    scheduleLabel: "20 Ağustos–10 Eylül · Berlin tarihini kontrol et",
  },
  "vegan-week": {
    key: "vegan-week",
    label: "Vegan Week",
    theme: "vegan",
    emoji: "🌱",
    title: "PFLANZLICH. SAFTIG. RICHTIG LECKER.",
    body: "Entdecke unsere veganen Favoriten und genieße vollen Burger-Geschmack – ganz ohne Kompromisse.",
    badge: "VEGAN WEEK",
    scheduleLabel: "28 Ekim–7 Kasım",
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
    case "school-report": return fixedRange(date, 1, 25, 2, 5);
    case "school-start": return fixedRange(date, 8, 20, 9, 10);
    case "vegan-week": return fixedRange(date, 10, 28, 11, 7);
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
  | "drizzle"
  | "storm"
  | "snowCold"
  | "fog"
  | "windy"
  | "hot"
  | "lateNight"
  | "evening"
  | "lunch"
  | "cloudy"
  | "sunny";

export const DEFAULT_WEATHER_MESSAGES: Record<WeatherCopyKey, string> = {
  rainMorning: "Tegel macht heute auf Dusche. Wir halten mit heißen Burgern dagegen.",
  rainEvening: "Wenn Berlin draußen plätschert, darf drinnen der Cheddar schmelzen.",
  drizzle: "Ein bisschen Nieselregen? Perfektes Wetter für eine richtig gute Burgerpause.",
  storm: "Draußen macht der Himmel Theater. Drinnen übernimmt nur der Geschmack.",
  snowCold: "Schneeflocken draußen, Käsefäden drinnen – fairer Tausch, oder?",
  fog: "Tegel versteckt sich im Nebel. Den Weg zum Burger findet man trotzdem.",
  windy: "Berlin pustet heute ordentlich. Wir halten Burger und Pommes für dich fest.",
  hot: "Berlin hat den Grill aufgedreht. Die Drinks stehen schon eiskalt.",
  lateNight: "Der Tag ist durch. Dein Burger muss es noch lange nicht sein.",
  evening: "Feierabend fragt: Sofa oder Burger? Wir sagen ganz klar: beides.",
  lunch: "Kurze Pause, große Entscheidung: mit oder ohne extra Cheddar?",
  cloudy: "Tegel trägt heute Grau. Unsere Pommes bleiben Gold.",
  sunny: "Sonne über Tegel – heute darf selbst der Burger kurz posieren.",
};

const WEATHER_MESSAGE_VARIANTS: Record<WeatherCopyKey, readonly string[]> = {
  rainMorning: [
    DEFAULT_WEATHER_MESSAGES.rainMorning,
    "Regenschirm auf, App auf, Burger auswählen – so geht Wetterplanung in Tegel.",
    "Berlin gießt die Straßen. Wir kümmern uns um etwas deutlich Leckereres.",
  ],
  rainEvening: [
    DEFAULT_WEATHER_MESSAGES.rainEvening,
    "Nasse Straßen, warmer Burger, trockene Couch. Klingt nach einem Plan.",
    "Der Regen klopft ans Fenster. Wir lieber mit einer heißen Bestellung.",
  ],
  drizzle: [
    DEFAULT_WEATHER_MESSAGES.drizzle,
    "Das Wetter kann sich nicht entscheiden. Beim Burger helfen wir gern.",
    "Ein paar Tropfen draußen, ganz viel Geschmack drinnen.",
  ],
  storm: [
    DEFAULT_WEATHER_MESSAGES.storm,
    "Blitz und Donner können laut sein. Unser Burger überzeugt ohne Geschrei.",
    "Heute knallt nur das Wetter – und vielleicht der erste Biss.",
  ],
  snowCold: [
    DEFAULT_WEATHER_MESSAGES.snowCold,
    "Kalte Hände? Burger Brothers hat da eine ziemlich warme Antwort.",
    "Tegel wird zum Winterfilm. Der Burger übernimmt die Hauptrolle.",
  ],
  fog: [
    DEFAULT_WEATHER_MESSAGES.fog,
    "Draußen wenig Sicht, bei uns klare Sache: frisch, heiß, lecker.",
    "Der Nebel macht geheimnisvoll. Unsere Burger verraten trotzdem alles.",
  ],
  windy: [
    DEFAULT_WEATHER_MESSAGES.windy,
    "Heute fliegt fast alles – außer dein Burger, den passen wir gut auf.",
    "Kräftiger Wind in Tegel. Zeit für etwas, das wirklich Bodenhaftung hat.",
  ],
  hot: [
    DEFAULT_WEATHER_MESSAGES.hot,
    "Sonne satt, Drinks kalt, Burger saftig. Mehr Sommer braucht Tegel nicht.",
    "Heißer Tag? Extra Eis im Drink, extra Geschmack im Burger.",
  ],
  lateNight: [
    DEFAULT_WEATHER_MESSAGES.lateNight,
    "Tegel wird leiser. Dein Hunger offenbar nicht – verstehen wir.",
    "Schon spät? Für eine gute Burgeridee ist es erstaunlich selten zu spät.",
  ],
  evening: [
    DEFAULT_WEATHER_MESSAGES.evening,
    "Der Arbeitstag ist vorbei. Jetzt beginnt der leckere Teil.",
    "Abend in Berlin: Füße hoch, Burger ran.",
  ],
  lunch: [
    DEFAULT_WEATHER_MESSAGES.lunch,
    "Mittagspause ist kurz. Der gute Geschmack darf trotzdem groß sein.",
    "Der Magen hat abgestimmt. Das Ergebnis war ziemlich eindeutig: Burger.",
  ],
  cloudy: [
    DEFAULT_WEATHER_MESSAGES.cloudy,
    "Die Wolken sind grau. Unser Cheddar hat zum Glück andere Pläne.",
    "Kein Sonnenstrahl? Dann bringen wir eben das Gold auf den Teller.",
  ],
  sunny: [
    DEFAULT_WEATHER_MESSAGES.sunny,
    "Tegel strahlt. Wir legen beim Burger noch eine Portion drauf.",
    "Sonnenwetter und Burgerlaune – Berlin kann heute wirklich was.",
  ],
};

export function weatherMessageKey(weather: ShowcaseWeather | null | undefined, hour: number): WeatherCopyKey {
  const label = String(weather?.label || "").toLowerCase();
  const code = Number(weather?.weatherCode);
  const stormy = [95, 96, 99].includes(code) || label.includes("gewitter");
  const drizzle = [51, 53, 55, 56, 57].includes(code) || label.includes("niesel");
  const rainy = [61, 63, 65, 66, 67, 80, 81, 82].includes(code) || label.includes("regen") || label.includes("schauer");
  const snowy = label.includes("schnee");
  const foggy = label.includes("nebel");
  const cloudy = label.includes("bewölkt") || label.includes("wolk") || label.includes("bedeckt");
  const temperature = weather && Number.isFinite(weather.temperature) ? Math.round(weather.temperature) : null;
  if (stormy) return "storm";
  if (drizzle) return "drizzle";
  if (rainy) return hour >= 17 ? "rainEvening" : "rainMorning";
  if (snowy || (temperature != null && temperature <= 4)) return "snowCold";
  if (foggy) return "fog";
  if (Number(weather?.windGusts || weather?.windSpeed || 0) >= 45) return "windy";
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
  const custom = String(overrides?.[key] || "").trim();
  if (custom) return custom;

  const variants = WEATHER_MESSAGE_VARIANTS[key];
  const weatherSeed = Number(weather?.weatherCode || 0);
  const dateSeed =
    date.getFullYear() * 372 +
    (date.getMonth() + 1) * 31 +
    date.getDate() +
    Math.floor(date.getHours() / 3);
  return variants[Math.abs(dateSeed + weatherSeed) % variants.length];
}
