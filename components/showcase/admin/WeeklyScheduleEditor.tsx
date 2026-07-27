"use client";

import { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_SHOWCASE_WEEKDAYS,
  SHOWCASE_SCHEDULE_TIMEZONE,
  SHOWCASE_WEEKDAY_OPTIONS,
  describeShowcaseWeeklySchedule,
} from "@/lib/showcase/schedule";
import type { ShowcaseScene, ShowcaseWeekday } from "@/lib/showcase/types";

type Props = {
  scene: ShowcaseScene;
  inputClass: string;
  onChange: (patch: Partial<ShowcaseScene>, structural?: boolean) => void;
};

export default function WeeklyScheduleEditor({ scene, inputClass, onChange }: Props) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!scene.weeklyScheduleEnabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [scene.weeklyScheduleEnabled]);

  const days = useMemo(
    () =>
      Array.isArray(scene.weeklyScheduleDays)
        ? scene.weeklyScheduleDays
        : DEFAULT_SHOWCASE_WEEKDAYS,
    [scene.weeklyScheduleDays],
  );
  const status = describeShowcaseWeeklySchedule(scene, now);

  const toggleDay = (day: ShowcaseWeekday) => {
    const next = days.includes(day)
      ? days.filter((value) => value !== day)
      : [...days, day].sort((a, b) => a - b);
    onChange({ weeklyScheduleDays: next }, true);
  };

  const applyLunchPreset = () => {
    onChange({
      weeklyScheduleEnabled: true,
      weeklyScheduleDays: [1, 2, 3, 4, 5],
      weeklyStartTime: "10:00",
      weeklyEndTime: "16:00",
      scheduleTimezone: SHOWCASE_SCHEDULE_TIMEZONE,
    }, true);
  };

  return (
    <div className="md:col-span-2 rounded-2xl border border-orange-500/25 bg-orange-500/[0.04] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-black text-white">Haftalık yayın programı</h3>
          <p className="mt-1 text-xs leading-5 text-stone-400">
            Mittagsmenü, happy hour veya yalnız belirli günlerde gösterilecek bütün sahnelerde kullanılır.
          </p>
        </div>
        <label className="flex items-center gap-2 rounded-xl border border-stone-700 bg-stone-950 px-3 py-2 text-sm font-bold text-stone-200">
          <input
            type="checkbox"
            checked={scene.weeklyScheduleEnabled === true}
            onChange={(event) => onChange({
              weeklyScheduleEnabled: event.target.checked,
              weeklyScheduleDays: days.length ? days : [...DEFAULT_SHOWCASE_WEEKDAYS],
              weeklyStartTime: scene.weeklyStartTime || "10:00",
              weeklyEndTime: scene.weeklyEndTime || "16:00",
              scheduleTimezone: SHOWCASE_SCHEDULE_TIMEZONE,
            }, true)}
          />
          Seçili gün ve saatlerde göster
        </label>
      </div>

      {scene.weeklyScheduleEnabled ? (
        <div className="mt-4 space-y-4">
          <div>
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-stone-500">Yayın günleri</div>
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
              {SHOWCASE_WEEKDAY_OPTIONS.map((option) => {
                const selected = days.includes(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    title={option.label}
                    onClick={() => toggleDay(option.value)}
                    className={[
                      "rounded-xl border px-2 py-2.5 text-xs font-black transition",
                      selected
                        ? "border-orange-400 bg-orange-500 text-black"
                        : "border-stone-700 bg-stone-950 text-stone-400 hover:border-stone-500",
                    ].join(" ")}
                  >
                    {option.short}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1.5">
              <span className="text-sm font-semibold text-stone-200">Başlangıç</span>
              <input
                type="time"
                className={inputClass}
                value={scene.weeklyStartTime || "10:00"}
                onChange={(event) => onChange({ weeklyStartTime: event.target.value }, true)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-semibold text-stone-200">Bitiş</span>
              <input
                type="time"
                className={inputClass}
                value={scene.weeklyEndTime || "16:00"}
                onChange={(event) => onChange({ weeklyEndTime: event.target.value }, true)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-semibold text-stone-200">Saat dilimi</span>
              <div className={`${inputClass} cursor-default text-stone-300`}>
                Europe/Berlin
              </div>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={applyLunchPreset}
              className="rounded-xl border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs font-black text-orange-200 hover:bg-orange-500/20"
            >
              Hafta içi 10:00–16:00 hazır ayarı
            </button>
            <span className="text-xs text-stone-500">
              Bitiş saati dahil değildir: 16:00 olduğunda sahne otomatik atlanır.
            </span>
          </div>

          <div className={[
            "rounded-xl border p-3 text-sm",
            status.active
              ? "border-emerald-700/50 bg-emerald-950/25 text-emerald-100"
              : "border-amber-700/50 bg-amber-950/20 text-amber-100",
          ].join(" ")}>
            <div className="font-black">{status.status}</div>
            <div className="mt-1 text-xs opacity-80">
              {status.summary} · Berlin saati: {status.currentTime}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-stone-800 bg-stone-950/60 p-3 text-xs text-stone-400">
          Bu sahne, başlangıç/bitiş tarihi dışında her gün ve her saat yayınlanabilir.
        </div>
      )}
    </div>
  );
}
