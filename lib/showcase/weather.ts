import type {
  ShowcaseWeather,
  ShowcaseWeatherCondition,
} from "./types";

export type ShowcaseWeatherPresentation = {
  condition: ShowcaseWeatherCondition;
  label: string;
  emoji: string;
};

function finiteCode(value: unknown) {
  const code = Math.round(Number(value));
  return Number.isFinite(code) ? code : 2;
}

export function weatherPresentation(
  rawCode: unknown,
  isDay = true,
): ShowcaseWeatherPresentation {
  const code = finiteCode(rawCode);

  if (code === 0) {
    return {
      condition: "clear",
      label: isDay ? "Sonnig" : "Klarer Himmel",
      emoji: isDay ? "☀️" : "🌙",
    };
  }

  if (code === 1 || code === 2) {
    return {
      condition: "partly-cloudy",
      label: code === 1 ? "Überwiegend klar" : "Leicht bewölkt",
      emoji: isDay ? "🌤️" : "☁️",
    };
  }

  if (code === 3) {
    return { condition: "cloudy", label: "Bedeckt", emoji: "☁️" };
  }

  if (code === 45 || code === 48) {
    return { condition: "fog", label: "Nebel", emoji: "🌫️" };
  }

  if ([51, 53, 55, 56, 57].includes(code)) {
    return {
      condition: "drizzle",
      label: code >= 56 ? "Gefrierender Nieselregen" : "Nieselregen",
      emoji: "🌦️",
    };
  }

  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return {
      condition: "snow",
      label: code >= 85 ? "Schneeschauer" : "Schneefall",
      emoji: "❄️",
    };
  }

  if ([95, 96, 99].includes(code)) {
    return {
      condition: "storm",
      label: code >= 96 ? "Gewitter mit Hagel" : "Gewitter",
      emoji: "⛈️",
    };
  }

  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    return {
      condition: "rain",
      label: code >= 80 ? "Regenschauer" : "Regen",
      emoji: "🌧️",
    };
  }

  return {
    condition: "partly-cloudy",
    label: "Wechselhaft",
    emoji: "🌤️",
  };
}

export function normalizedWeatherCondition(
  weather: ShowcaseWeather | null | undefined,
): ShowcaseWeatherCondition {
  if (weather?.condition) return weather.condition;
  return weatherPresentation(weather?.weatherCode, weather?.isDay !== false)
    .condition;
}

export function weatherHasPrecipitation(
  weather: ShowcaseWeather | null | undefined,
) {
  const condition = normalizedWeatherCondition(weather);
  return (
    condition === "drizzle" ||
    condition === "rain" ||
    condition === "storm" ||
    condition === "snow"
  );
}
