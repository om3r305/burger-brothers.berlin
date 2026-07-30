"use client";

import type { CSSProperties } from "react";
import type { ShowcaseWeather } from "@/lib/showcase/types";
import { normalizedWeatherCondition } from "@/lib/showcase/weather";
import styles from "./WeatherExperience.module.css";

type Props = {
  weather?: ShowcaseWeather | null;
  title?: string;
  subtitle?: string;
  message: string;
};

const PARTICLES = Array.from({ length: 18 }, (_, index) => index);

function rounded(value: unknown, suffix = "") {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${Math.round(numeric)}${suffix}` : "–";
}

function particleStyle(index: number): CSSProperties {
  return {
    "--weather-x": `${(index * 37 + 9) % 101}%`,
    "--weather-delay": `${-((index * 0.43) % 3.8)}s`,
    "--weather-duration": `${1.15 + (index % 7) * 0.17}s`,
    "--weather-drift": `${(index % 2 ? 1 : -1) * (8 + (index % 5) * 7)}px`,
    "--weather-size": `${5 + (index % 5) * 2}px`,
  } as CSSProperties;
}

function WeatherSymbol({
  condition,
  isDay,
}: {
  condition: ReturnType<typeof normalizedWeatherCondition>;
  isDay: boolean;
}) {
  const hasCloud = condition !== "clear";
  const hasRain =
    condition === "drizzle" ||
    condition === "rain" ||
    condition === "storm";

  return (
    <svg
      className={styles.symbol}
      viewBox="0 0 180 150"
      aria-hidden="true"
    >
      {isDay ? (
        <circle className={styles.symbolSun} cx="64" cy="50" r="29" />
      ) : (
        <path
          className={styles.symbolMoon}
          d="M84 19c-26 8-37 39-22 61 12 18 36 24 55 12-8 20-32 34-56 27-31-9-47-44-32-72 11-20 34-32 55-28Z"
        />
      )}
      {hasCloud ? (
        <path
          className={styles.symbolCloud}
          d="M53 111h80c20 0 33-13 33-30 0-18-15-31-34-31-5-22-23-36-45-36-27 0-48 21-48 48v1C23 66 13 76 13 88c0 14 13 23 40 23Z"
        />
      ) : null}
      {hasRain ? (
        <g className={styles.symbolRain}>
          <path d="M54 120l-8 19" />
          <path d="M86 120l-8 19" />
          <path d="M118 120l-8 19" />
        </g>
      ) : null}
      {condition === "snow" ? (
        <g className={styles.symbolSnow}>
          <path d="M52 120v22M41 131h22M44 123l16 16M60 123l-16 16" />
          <path d="M102 120v22M91 131h22M94 123l16 16M110 123l-16 16" />
        </g>
      ) : null}
      {condition === "storm" ? (
        <path className={styles.symbolBolt} d="M101 95 77 126h19l-10 26 36-42h-20l13-15Z" />
      ) : null}
      {condition === "fog" ? (
        <g className={styles.symbolFog}>
          <path d="M34 116h104" />
          <path d="M51 132h91" />
        </g>
      ) : null}
    </svg>
  );
}

export default function WeatherExperience({
  weather,
  title,
  subtitle,
  message,
}: Props) {
  const condition = normalizedWeatherCondition(weather);
  const isDay = weather?.isDay !== false;
  const particleCount =
    condition === "rain" || condition === "storm"
      ? 18
      : condition === "drizzle"
        ? 12
        : condition === "snow"
          ? 16
          : 0;
  const temperature =
    weather && Number.isFinite(weather.temperature)
      ? `${Math.round(weather.temperature)}°`
      : "–°";

  return (
    <div
      className={styles.weather}
      data-condition={condition}
      data-daylight={isDay ? "day" : "night"}
      data-stale={weather?.stale ? "true" : "false"}
    >
      <div className={styles.atmosphere} aria-hidden="true">
        <div className={styles.celestial} />
        <div className={`${styles.cloud} ${styles.cloudOne}`} />
        <div className={`${styles.cloud} ${styles.cloudTwo}`} />
        <div className={`${styles.cloud} ${styles.cloudThree}`} />
        <div className={styles.fogBank}>
          <i />
          <i />
          <i />
        </div>
        <div className={styles.precipitation}>
          {PARTICLES.slice(0, particleCount).map((index) => (
            <i key={index} style={particleStyle(index)} />
          ))}
        </div>
        <div className={styles.lightning} />
        <div className={styles.horizonGlow} />
      </div>

      <main className={styles.layout}>
        <section className={styles.primary}>
          <div className={styles.locationRow}>
            <span className={styles.liveDot} />
            <strong>{weather?.locationLabel || "BERLIN-TEGEL"}</strong>
            <span>{weather?.stale ? "LETZTE MESSUNG" : "LIVE-WETTER"}</span>
          </div>

          <div className={styles.heroRow}>
            <WeatherSymbol condition={condition} isDay={isDay} />
            <div>
              <h1>{title || temperature}</h1>
              <div className={styles.condition}>
                {subtitle || weather?.label || "Wetter wird geladen"}
              </div>
            </div>
          </div>

          <blockquote>
            <span aria-hidden="true">“</span>
            {message || "Aktuelle Wetterdaten werden gerade geladen."}
          </blockquote>
        </section>

        <aside className={styles.metrics} aria-label="Wetterdetails">
          <div className={styles.metric}>
            <span>GEFÜHLT</span>
            <strong>{rounded(weather?.apparentTemperature, "°")}</strong>
          </div>
          <div className={styles.metric}>
            <span>HEUTE</span>
            <strong>
              {rounded(weather?.highTemperature, "°")}
              <small> / {rounded(weather?.lowTemperature, "°")}</small>
            </strong>
          </div>
          <div className={styles.metric}>
            <span>LUFT</span>
            <strong>{rounded(weather?.relativeHumidity, "%")}</strong>
          </div>
          <div className={styles.metric}>
            <span>WIND</span>
            <strong>{rounded(weather?.windSpeed)}</strong>
            <small>km/h</small>
          </div>
          <div className={styles.metric}>
            <span>NIEDERSCHLAG</span>
            <strong>{rounded(weather?.precipitation, " mm")}</strong>
          </div>
          <div className={styles.metric}>
            <span>AKTUALISIERT</span>
            <strong className={styles.updatedAt}>
              {weather?.updatedAt
                ? new Date(weather.updatedAt).toLocaleTimeString("de-DE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "–"}
            </strong>
          </div>
        </aside>
      </main>
    </div>
  );
}
