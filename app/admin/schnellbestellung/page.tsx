"use client";

import { useEffect, useMemo, useState } from "react";

type SchnellSettings = {
  enabled: boolean;
  paused: boolean;
  cashEnabled: boolean;
  onlineEnabled: boolean;
  splitEnabled: boolean;
  tvEnabled: boolean;
  soundEnabled: boolean;
  autoPrint: boolean;
  radiusMeters: number;
  maxAccuracyMeters: number;
  qrTtlMinutes: number;
  qrGraceMinutes: number;
  sessionMinutes: number;
  recheckMinutes: number;
  maxOrdersPerDevice: number;
  orderWindowMinutes: number;
  numberStart: number;
  generation: number;
  shopLat: number;
  shopLng: number;
  visibleCategories: string[];
  hiddenProductIds: string[];
};

type BooleanSettingKey =
  | "enabled"
  | "paused"
  | "cashEnabled"
  | "onlineEnabled"
  | "splitEnabled"
  | "tvEnabled"
  | "soundEnabled"
  | "autoPrint";

type NumberSettingKey =
  | "radiusMeters"
  | "maxAccuracyMeters"
  | "qrTtlMinutes"
  | "qrGraceMinutes"
  | "sessionMinutes"
  | "recheckMinutes"
  | "maxOrdersPerDevice"
  | "orderWindowMinutes"
  | "numberStart"
  | "shopLat"
  | "shopLng";

type ApiResponse = {
  ok?: boolean;
  settings?: SchnellSettings;
  error?: string;
};

const TOGGLES: Array<{
  key: BooleanSettingKey;
  label: string;
  description: string;
  disabled?: boolean;
}> = [
  {
    key: "enabled",
    label: "Sistem aktif",
    description: "Kapalıysa QR ekranında sipariş kodu oluşturulmaz.",
  },
  {
    key: "paused",
    label: "Siparişleri duraklat",
    description: "Acil durumda yeni restoran içi siparişleri geçici olarak durdurur.",
  },
  {
    key: "cashEnabled",
    label: "Barzahlung aktif",
    description: "Müşteri siparişi oluşturur ve kasada nakit öder.",
  },
  {
    key: "onlineEnabled",
    label: "Online-Zahlung",
    description: "V1 müşteri akışında henüz devrede değildir.",
    disabled: true,
  },
  {
    key: "splitEnabled",
    label: "Getrennt zahlen",
    description: "V1 müşteri akışında henüz devrede değildir.",
    disabled: true,
  },
  {
    key: "tvEnabled",
    label: "TV’ye gönder",
    description: "Yeni sipariş mevcut mutfak TV sisteminde gösterilir.",
  },
  {
    key: "soundEnabled",
    label: "Yeni sipariş sesi",
    description: "TV ekranında bildirim sesi kullanılmasına izin verir.",
  },
  {
    key: "autoPrint",
    label: "Otomatik fiş bas",
    description: "Sipariş final olduğunda mevcut print-agent akışını kullanır.",
  },
];

const NUMBER_FIELDS: Array<{
  key: NumberSettingKey;
  label: string;
  step?: string;
}> = [
  { key: "radiusMeters", label: "GPS yarıçapı (metre)" },
  { key: "maxAccuracyMeters", label: "Maksimum GPS hata payı (metre)" },
  { key: "qrTtlMinutes", label: "QR geçerlilik süresi (dakika)" },
  { key: "qrGraceMinutes", label: "Eski QR toleransı (dakika)" },
  { key: "sessionMinutes", label: "Salon oturum süresi (dakika)" },
  { key: "recheckMinutes", label: "Tekrar GPS kontrolü (dakika)" },
  { key: "maxOrdersPerDevice", label: "Cihaz başına sipariş limiti" },
  { key: "orderWindowMinutes", label: "Sipariş limit penceresi (dakika)" },
  { key: "numberStart", label: "Günlük müşteri numarası başlangıcı" },
  { key: "shopLat", label: "Dükkân enlemi (Latitude)", step: "0.000001" },
  { key: "shopLng", label: "Dükkân boylamı (Longitude)", step: "0.000001" },
];

export default function SchnellbestellungAdminPage() {
  const [settings, setSettings] = useState<SchnellSettings | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadSettings() {
    setError("");

    try {
      const response = await fetch("/api/admin/schnellbestellung", {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;

      if (!response.ok || !data.settings) {
        throw new Error(data.error || "settings_load_failed");
      }

      setSettings(data.settings);
    } catch {
      setError("Schnellbestellung ayarları yüklenemedi.");
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  const operationalStatus = useMemo(() => {
    if (!settings) return null;
    if (!settings.enabled) {
      return {
        text: "Kapalı",
        className: "border-red-500/40 bg-red-500/10 text-red-200",
      };
    }
    if (settings.paused) {
      return {
        text: "Duraklatıldı",
        className: "border-amber-500/40 bg-amber-500/10 text-amber-100",
      };
    }
    return {
      text: "Aktif",
      className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100",
    };
  }, [settings]);

  function setBoolean(key: BooleanSettingKey, value: boolean) {
    setSettings((current) =>
      current ? { ...current, [key]: value } : current,
    );
  }

  function setNumber(key: NumberSettingKey, value: string) {
    const parsed = Number(value);
    setSettings((current) =>
      current && Number.isFinite(parsed)
        ? { ...current, [key]: parsed }
        : current,
    );
  }

  async function saveSettings() {
    if (!settings || saving) return;

    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/admin/schnellbestellung", {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ settings }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;

      if (!response.ok || !data.settings) {
        throw new Error(data.error || "settings_save_failed");
      }

      setSettings(data.settings);
      setMessage(
        data.settings.enabled && !data.settings.paused
          ? "Kaydedildi. QR ekranı artık kod oluşturabilir."
          : "Ayarlar kaydedildi.",
      );
    } catch {
      setError("Ayarlar kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  function invalidateSessions() {
    setSettings((current) =>
      current
        ? { ...current, generation: Number(current.generation || 1) + 1 }
        : current,
    );
    setMessage(
      "Değişiklik hazırlandı. Kaydettiğinde mevcut QR ve oturumlar iptal edilir.",
    );
  }

  if (!settings && !error) {
    return <div className="p-8">Yükleniyor…</div>;
  }

  if (!settings) {
    return (
      <main className="p-4 md:p-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-red-500/40 bg-red-500/10 p-5 text-red-100">
          <h1 className="text-xl font-black">Ayarlar yüklenemedi</h1>
          <p className="mt-2">{error}</p>
          <button
            type="button"
            onClick={() => void loadSettings()}
            className="mt-4 rounded-xl bg-white px-4 py-2 font-bold text-black"
          >
            Tekrar dene
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="p-4 md:p-8">
      <div className="mx-auto max-w-4xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black">Schnellbestellung</h1>
            <p className="mt-2 text-stone-400">
              Restoran içi QR sipariş sistemi
            </p>
          </div>

          {operationalStatus ? (
            <div
              className={`rounded-full border px-4 py-2 text-sm font-black ${operationalStatus.className}`}
            >
              Durum: {operationalStatus.text}
            </div>
          ) : null}
        </div>

        <div className="mt-6 grid gap-3">
          {TOGGLES.map((item) => (
            <label
              key={item.key}
              className={`flex items-center justify-between gap-5 rounded-xl border border-stone-700 p-4 ${
                item.disabled ? "opacity-60" : ""
              }`}
            >
              <span>
                <span className="block font-bold">{item.label}</span>
                <span className="mt-1 block text-sm text-stone-400">
                  {item.description}
                </span>
              </span>
              <input
                type="checkbox"
                checked={Boolean(settings[item.key])}
                disabled={item.disabled}
                onChange={(event) =>
                  setBoolean(item.key, event.target.checked)
                }
                className="h-5 w-5 shrink-0"
              />
            </label>
          ))}
        </div>

        <h2 className="mt-8 text-xl font-black">Güvenlik ve operasyon</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {NUMBER_FIELDS.map((item) => (
            <label
              key={item.key}
              className="rounded-xl border border-stone-700 p-3 text-sm"
            >
              <span className="block text-stone-400">{item.label}</span>
              <input
                type="number"
                step={item.step || "1"}
                value={Number(settings[item.key])}
                onChange={(event) => setNumber(item.key, event.target.value)}
                className="mt-2 w-full rounded bg-stone-900 p-2"
              />
            </label>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={saving}
            className="rounded-xl bg-emerald-500 px-5 py-3 font-bold text-black disabled:opacity-60"
          >
            {saving ? "Kaydediliyor…" : "Ayarları kaydet"}
          </button>

          <button
            type="button"
            onClick={invalidateSessions}
            className="rounded-xl bg-red-600 px-5 py-3 font-bold"
          >
            Tüm QR ve oturumları iptal et
          </button>

          <a
            href="/schnellbestellung/access-display"
            target="_blank"
            rel="noreferrer"
            className="rounded-xl bg-stone-700 px-5 py-3 font-bold"
          >
            QR ekranını aç
          </a>
        </div>

        {message ? (
          <p className="mt-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-amber-200">
            {message}
          </p>
        ) : null}
        {error ? (
          <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-200">
            {error}
          </p>
        ) : null}

        <div className="mt-6 rounded-2xl border border-blue-400/30 bg-blue-400/10 p-4 text-sm text-blue-100">
          <strong>İlk kullanım:</strong> “Sistem aktif” ve “Barzahlung aktif”
          seçeneklerini aç, doğru dükkân koordinatlarını gir ve ayarları kaydet.
          Ardından QR ekranını yenile.
        </div>
      </div>
    </main>
  );
}
