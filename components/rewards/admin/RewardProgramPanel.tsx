"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  rewardWeekdayLabel,
  type RewardDefinition,
  type RewardDaySchedule,
  type RewardPhotoMode,
  type SchnellRewardProgram,
} from "@/lib/rewards/config";

type TodayPayload = {
  businessDate: string;
  minuteOfDay: number;
  activeNow: boolean;
  startTime: string | null;
  endTime: string | null;
  winnerLimit: number;
  winsUsed: number;
  remainingWins: number;
  progressPercent: number;
  currentChancePercent: number;
  previousEligibleOrders: number;
  ordersSinceLastWin: number;
  spacingBlocked: boolean;
  deadlineMode: boolean;
  lastWinAt: string | null;
  distributionMode: "adaptive_spontaneous";
  wins: Array<{
    id: string;
    slotIndex: number;
    rewardLabel: string;
    createdAt: string;
  }>;
};

type ApiPayload = {
  ok?: boolean;
  settings?: SchnellRewardProgram;
  today?: TodayPayload;
  error?: string;
};

function numberValue(value: string, min: number, max: number, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function berlinTime(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export default function RewardProgramPanel() {
  const [settings, setSettings] = useState<SchnellRewardProgram | null>(null);
  const [today, setToday] = useState<TodayPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const response = await fetch("/api/admin/rewards", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as ApiPayload;
      if (!response.ok || !data.settings) throw new Error(data.error || "reward_load_failed");
      setSettings(data.settings);
      setToday(data.today || null);
    } catch {
      setError("Şanslı Sipariş ayarları yüklenemedi.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalWeeklyWinners = useMemo(
    () => settings?.weekly.reduce((sum, day) => sum + (day.enabled ? day.winnerCount : 0), 0) || 0,
    [settings?.weekly],
  );

  function updateDay(weekday: number, patch: Partial<RewardDaySchedule>) {
    setSettings((current) =>
      current
        ? {
            ...current,
            weekly: current.weekly.map((day) =>
              day.weekday === weekday ? { ...day, ...patch } : day,
            ),
          }
        : current,
    );
  }

  function updateReward(id: string, patch: Partial<RewardDefinition>) {
    setSettings((current) =>
      current
        ? {
            ...current,
            pool: current.pool.map((reward) =>
              reward.id === id ? { ...reward, ...patch } : reward,
            ),
          }
        : current,
    );
  }

  async function save() {
    if (!settings || busy) return;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/rewards", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiPayload;
      if (!response.ok || !data.settings) throw new Error(data.error || "reward_save_failed");
      setSettings(data.settings);
      setToday(data.today || null);
      setMessage("Şanslı Sipariş programı kaydedildi. Ödüller artık sipariş geldikçe spontane dağıtılacak.");
    } catch {
      setError("Şanslı Sipariş ayarları kaydedilemedi.");
    } finally {
      setBusy(false);
    }
  }

  if (!settings) {
    return (
      <section id="reward-program" className="mt-8 rounded-2xl border border-amber-500/25 bg-amber-500/5 p-5">
        <h2 className="text-xl font-black">🍀 Şanslı Sipariş</h2>
        <p className="mt-2 text-sm text-stone-400">{error || "Ayarlar yükleniyor…"}</p>
        {error ? (
          <button type="button" onClick={() => void load()} className="mt-4 rounded-xl bg-white px-4 py-2 font-bold text-black">
            Tekrar dene
          </button>
        ) : null}
      </section>
    );
  }

  return (
    <section id="reward-program" className="mt-8 space-y-6 rounded-3xl border border-amber-400/30 bg-gradient-to-br from-amber-500/10 via-black/20 to-emerald-500/10 p-5 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black">🍀 Şanslı Sipariş Motoru</h2>
          <p className="mt-2 max-w-3xl text-sm text-stone-300">
            Gün, saat ve maksimum kazanan adedini belirlersin. Sabit ödül saatleri yoktur; her gerçek siparişte kalan süre ve kota değerlendirilerek spontane karar verilir.
          </p>
        </div>
        <label className="flex items-center gap-3 rounded-2xl border border-stone-700 bg-black/30 px-4 py-3 font-black">
          <span>{settings.enabled ? "Sistem aktif" : "Sistem kapalı"}</span>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })}
            className="h-5 w-5"
          />
        </label>
      </div>

      <div className="rounded-2xl border border-emerald-500/25 bg-black/25 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-black">Bugünün spontane dağıtım durumu</h3>
            <p className="mt-1 text-xs text-stone-400">
              {today?.businessDate || "—"} · Sabit saat üretilmez, kullanılmayan ödül pencere bitene kadar kaybolmaz. Haftalık toplam üst sınır: {totalWeeklyWinners}.
            </p>
          </div>
          <button type="button" onClick={() => void load()} className="rounded-xl border border-stone-600 px-3 py-2 text-sm font-bold">
            Yenile
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <span className="text-xs text-stone-400">Durum / saat</span>
            <strong className={`mt-1 block ${today?.activeNow ? "text-emerald-300" : "text-stone-300"}`}>
              {today?.activeNow ? "Şu an aktif" : "Şu an pasif"}
            </strong>
            <span className="text-xs text-stone-500">{today?.startTime || "—"} – {today?.endTime || "—"}</span>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <span className="text-xs text-stone-400">Günlük kota</span>
            <strong className="mt-1 block text-xl text-amber-300">{today?.winsUsed || 0} / {today?.winnerLimit || 0}</strong>
            <span className="text-xs text-stone-500">Kalan: {today?.remainingWins || 0}</span>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <span className="text-xs text-stone-400">Bir sonraki uygun sipariş</span>
            <strong className="mt-1 block text-xl text-cyan-200">≈ %{today?.currentChancePercent || 0}</strong>
            <span className="text-xs text-stone-500">Günlük cihaz limitine takılmamış müşteri için</span>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <span className="text-xs text-stone-400">Sipariş hareketi</span>
            <strong className="mt-1 block text-xl">{today?.previousEligibleOrders || 0}</strong>
            <span className="text-xs text-stone-500">Son kazanan: {berlinTime(today?.lastWinAt)}</span>
          </div>
        </div>

        <p className="mt-3 text-xs leading-5 text-stone-400">
          Süre ilerleyip kota geride kalırsa ihtimal otomatik yükselir. Son bölümde gelen uygun siparişler, kota dolana kadar öncelik kazanır. Müşteri gelmezse olmayan siparişe ödül yazılmaz. Aynı cihaz bir günde en fazla <strong className="text-stone-200">{settings.maxWinsPerDevicePerDay}</strong> kez kazanabilir; bu limite ulaşmış cihazlardan verilen yeni test siparişleri yüzde 100 görünse bile çekilişe alınmaz.
        </p>
      </div>

      <div>
        <h3 className="text-lg font-black">Haftalık gün, saat ve maksimum kazanan limiti</h3>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {settings.weekly.map((day) => (
            <article key={day.weekday} className="rounded-2xl border border-stone-700 bg-black/25 p-4">
              <div className="flex items-center justify-between gap-3">
                <strong>{rewardWeekdayLabel(day.weekday)}</strong>
                <input
                  type="checkbox"
                  checked={day.enabled}
                  onChange={(event) => updateDay(day.weekday, { enabled: event.target.checked })}
                  className="h-5 w-5"
                />
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <label className="text-xs text-stone-400">
                  Başlangıç
                  <input
                    type="time"
                    value={day.startTime}
                    disabled={!day.enabled}
                    onChange={(event) => updateDay(day.weekday, { startTime: event.target.value })}
                    className="mt-1 w-full rounded-lg bg-stone-900 p-2 text-sm text-white disabled:opacity-50"
                  />
                </label>
                <label className="text-xs text-stone-400">
                  Bitiş
                  <input
                    type="time"
                    value={day.endTime}
                    disabled={!day.enabled}
                    onChange={(event) => updateDay(day.weekday, { endTime: event.target.value })}
                    className="mt-1 w-full rounded-lg bg-stone-900 p-2 text-sm text-white disabled:opacity-50"
                  />
                </label>
                <label className="text-xs text-stone-400">
                  Kazanan üst sınırı
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={day.winnerCount}
                    disabled={!day.enabled}
                    onChange={(event) =>
                      updateDay(day.weekday, {
                        winnerCount: numberValue(event.target.value, 0, 100, day.winnerCount),
                      })
                    }
                    className="mt-1 w-full rounded-lg bg-stone-900 p-2 text-sm text-white disabled:opacity-50"
                  />
                </label>
              </div>
            </article>
          ))}
        </div>

        <div className="mt-4 grid max-w-3xl gap-4 md:grid-cols-2">
          <label className="block text-sm text-stone-400">
            Cihaz başına günlük kazanma sınırı
            <input
              type="number"
              min="1"
              max="20"
              value={settings.maxWinsPerDevicePerDay}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  maxWinsPerDevicePerDay: numberValue(
                    event.target.value,
                    1,
                    20,
                    settings.maxWinsPerDevicePerDay,
                  ),
                })
              }
              className="mt-1 w-full rounded-xl bg-stone-900 p-2 text-white"
            />
            <span className="mt-1 block text-xs leading-5 text-stone-500">
              Normal kullanım için 1 önerilir. Aynı telefonla test ederken geçici olarak 10–20 yap, test bitince tekrar 1'e indir.
            </span>
          </label>

          <label className="block text-sm text-stone-400">
            İki kazanan arasında en az kaç normal sipariş olsun?
            <input
              type="number"
              min="0"
              max="10"
              value={settings.minOrdersBetweenWins}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  minOrdersBetweenWins: numberValue(event.target.value, 0, 10, settings.minOrdersBetweenWins),
                })
              }
              className="mt-1 w-full rounded-xl bg-stone-900 p-2 text-white"
            />
            <span className="mt-1 block text-xs leading-5 text-stone-500">0 seçilirse art arda iki kazanan mümkün olur. Son dakikalarda kota kalırsa bu koruma otomatik gevşer.</span>
          </label>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-black">Sepete uygun rastgele ödül havuzu</h3>
        <p className="mt-1 text-sm text-stone-400">
          Yalnız sepette gerçekten uygulanabilen aktif seçenekler çekilişe girer. Ağırlık arttıkça çıkma ihtimali artar.
        </p>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {settings.pool.map((reward) => (
            <article key={reward.id} className={`rounded-2xl border p-4 ${reward.active ? "border-emerald-500/30 bg-emerald-500/5" : "border-stone-700 bg-black/20 opacity-65"}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <strong className="block">{reward.label}</strong>
                  <span className="mt-1 block text-xs text-stone-400">{reward.customerLabel}</span>
                </div>
                <input
                  type="checkbox"
                  checked={reward.active}
                  onChange={(event) => updateReward(reward.id, { active: event.target.checked })}
                  className="h-5 w-5 shrink-0"
                />
              </div>
              <label className="mt-3 block text-xs text-stone-400">
                Çıkma ağırlığı
                <input
                  type="number"
                  min="1"
                  max="10000"
                  value={reward.weight}
                  disabled={!reward.active}
                  onChange={(event) =>
                    updateReward(reward.id, {
                      weight: numberValue(event.target.value, 1, 10000, reward.weight),
                    })
                  }
                  className="mt-1 w-full rounded-lg bg-stone-900 p-2 text-white disabled:opacity-50"
                />
              </label>
            </article>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-stone-700 bg-black/25 p-4">
          <h3 className="font-black">Telefon kutlaması ve paylaşım</h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-stone-400">
              Paylaşım modu
              <select
                value={settings.photoMode}
                onChange={(event) =>
                  setSettings({ ...settings, photoMode: event.target.value as RewardPhotoMode })
                }
                className="mt-1 w-full rounded-xl bg-stone-900 p-2 text-white"
              >
                <option value="off">Kapalı</option>
                <option value="name">Yalnız ad / takma ad</option>
                <option value="name_photo">Ad + isteğe bağlı fotoğraf</option>
              </select>
            </label>
            <label className="text-sm text-stone-400">
              Kazandınız ekranı (saniye)
              <input
                type="number"
                min="5"
                max="12"
                value={settings.celebrationSeconds}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    celebrationSeconds: numberValue(event.target.value, 5, 12, settings.celebrationSeconds),
                  })
                }
                className="mt-1 w-full rounded-xl bg-stone-900 p-2 text-white"
              />
            </label>
            <label className="text-sm text-stone-400">
              Fotoğraf en geç silinsin
              <select
                value={settings.photoRetentionMinutes}
                onChange={(event) =>
                  setSettings({ ...settings, photoRetentionMinutes: Number(event.target.value) })
                }
                className="mt-1 w-full rounded-xl bg-stone-900 p-2 text-white"
              >
                <option value="30">30 dakika</option>
                <option value="60">60 dakika</option>
                <option value="90">90 dakika</option>
              </select>
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-stone-700 p-3 text-sm font-bold">
              Yeni kutlama sesi
              <input
                type="checkbox"
                checked={settings.celebrationSoundEnabled}
                onChange={(event) =>
                  setSettings({ ...settings, celebrationSoundEnabled: event.target.checked })
                }
                className="h-5 w-5"
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-stone-700 p-3 text-sm font-bold sm:col-span-2">
              Yalnız ad gönderimlerini otomatik yayınla
              <input
                type="checkbox"
                checked={settings.autoPublishName}
                onChange={(event) =>
                  setSettings({ ...settings, autoPublishName: event.target.checked })
                }
                className="h-5 w-5"
              />
            </label>
          </div>
        </article>

        <article className="rounded-2xl border border-stone-700 bg-black/25 p-4">
          <h3 className="font-black">Showcase kutlama yayını</h3>
          <div className="mt-4 grid gap-3">
            <label className="flex items-center justify-between gap-3 rounded-xl border border-stone-700 p-3 text-sm font-bold">
              Showcase yayını aktif
              <input
                type="checkbox"
                checked={settings.showcaseEnabled}
                onChange={(event) => setSettings({ ...settings, showcaseEnabled: event.target.checked })}
                className="h-5 w-5"
              />
            </label>
            <label className="flex items-center justify-between gap-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 text-sm font-bold">
              Tüm aktif vitrin ekranlarında göster
              <input
                type="checkbox"
                checked={settings.targetAllActiveScreens}
                disabled={!settings.showcaseEnabled}
                onChange={(event) => setSettings({ ...settings, targetAllActiveScreens: event.target.checked })}
                className="h-5 w-5"
              />
            </label>
            {!settings.targetAllActiveScreens ? (
              <label className="text-sm text-stone-400">
                Seçili screenSlug değerleri
                <input
                  value={settings.targetScreenSlugs.join(", ")}
                  disabled={!settings.showcaseEnabled}
                  onChange={(event) =>
                    setSettings({
                      ...settings,
                      targetScreenSlugs: event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="brand, main"
                  className="mt-1 w-full rounded-xl bg-stone-900 p-2 text-white disabled:opacity-50"
                />
              </label>
            ) : (
              <p className="rounded-xl border border-white/10 bg-white/5 p-3 text-xs leading-5 text-stone-400">
                Ana vitrin, marka, menü, duyuru ve sonradan eklediğin diğer aktif Showcase ekranları otomatik hedeflenir.
              </p>
            )}
            <label className="text-sm text-stone-400">
              Vitrinde gösterim süresi
              <input
                type="number"
                min="8"
                max="30"
                value={settings.showcaseDurationSeconds}
                disabled={!settings.showcaseEnabled}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    showcaseDurationSeconds: numberValue(
                      event.target.value,
                      8,
                      30,
                      settings.showcaseDurationSeconds,
                    ),
                  })
                }
                className="mt-1 w-full rounded-xl bg-stone-900 p-2 text-white disabled:opacity-50"
              />
            </label>
          </div>
        </article>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void save()}
          className="rounded-xl bg-amber-400 px-6 py-3 font-black text-black disabled:opacity-50"
        >
          {busy ? "Kaydediliyor…" : "Şanslı Sipariş ayarlarını kaydet"}
        </button>
        {message ? <span className="text-sm font-bold text-emerald-300">{message}</span> : null}
        {error ? <span className="text-sm font-bold text-red-300">{error}</span> : null}
      </div>
    </section>
  );
}
