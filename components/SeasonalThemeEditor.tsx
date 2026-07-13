"use client";

import { useMemo, useState } from "react";
import {
  THEME_PRESETS,
  createRecommendedThemeSchedule,
  getThemePreset,
  getThemeScheduleStatus,
  normalizeThemeSettings,
  resolveActiveTheme,
  type ThemeId,
  type ThemeScheduleEntry,
  type ThemeScheduleStatus,
  type ThemeSettings,
} from "@/lib/themes";

function rid() {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return `theme-rule-${crypto.randomUUID()}`;
    }
  } catch {}

  return `theme-rule-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function toDateTimeLocal(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "";

  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toIso(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : undefined;
}

function statusUi(status: ThemeScheduleStatus) {
  const map = {
    active: {
      label: "Läuft",
      className:
        "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    },
    ending: {
      label: "Endet bald",
      className: "border-orange-500/40 bg-orange-500/10 text-orange-200",
    },
    upcoming: {
      label: "Geplant",
      className: "border-sky-500/40 bg-sky-500/10 text-sky-200",
    },
    ended: {
      label: "Beendet",
      className: "border-rose-500/40 bg-rose-500/10 text-rose-200",
    },
    inactive: {
      label: "Inaktiv",
      className: "border-stone-700 bg-stone-900/70 text-stone-300",
    },
  } as const;

  return map[status];
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border border-stone-700/60 bg-stone-950/40 px-3 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-stone-100">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-stone-400">
            {description}
          </span>
        ) : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={label}
      />
    </label>
  );
}

export default function SeasonalThemeEditor({
  value,
  onChange,
}: {
  value: any;
  onChange: (next: ThemeSettings) => void;
}) {
  const settings = useMemo(() => normalizeThemeSettings(value), [value]);
  const resolved = useMemo(
    () => resolveActiveTheme(settings, new Date()),
    [settings],
  );
  const [assetTheme, setAssetTheme] = useState<ThemeId>(settings.active);

  const commit = (patch: Partial<ThemeSettings>) => {
    onChange(
      normalizeThemeSettings({
        ...settings,
        ...patch,
      }),
    );
  };

  const updateSchedule = (next: ThemeScheduleEntry[]) => {
    commit({ schedule: next });
  };

  const updateEntry = (id: string, patch: Partial<ThemeScheduleEntry>) => {
    updateSchedule(
      settings.schedule.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : entry,
      ),
    );
  };

  const addEntry = () => {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    end.setDate(end.getDate() + 14);

    updateSchedule([
      ...settings.schedule,
      {
        id: rid(),
        name: "Neue Saison",
        theme: "halloween",
        enabled: false,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        repeatYearly: true,
        priority: 50,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
    ]);
  };

  const loadRecommended = () => {
    const accepted =
      typeof window === "undefined" ||
      window.confirm(
        "Empfohlenen Deutschland-Saisonkalender laden? Vorhandene Zeitplan-Regeln werden ersetzt. Logo- und Video-URLs bleiben erhalten.",
      );

    if (!accepted) return;

    commit({
      mode: "automatic",
      automatic: true,
      schedule: createRecommendedThemeSchedule(),
      snow: true,
      decorationsEnabled: true,
      motionEnabled: true,
    });
  };

  const selectedPreset = getThemePreset(assetTheme);
  const resolvedPreset = getThemePreset(resolved.theme);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-stone-700/60 bg-stone-950/35 p-4">
          <div className="mb-3">
            <div className="font-semibold">Steuerung</div>
            <div className="mt-1 text-xs leading-relaxed text-stone-400">
              Bei „Manuell“ bleibt das gewählte Design dauerhaft aktiv. Bei
              „Automatisch“ entscheidet der Zeitplan nach Datum und Priorität.
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                settings.mode === "manual"
                  ? "border-orange-400 bg-orange-500 text-black"
                  : "border-stone-700 bg-stone-900 text-stone-200"
              }`}
              onClick={() => commit({ mode: "manual", automatic: false })}
            >
              Manuell
            </button>
            <button
              type="button"
              className={`rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                settings.mode === "automatic"
                  ? "border-emerald-400 bg-emerald-500 text-black"
                  : "border-stone-700 bg-stone-900 text-stone-200"
              }`}
              onClick={() => commit({ mode: "automatic", automatic: true })}
            >
              Automatisch
            </button>
          </div>

          <label className="mt-4 block text-sm">
            <span className="mb-1 block text-stone-300">Fallback / manuelles Design</span>
            <select
              className="w-full rounded-xl border border-stone-700 bg-stone-950 px-3 py-3 outline-none"
              value={settings.active}
              onChange={(event) =>
                commit({ active: event.target.value as ThemeId })
              }
            >
              {THEME_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.icon} {preset.label}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <ToggleRow
              label="Dekorationen"
              description="Kürbisse, Lichter, Schnee und saisonale Details."
              checked={settings.decorationsEnabled}
              onChange={(decorationsEnabled) => commit({ decorationsEnabled })}
            />
            <ToggleRow
              label="Animationen"
              description="Wird bei Geräten mit reduzierter Bewegung automatisch beruhigt."
              checked={settings.motionEnabled}
              onChange={(motionEnabled) => commit({ motionEnabled })}
            />
            <ToggleRow
              label="Schnee"
              description="Schneefall für Christmas und Winter."
              checked={settings.snow}
              onChange={(snow) => commit({ snow })}
            />
          </div>
        </div>

        <div
          className="bb-theme-preview overflow-hidden rounded-2xl border p-4"
          data-preview-theme={resolved.theme}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-xs font-bold uppercase tracking-[0.18em] opacity-75">
                Aktuell aktiv
              </div>
              <div className="mt-2 text-xl font-black">
                {resolvedPreset.icon} {resolvedPreset.label}
              </div>
              <div className="mt-1 text-xs leading-relaxed opacity-80">
                {resolvedPreset.description}
              </div>
            </div>
            <span className="rounded-full border border-white/20 bg-black/20 px-2 py-1 text-[11px] font-semibold">
              {resolved.source === "schedule"
                ? "Zeitplan"
                : resolved.source === "manual"
                  ? "Manuell"
                  : "Fallback"}
            </span>
          </div>

          {resolved.scheduleName ? (
            <div className="mt-3 rounded-xl border border-white/15 bg-black/20 px-3 py-2 text-xs">
              Regel: <b>{resolved.scheduleName}</b>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-2">
            <button type="button" className="bb-theme-preview-button">
              {resolvedPreset.icon} Jetzt bestellen
            </button>
            <span className="bb-theme-preview-pill">Burger</span>
            <span className="bb-theme-preview-pill">Getränke</span>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-stone-700/60 bg-stone-950/35 p-4">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="font-semibold">Logo & Hintergrundvideo</div>
            <div className="mt-1 text-xs leading-relaxed text-stone-400">
              Für jedes Design können eigene Dateien hinterlegt werden. Leere Felder
              verwenden weiterhin das Hauptlogo und das Flame-Loop-Video.
            </div>
          </div>

          <select
            className="w-full rounded-xl border border-stone-700 bg-stone-950 px-3 py-2 text-sm sm:w-auto"
            value={assetTheme}
            onChange={(event) => setAssetTheme(event.target.value as ThemeId)}
          >
            {THEME_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.icon} {preset.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-3 rounded-xl border border-stone-700/50 bg-stone-900/60 px-3 py-2 text-sm">
          <b>{selectedPreset.icon} {selectedPreset.label}</b>
          <span className="ml-2 text-xs text-stone-400">
            {selectedPreset.description}
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-stone-300">Logo URL</span>
            <input
              className="w-full rounded-xl border border-stone-700 bg-stone-950 px-3 py-3 outline-none"
              value={settings.logos?.[assetTheme] || ""}
              onChange={(event) =>
                commit({
                  logos: {
                    ...settings.logos,
                    [assetTheme]: event.target.value,
                  },
                })
              }
              placeholder={`/logo-${assetTheme}.png`}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block text-stone-300">Video URL</span>
            <input
              className="w-full rounded-xl border border-stone-700 bg-stone-950 px-3 py-3 outline-none"
              value={settings.videos?.[assetTheme] || ""}
              onChange={(event) =>
                commit({
                  videos: {
                    ...settings.videos,
                    [assetTheme]: event.target.value,
                  },
                })
              }
              placeholder={`/themes/${assetTheme}/background.mp4`}
            />
          </label>
        </div>

        <label className="mt-4 block text-sm">
          <span className="mb-1 block text-stone-300">
            Globales Hintergrundvideo (Fallback)
          </span>
          <input
            className="w-full rounded-xl border border-stone-700 bg-stone-950 px-3 py-3 outline-none"
            value={settings.bgVideoUrl || ""}
            onChange={(event) => commit({ bgVideoUrl: event.target.value })}
            placeholder="/flames/flame-loop.mp4"
          />
        </label>
      </div>

      <div className="rounded-2xl border border-stone-700/60 bg-stone-950/35 p-4">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="font-semibold">Saison-Zeitplan</div>
            <div className="mt-1 text-xs leading-relaxed text-stone-400">
              Wenn mehrere Designs gleichzeitig passen, gewinnt die höchste Priorität.
              Regeln mit „Jährlich“ wiederholen sich jedes Jahr.
            </div>
          </div>

          <div className="grid grid-cols-1 gap-2 sm:flex">
            <button
              type="button"
              className="btn-ghost justify-center py-2"
              onClick={loadRecommended}
            >
              🇩🇪 Empfohlenen Kalender laden
            </button>
            <button
              type="button"
              className="card-cta justify-center py-2"
              onClick={addEntry}
            >
              + Regel
            </button>
          </div>
        </div>

        {settings.schedule.length === 0 ? (
          <div className="rounded-xl border border-dashed border-stone-700 p-4 text-sm text-stone-400">
            Noch keine automatische Regel. Das manuell gewählte Fallback-Design
            bleibt aktiv.
          </div>
        ) : (
          <div className="grid gap-3">
            {settings.schedule.map((entry) => {
              const status = getThemeScheduleStatus(entry, new Date());
              const ui = statusUi(status);
              const preset = getThemePreset(entry.theme);

              return (
                <div
                  key={entry.id}
                  className={`rounded-2xl border p-3 sm:p-4 ${ui.className}`}
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="text-xl">{preset.icon}</span>
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{entry.name}</div>
                        <div className="text-[11px] opacity-75">
                          {preset.label} · Priorität {entry.priority ?? 0}
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-current/30 px-2 py-1 text-[11px] font-bold">
                      {ui.label}
                    </span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <label className="block text-xs">
                      <span className="mb-1 block opacity-80">Name</span>
                      <input
                        className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white outline-none"
                        value={entry.name}
                        onChange={(event) =>
                          updateEntry(entry.id, { name: event.target.value })
                        }
                      />
                    </label>

                    <label className="block text-xs">
                      <span className="mb-1 block opacity-80">Design</span>
                      <select
                        className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white outline-none"
                        value={entry.theme}
                        onChange={(event) =>
                          updateEntry(entry.id, {
                            theme: event.target.value as ThemeId,
                          })
                        }
                      >
                        {THEME_PRESETS.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.icon} {item.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-xs sm:col-span-2 lg:col-span-1">
                      <span className="mb-1 block opacity-80">Priorität</span>
                      <input
                        type="number"
                        className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white outline-none"
                        value={String(entry.priority ?? 50)}
                        onChange={(event) =>
                          updateEntry(entry.id, {
                            priority: Number(event.target.value || 0),
                          })
                        }
                      />
                    </label>

                    <div className="flex items-end gap-3">
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={entry.enabled}
                          onChange={(event) =>
                            updateEntry(entry.id, {
                              enabled: event.target.checked,
                            })
                          }
                        />
                        Aktiv
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={entry.repeatYearly !== false}
                          onChange={(event) =>
                            updateEntry(entry.id, {
                              repeatYearly: event.target.checked,
                            })
                          }
                        />
                        Jährlich
                      </label>
                    </div>

                    <label className="block text-xs sm:col-span-1 lg:col-span-2">
                      <span className="mb-1 block opacity-80">Start</span>
                      <input
                        type="datetime-local"
                        className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white outline-none"
                        value={toDateTimeLocal(entry.startAt)}
                        onChange={(event) =>
                          updateEntry(entry.id, {
                            startAt: toIso(event.target.value),
                          })
                        }
                      />
                    </label>

                    <label className="block text-xs sm:col-span-1 lg:col-span-2">
                      <span className="mb-1 block opacity-80">Ende</span>
                      <input
                        type="datetime-local"
                        className="w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white outline-none"
                        value={toDateTimeLocal(entry.endAt)}
                        onChange={(event) =>
                          updateEntry(entry.id, {
                            endAt: toIso(event.target.value),
                          })
                        }
                      />
                    </label>
                  </div>

                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      className="rounded-full border border-rose-400/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100"
                      onClick={() =>
                        updateSchedule(
                          settings.schedule.filter((item) => item.id !== entry.id),
                        )
                      }
                    >
                      Löschen
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
