"use client";

import { useEffect, useMemo, useState } from "react";

type SchnellCategory =
  | "burger"
  | "vegan"
  | "extras"
  | "sauces"
  | "hotdogs"
  | "drinks"
  | "donuts"
  | "bubbletea";

type CampaignType =
  | "percent_category"
  | "percent_product"
  | "fixed_product";

type SchnellCampaign = {
  id: string;
  name: string;
  type: CampaignType;
  active: boolean;
  targetCategory?: SchnellCategory;
  targetProductId?: string;
  percent?: number;
  fixedPrice?: number;
  startsAt?: string;
  endsAt?: string;
  badgeText?: string;
};

type SchnellSettings = {
  enabled: boolean;
  paused: boolean;
  cashEnabled: boolean;
  onlineEnabled: boolean;
  splitEnabled: boolean;
  tvEnabled: boolean;
  soundEnabled: boolean;
  autoPrint: boolean;
  locationCheckEnabled: boolean;
  takeawayEnabled: boolean;
  orderHistoryEnabled: boolean;
  liveReadyAlertEnabled: boolean;
  backgroundReadyPushEnabled: boolean;
  iosHomeScreenFlowEnabled: boolean;
  timeSignalEnabled: boolean;
  timeWarningMinutes: number;
  timeCriticalMinutes: number;
  historyMaxOrders: number;
  historyDays: number;
  radiusMeters: number;
  maxAccuracyMeters: number;
  qrMode: "static" | "dynamic";
  staticQrId: string;
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
  campaigns: SchnellCampaign[];
};

type CatalogProduct = {
  id: string;
  name: string;
  category: SchnellCategory;
  categoryLabel: string;
  price: number;
};

type ApiResponse = {
  ok?: boolean;
  settings?: SchnellSettings;
  catalog?: CatalogProduct[];
  error?: string;
};

type BooleanSettingKey =
  | "enabled"
  | "paused"
  | "cashEnabled"
  | "onlineEnabled"
  | "splitEnabled"
  | "tvEnabled"
  | "soundEnabled"
  | "autoPrint"
  | "locationCheckEnabled"
  | "takeawayEnabled"
  | "orderHistoryEnabled"
  | "liveReadyAlertEnabled"
  | "backgroundReadyPushEnabled"
  | "iosHomeScreenFlowEnabled"
  | "timeSignalEnabled";

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
  | "timeWarningMinutes"
  | "timeCriticalMinutes"
  | "historyMaxOrders"
  | "historyDays"
  | "shopLat"
  | "shopLng";

const CATEGORY_OPTIONS: Array<{ key: SchnellCategory; label: string }> = [
  { key: "burger", label: "Burger" },
  { key: "vegan", label: "Vegan / Vegetarisch" },
  { key: "extras", label: "Extras" },
  { key: "sauces", label: "Soßen" },
  { key: "hotdogs", label: "Hot Dogs" },
  { key: "drinks", label: "Getränke" },
  { key: "donuts", label: "Donuts" },
  { key: "bubbletea", label: "Bubble Tea" },
];

const TOGGLES: Array<{
  key: BooleanSettingKey;
  label: string;
  description: string;
  disabled?: boolean;
}> = [
  {
    key: "enabled",
    label: "Sistem aktif",
    description: "Kapalıysa yeni Schnellbestellung oturumu oluşturulmaz.",
  },
  {
    key: "paused",
    label: "Siparişleri duraklat",
    description: "Admin tarafından acil durdurma. TV'deki pause ayrıca çalışır.",
  },
  {
    key: "cashEnabled",
    label: "Barzahlung aktif",
    description: "Müşteri siparişi oluşturur ve kasada nakit öder.",
  },
  {
    key: "locationCheckEnabled",
    label: "Konum kontrolü aktif",
    description: "Kapalıysa QR okutulduğunda menü doğrudan açılır.",
  },
  {
    key: "takeawayEnabled",
    label: "Zum Mitnehmen seçimi aktif",
    description: "Müşteri isterse siparişi paket olarak işaretleyebilir.",
  },
  {
    key: "orderHistoryEnabled",
    label: "Son siparişleri hatırla",
    description: "Aynı cihazda son siparişler sepete geri yüklenebilir.",
  },
  {
    key: "liveReadyAlertEnabled",
    label: "Telefon hazır uyarısı aktif",
    description: "TV'de Fertig yapılınca açık bekleme ekranında sesli uyarı verir.",
  },
  {
    key: "backgroundReadyPushEnabled",
    label: "Arka plan bildirimi aktif",
    description:
      "Android Chrome ve ana ekrana eklenmiş iPhone web uygulamasında Fertig bildirimi gönderir.",
  },
  {
    key: "iosHomeScreenFlowEnabled",
    label: "iPhone ana ekran yönlendirmesi aktif",
    description:
      "Yalnız iPhone/iPad QR akışında ücretsiz ana ekran kurulumu seçeneğini gösterir. Kapalıysa iOS normal sipariş akışına doğrudan devam eder.",
  },
  {
    key: "timeSignalEnabled",
    label: "TV zaman renkleri aktif",
    description: "Schnellbestellung kartları bekleme süresine göre renk değiştirir.",
  },
  {
    key: "onlineEnabled",
    label: "Online-Zahlung",
    description: "Güvenli ödeme finalize bağlantısı tamamlanana kadar kapalıdır.",
    disabled: true,
  },
  {
    key: "splitEnabled",
    label: "Getrennt zahlen",
    description: "İlk sürümde kapalıdır; mevcut Split Center bozulmadan korunur.",
    disabled: true,
  },
  {
    key: "tvEnabled",
    label: "TV’ye gönder",
    description: "Yeni sipariş mutfak TV ekranında VOR ORT olarak gösterilir.",
  },
  {
    key: "soundEnabled",
    label: "Yeni sipariş sesi",
    description: "TV'de Schnellbestellung için ayrı ses kontrolüne izin verir.",
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
  { key: "qrTtlMinutes", label: "Dinamik QR geçerlilik süresi (dakika)" },
  { key: "qrGraceMinutes", label: "Eski dinamik QR toleransı (dakika)" },
  { key: "sessionMinutes", label: "Salon oturum süresi (dakika)" },
  { key: "recheckMinutes", label: "Tekrar GPS kontrolü (dakika)" },
  { key: "maxOrdersPerDevice", label: "Cihaz başına sipariş limiti" },
  { key: "orderWindowMinutes", label: "Sipariş limit penceresi (dakika)" },
  { key: "numberStart", label: "Günlük müşteri numarası başlangıcı" },
  { key: "timeWarningMinutes", label: "TV turuncu uyarı başlangıcı (dakika)" },
  { key: "timeCriticalMinutes", label: "TV kırmızı uyarı başlangıcı (dakika)" },
  { key: "historyMaxOrders", label: "Cihazda gösterilecek son sipariş sayısı" },
  { key: "historyDays", label: "Sipariş geçmişi saklama süresi (gün)" },
  { key: "shopLat", label: "Dükkân enlemi (Latitude)", step: "0.000001" },
  { key: "shopLng", label: "Dükkân boylamı (Longitude)", step: "0.000001" },
];

function newCampaign(): SchnellCampaign {
  return {
    id: crypto.randomUUID(),
    name: "Yeni Angebot",
    type: "percent_category",
    active: true,
    targetCategory: "burger",
    percent: 10,
    badgeText: "🔥 Angebot",
  };
}

function toLocalInput(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function fromLocalInput(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : undefined;
}

export default function SchnellbestellungAdminPage() {
  const [settings, setSettings] = useState<SchnellSettings | null>(null);
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
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
      setCatalog(Array.isArray(data.catalog) ? data.catalog : []);
    } catch {
      setError("Schnellbestellung ayarları yüklenemedi.");
    }
  }

  useEffect(() => {
    void loadSettings();
  }, []);

  const operationalStatus = useMemo(() => {
    if (!settings) return null;
    if (!settings.enabled) return { text: "Kapalı", className: "border-red-500/40 bg-red-500/10 text-red-200" };
    if (settings.paused) return { text: "Duraklatıldı", className: "border-amber-500/40 bg-amber-500/10 text-amber-100" };
    return { text: "Aktif", className: "border-emerald-500/40 bg-emerald-500/10 text-emerald-100" };
  }, [settings]);

  const effectiveVisibleCategories = useMemo(() => {
    if (!settings) return [] as SchnellCategory[];

    const saved = new Set(settings.visibleCategories);
    return settings.visibleCategories.length
      ? CATEGORY_OPTIONS.map((item) => item.key).filter((key) => saved.has(key))
      : CATEGORY_OPTIONS.map((item) => item.key);
  }, [settings]);

  function setBoolean(key: BooleanSettingKey, value: boolean) {
    setSettings((current) => (current ? { ...current, [key]: value } : current));
  }

  function setNumber(key: NumberSettingKey, value: string) {
    const parsed = Number(value.replace(",", "."));
    if (!Number.isFinite(parsed)) return;
    setSettings((current) => (current ? { ...current, [key]: parsed } : current));
  }

  function toggleCategory(key: SchnellCategory, visible: boolean) {
    if (!settings) return;

    setError("");
    const allKeys = CATEGORY_OPTIONS.map((item) => item.key);
    const active = new Set(
      settings.visibleCategories.length ? settings.visibleCategories : allKeys,
    );

    if (visible) active.add(key);
    else active.delete(key);

    if (active.size === 0) {
      setError("En az bir Schnellbestellung kategorisi açık kalmalıdır.");
      return;
    }

    setSettings({
      ...settings,
      visibleCategories: allKeys.filter((item) => active.has(item)),
    });
  }

  function updateCampaign(id: string, patch: Partial<SchnellCampaign>) {
    setSettings((current) =>
      current
        ? {
            ...current,
            campaigns: current.campaigns.map((campaign) =>
              campaign.id === id ? { ...campaign, ...patch } : campaign,
            ),
          }
        : current,
    );
  }

  function removeCampaign(id: string) {
    setSettings((current) =>
      current
        ? {
            ...current,
            campaigns: current.campaigns.filter((campaign) => campaign.id !== id),
          }
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
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;

      if (!response.ok || !data.settings) {
        throw new Error(data.error || "settings_save_failed");
      }

      setSettings(data.settings);
      setMessage("Ayarlar ve Schnellbestellung kampanyaları kaydedildi.");
    } catch {
      setError("Ayarlar kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  async function runAction(action: "rotate_static_qr" | "invalidate_sessions") {
    if (saving) return;
    setSaving(true);
    setMessage("");
    setError("");

    try {
      const response = await fetch("/api/admin/schnellbestellung", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiResponse;
      if (!response.ok || !data.settings) throw new Error(data.error || action);
      setSettings(data.settings);
      setMessage(
        action === "rotate_static_qr"
          ? "Yeni sabit QR oluşturuldu. Eski basılı QR artık geçersizdir."
          : "Mevcut oturumlar ve dinamik QR'lar geçersiz kılındı.",
      );
    } catch {
      setError("İşlem tamamlanamadı.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings && !error) return <div className="p-8">Yükleniyor…</div>;

  if (!settings) {
    return (
      <main className="p-4 md:p-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-red-500/40 bg-red-500/10 p-5 text-red-100">
          <h1 className="text-xl font-black">Ayarlar yüklenemedi</h1>
          <p className="mt-2">{error}</p>
          <button type="button" onClick={() => void loadSettings()} className="mt-4 rounded-xl bg-white px-4 py-2 font-bold text-black">
            Tekrar dene
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="p-4 md:p-8">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black">Schnellbestellung</h1>
            <p className="mt-2 text-stone-400">Restoran içi QR sipariş sistemi</p>
          </div>
          {operationalStatus ? (
            <div className={`rounded-full border px-4 py-2 text-sm font-black ${operationalStatus.className}`}>
              Durum: {operationalStatus.text}
            </div>
          ) : null}
        </div>

        <section className="mt-7">
          <h2 className="text-xl font-black">Genel ve operasyon</h2>
          <div className="mt-4 grid gap-3">
            {TOGGLES.map((item) => (
              <label key={item.key} className={`flex items-center justify-between gap-5 rounded-xl border border-stone-700 p-4 ${item.disabled ? "opacity-60" : ""}`}>
                <span>
                  <span className="block font-bold">{item.label}</span>
                  <span className="mt-1 block text-sm text-stone-400">{item.description}</span>
                </span>
                <input
                  type="checkbox"
                  checked={Boolean(settings[item.key])}
                  disabled={item.disabled}
                  onChange={(event) => setBoolean(item.key, event.target.checked)}
                  className="h-5 w-5 shrink-0"
                />
              </label>
            ))}
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-stone-700 p-5">
          <h2 className="text-xl font-black">Hızlı menü kategorileri</h2>
          <p className="mt-2 text-sm text-stone-400">
            Burada kapattığın kategori yalnız Schnellbestellung ekranından gizlenir. Normal internet menüsü etkilenmez.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CATEGORY_OPTIONS.map((item) => {
              const checked = effectiveVisibleCategories.includes(item.key);

              return (
                <label
                  key={item.key}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-4 ${
                    checked
                      ? "border-emerald-400/40 bg-emerald-400/10"
                      : "border-stone-700 bg-black/20 opacity-70"
                  }`}
                >
                  <span className="font-bold">{item.label}</span>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => toggleCategory(item.key, event.target.checked)}
                    className="h-5 w-5"
                  />
                </label>
              );
            })}
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-stone-700 p-5">
          <h2 className="text-xl font-black">QR modu</h2>
          <p className="mt-2 text-sm text-stone-400">
            Sabit QR masalara basılabilir. Konum kontrolü açıksa GPS otomatik doğrulanır; kapalıysa menü doğrudan açılır. Dinamik QR ekranda süreli olarak yenilenir.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className={`rounded-xl border p-4 ${settings.qrMode === "static" ? "border-amber-400 bg-amber-400/10" : "border-stone-700"}`}>
              <input
                type="radio"
                name="qrMode"
                checked={settings.qrMode === "static"}
                onChange={() => setSettings({ ...settings, qrMode: "static" })}
                className="mr-2"
              />
              <strong>Statik baskı QR</strong>
              <span className="mt-1 block text-sm text-stone-400">Masa sticker ve baskıları için.</span>
            </label>
            <label className={`rounded-xl border p-4 ${settings.qrMode === "dynamic" ? "border-amber-400 bg-amber-400/10" : "border-stone-700"}`}>
              <input
                type="radio"
                name="qrMode"
                checked={settings.qrMode === "dynamic"}
                onChange={() => setSettings({ ...settings, qrMode: "dynamic" })}
                className="mr-2"
              />
              <strong>Dinamik ekran QR</strong>
              <span className="mt-1 block text-sm text-stone-400">Süreli QR ekranda otomatik yenilenir.</span>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <a href="/schnellbestellung/access-display" target="_blank" rel="noreferrer" className="rounded-xl bg-stone-700 px-5 py-3 font-bold">
              QR ekranını aç / indir
            </a>
            <button type="button" disabled={saving} onClick={() => void runAction("rotate_static_qr")} className="rounded-xl bg-orange-600 px-5 py-3 font-bold disabled:opacity-60">
              Sabit QR'ı yenile
            </button>
            <button type="button" disabled={saving} onClick={() => void runAction("invalidate_sessions")} className="rounded-xl bg-red-600 px-5 py-3 font-bold disabled:opacity-60">
              Tüm oturumları iptal et
            </button>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-black">Güvenlik, hız ve zaman ayarları</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {NUMBER_FIELDS.map((item) => (
              <label key={item.key} className="rounded-xl border border-stone-700 p-3 text-sm">
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
        </section>

        <section className="mt-8 rounded-2xl border border-stone-700 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black">Schnellbestellung kampanyaları</h2>
              <p className="mt-1 text-sm text-stone-400">Yalnız restoran içi siparişlerde uygulanır. Normal Abholung ve Lieferung kampanyalarını etkilemez.</p>
            </div>
            <button type="button" onClick={() => setSettings({ ...settings, campaigns: [...settings.campaigns, newCampaign()] })} className="rounded-xl bg-amber-400 px-4 py-2 font-black text-black">
              Kampanya ekle
            </button>
          </div>

          <div className="mt-5 space-y-4">
            {settings.campaigns.length === 0 ? (
              <div className="rounded-xl border border-dashed border-stone-700 p-6 text-center text-stone-400">Henüz Schnellbestellung kampanyası yok.</div>
            ) : null}

            {settings.campaigns.map((campaign) => (
              <article key={campaign.id} className="rounded-2xl border border-stone-700 bg-black/20 p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <label>
                    <span className="text-sm text-stone-400">Kampanya adı</span>
                    <input value={campaign.name} onChange={(event) => updateCampaign(campaign.id, { name: event.target.value })} className="mt-1 w-full rounded bg-stone-900 p-2" />
                  </label>
                  <label>
                    <span className="text-sm text-stone-400">Menü rozeti</span>
                    <input value={campaign.badgeText || ""} onChange={(event) => updateCampaign(campaign.id, { badgeText: event.target.value })} className="mt-1 w-full rounded bg-stone-900 p-2" placeholder="Örn. -20%" />
                  </label>
                  <label>
                    <span className="text-sm text-stone-400">Kampanya tipi</span>
                    <select value={campaign.type} onChange={(event) => updateCampaign(campaign.id, { type: event.target.value as CampaignType })} className="mt-1 w-full rounded bg-stone-900 p-2">
                      <option value="percent_category">Kategori yüzde indirimi</option>
                      <option value="percent_product">Ürün yüzde indirimi</option>
                      <option value="fixed_product">Ürün sabit Angebot fiyatı</option>
                    </select>
                  </label>

                  {campaign.type === "percent_category" ? (
                    <label>
                      <span className="text-sm text-stone-400">Kategori</span>
                      <select value={campaign.targetCategory || "burger"} onChange={(event) => updateCampaign(campaign.id, { targetCategory: event.target.value as SchnellCategory })} className="mt-1 w-full rounded bg-stone-900 p-2">
                        {CATEGORY_OPTIONS.map((category) => <option key={category.key} value={category.key}>{category.label}</option>)}
                      </select>
                    </label>
                  ) : (
                    <label>
                      <span className="text-sm text-stone-400">Ürün</span>
                      <select value={campaign.targetProductId || ""} onChange={(event) => updateCampaign(campaign.id, { targetProductId: event.target.value })} className="mt-1 w-full rounded bg-stone-900 p-2">
                        <option value="">Ürün seç</option>
                        {catalog.map((product) => <option key={product.id} value={product.id}>{product.categoryLabel} · {product.name} · {product.price.toFixed(2)} €</option>)}
                      </select>
                    </label>
                  )}

                  {campaign.type === "fixed_product" ? (
                    <label>
                      <span className="text-sm text-stone-400">Sabit fiyat (€)</span>
                      <input type="number" min="0" step="0.1" value={Number(campaign.fixedPrice || 0)} onChange={(event) => updateCampaign(campaign.id, { fixedPrice: Number(event.target.value) })} className="mt-1 w-full rounded bg-stone-900 p-2" />
                    </label>
                  ) : (
                    <label>
                      <span className="text-sm text-stone-400">İndirim (%)</span>
                      <input type="number" min="1" max="100" step="1" value={Number(campaign.percent || 0)} onChange={(event) => updateCampaign(campaign.id, { percent: Number(event.target.value) })} className="mt-1 w-full rounded bg-stone-900 p-2" />
                    </label>
                  )}

                  <label>
                    <span className="text-sm text-stone-400">Başlangıç (opsiyonel)</span>
                    <input type="datetime-local" value={toLocalInput(campaign.startsAt)} onChange={(event) => updateCampaign(campaign.id, { startsAt: fromLocalInput(event.target.value) })} className="mt-1 w-full rounded bg-stone-900 p-2" />
                  </label>
                  <label>
                    <span className="text-sm text-stone-400">Bitiş (opsiyonel)</span>
                    <input type="datetime-local" value={toLocalInput(campaign.endsAt)} onChange={(event) => updateCampaign(campaign.id, { endsAt: fromLocalInput(event.target.value) })} className="mt-1 w-full rounded bg-stone-900 p-2" />
                  </label>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 font-bold">
                    <input type="checkbox" checked={campaign.active} onChange={(event) => updateCampaign(campaign.id, { active: event.target.checked })} />
                    Aktif
                  </label>
                  <button type="button" onClick={() => removeCampaign(campaign.id)} className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-bold text-red-200">
                    Kampanyayı sil
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="sticky bottom-3 z-20 mt-8 rounded-2xl border border-white/10 bg-stone-950/95 p-3 backdrop-blur">
          <button type="button" onClick={() => void saveSettings()} disabled={saving} className="w-full rounded-xl bg-emerald-500 px-5 py-3 font-black text-black disabled:opacity-60">
            {saving ? "Kaydediliyor…" : "Bütün ayarları ve kampanyaları kaydet"}
          </button>
        </div>

        {message ? <p className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 p-3 text-emerald-100">{message}</p> : null}
        {error ? <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-red-200">{error}</p> : null}
      </div>
    </main>
  );
}
