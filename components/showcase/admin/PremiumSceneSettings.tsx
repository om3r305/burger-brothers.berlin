"use client";

import {
  DEFAULT_WEATHER_MESSAGES,
  SPECIAL_DAY_PRESETS,
  applySpecialDayPreset,
  type SpecialDayPresetKey,
  type WeatherCopyKey,
} from "@/lib/showcase/presets";
import type {
  ShowcaseBestseller,
  ShowcaseReview,
  ShowcaseScene,
  ShowcaseWeather,
} from "@/lib/showcase/types";

type Props = {
  scene: ShowcaseScene;
  weather?: ShowcaseWeather | null;
  reviews: ShowcaseReview[];
  bestsellers: ShowcaseBestseller[];
  bestsellerGeneratedAt?: string;
  automaticWeatherText: string;
  inputClass: string;
  onChange: (patch: Partial<ShowcaseScene>, structural?: boolean) => void;
};

const weatherLabels: Record<WeatherCopyKey, string> = {
  rainMorning: "Yağmur · gündüz",
  rainEvening: "Yağmur · akşam",
  snowCold: "Kar / soğuk",
  hot: "Sıcak hava",
  lateNight: "Gece geç saat",
  evening: "Akşam",
  lunch: "Öğle saati",
  cloudy: "Bulutlu",
  sunny: "Güneşli",
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-semibold text-stone-200">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-stone-500">{hint}</span> : null}
    </label>
  );
}

function localDate(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "";
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.valueOf() - offset).toISOString().slice(0, 16);
}

function isoDate(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.valueOf()) ? date.toISOString() : undefined;
}

export default function PremiumSceneSettings({
  scene,
  weather,
  reviews,
  bestsellers,
  bestsellerGeneratedAt,
  automaticWeatherText,
  inputClass,
  onChange,
}: Props) {
  const isReviewQr = scene.type === "qr" && scene.qrVariant === "google-review";
  const isCountdown = scene.type === "campaign" && scene.campaignVariant === "countdown";
  const isSpecialDay = scene.type === "message" && scene.messageVariant === "special-day";
  const visible = scene.type === "weather" || scene.type === "reviews" || scene.type === "bestseller" || isReviewQr || isCountdown || isSpecialDay;
  if (!visible) return null;

  const approved = reviews.filter((review) => review.approved);
  const eligible = approved.filter((review) =>
    review.rating >= Number(scene.reviewMinRating || 4) &&
    (!scene.reviewOnlyWithPhoto || Boolean(review.photoUrls?.length)),
  );
  const presetKey = (scene.specialPreset && scene.specialPreset in SPECIAL_DAY_PRESETS
    ? scene.specialPreset
    : "classic") as SpecialDayPresetKey;
  const preset = SPECIAL_DAY_PRESETS[presetKey];

  return (
    <section className="rounded-2xl border border-fuchsia-700/40 bg-fuchsia-950/20 p-4">
      <div className="text-xs font-black uppercase tracking-[.16em] text-fuchsia-300">Canlı ve özel sahne ayarları</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {scene.type === "reviews" ? (
          <>
            <Field label="Minimum yıldız">
              <input type="number" min={1} max={5} className={inputClass} value={scene.reviewMinRating || 4} onChange={(event) => onChange({ reviewMinRating: Number(event.target.value) })} />
            </Field>
            <Field label="Sıralama">
              <select className={inputClass} value={scene.reviewSort || "newest"} onChange={(event) => onChange({ reviewSort: event.target.value as "newest" | "random" })}>
                <option value="newest">En yeni yorumlar</option>
                <option value="random">Onaylı yorumlardan karışık</option>
              </select>
            </Field>
            <Field label="Gösterilecek yorum">
              <input type="number" min={1} max={30} className={inputClass} value={scene.reviewLimit || 8} onChange={(event) => onChange({ reviewLimit: Number(event.target.value) })} />
            </Field>
            <Field label="Sadece fotoğraflı">
              <button type="button" className={`${inputClass} text-left`} onClick={() => onChange({ reviewOnlyWithPhoto: !scene.reviewOnlyWithPhoto })}>{scene.reviewOnlyWithPhoto ? "Evet" : "Hayır"}</button>
            </Field>
            <div className="sm:col-span-2 xl:col-span-3 rounded-xl border border-amber-700/40 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-100">
              <b>Yayın kuralı:</b> TV yalnız admin tarafından onaylanan yorumları gösterir.<br />
              <b>Toplam:</b> {reviews.length} · <b>Onaylı:</b> {approved.length} · <b>Bu filtreyle gösterilebilir:</b> {eligible.length}
              {eligible.length === 0 ? <div className="mt-1 text-amber-300">Bu filtrelere uyan onaylı yorum yok. Minimum yıldızı veya fotoğraf filtresini kontrol et.</div> : null}
            </div>
          </>
        ) : null}

        {scene.type === "weather" ? (
          <>
            <Field label="Metin modu">
              <select className={inputClass} value={scene.weatherMode || "auto"} onChange={(event) => onChange({ weatherMode: event.target.value as "auto" | "custom" })}>
                <option value="auto">Hava ve saate göre otomatik</option>
                <option value="custom">Yukarıdaki ek metni kullan</option>
              </select>
            </Field>
            <div className="sm:col-span-2 rounded-xl border border-sky-700/40 bg-sky-950/25 p-3 text-xs leading-relaxed text-sky-100">
              <b>Canlı kaynak:</b> {weather?.source === "cache_fallback" ? "Open-Meteo · son sağlam veri" : "Open-Meteo"}<br />
              <b>Konum:</b> {weather?.locationLabel || "Berlin-Tegel"}<br />
              <b>Son veri:</b> {weather ? `${Math.round(weather.temperature)}°C · ${weather.label} · ${new Date(weather.updatedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}` : "Henüz canlı veri alınamadı"}<br />
              <b>Şu an seçilen otomatik metin:</b> {automaticWeatherText || "Aktuelle Wetterdaten werden gerade geladen."}
              {weather?.stale ? <div className="mt-1 text-amber-300">Bağlantı sorunu nedeniyle son sağlam hava verisi kullanılıyor.</div> : null}
            </div>
            <div className="sm:col-span-2 xl:col-span-3 rounded-xl border border-stone-800 bg-black/20 p-3">
              <div className="mb-3 text-sm font-black text-white">Hazır Almanca hava metinleri</div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {(Object.keys(DEFAULT_WEATHER_MESSAGES) as WeatherCopyKey[]).map((key) => (
                  <Field key={key} label={weatherLabels[key]} hint={`Varsayılan: ${DEFAULT_WEATHER_MESSAGES[key]}`}>
                    <textarea
                      rows={2}
                      className={inputClass}
                      value={scene.weatherMessages?.[key] ?? ""}
                      placeholder={DEFAULT_WEATHER_MESSAGES[key]}
                      onChange={(event) => onChange({
                        weatherMessages: {
                          ...(scene.weatherMessages || {}),
                          [key]: event.target.value,
                        },
                      })}
                    />
                  </Field>
                ))}
              </div>
              <button type="button" className="mt-3 rounded-lg border border-stone-700 px-3 py-2 text-xs font-bold text-stone-200 hover:bg-stone-800" onClick={() => onChange({ weatherMessages: {} }, true)}>Hazır metinlere dön</button>
            </div>
          </>
        ) : null}

        {isCountdown ? (
          <>
            <Field label="Geri sayım bitiş zamanı">
              <input type="datetime-local" className={inputClass} value={localDate(scene.countdownTargetAt || scene.endAt)} onChange={(event) => onChange({ countdownTargetAt: isoDate(event.target.value), endAt: isoDate(event.target.value) })} />
            </Field>
            <Field label="Süre bitince">
              <select className={inputClass} value={scene.countdownEndBehavior || "skip"} onChange={(event) => onChange({ countdownEndBehavior: event.target.value as "skip" | "ended" })}>
                <option value="skip">Sahneyi otomatik atla</option>
                <option value="ended">“AKTION BEENDET” göster</option>
              </select>
            </Field>
            <div className="rounded-xl border border-orange-700/40 bg-orange-950/20 p-3 text-xs text-orange-100">
              {scene.countdownTargetAt || scene.endAt
                ? new Date(scene.countdownTargetAt || scene.endAt || "").valueOf() <= Date.now()
                  ? "Kampanya süresi doldu. Seçime göre sahne atlanır veya sona erdi mesajı gösterilir."
                  : `Bitiş: ${new Date(scene.countdownTargetAt || scene.endAt || "").toLocaleString("de-DE")}`
                : "Bitiş zamanı seçilmedi."}
            </div>
          </>
        ) : null}

        {scene.type === "bestseller" ? (
          <>
            <Field label="Dönem (gün)">
              <input type="number" min={1} max={365} className={inputClass} value={scene.bestsellerPeriodDays || 7} onChange={(event) => onChange({ bestsellerPeriodDays: Number(event.target.value) }, true)} />
            </Field>
            <Field label="Gösterilecek ürün">
              <input type="number" min={1} max={10} className={inputClass} value={scene.bestsellerLimit || 5} onChange={(event) => onChange({ bestsellerLimit: Number(event.target.value) })} />
            </Field>
            <div className="sm:col-span-2 xl:col-span-3 rounded-xl border border-amber-700/40 bg-amber-950/20 p-3 text-xs text-amber-100">
              <b>Kaynak:</b> İptal edilmemiş gerçek siparişler · <b>Dönem:</b> son {scene.bestsellerPeriodDays || 7} gün · <b>Bulunan:</b> {bestsellers.length} ürün
              {bestsellerGeneratedAt ? <> · <b>Hesaplandı:</b> {new Date(bestsellerGeneratedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</> : null}
              {bestsellers.slice(0, Number(scene.bestsellerLimit || 5)).map((item, index) => <div key={`${item.productId || item.name}-${index}`} className="mt-1">{index + 1}. {item.name} — {item.quantity} adet</div>)}
              {bestsellers.length === 0 ? <div className="mt-1 text-amber-300">Bu tarih aralığında uygun sipariş verisi bulunamadı.</div> : null}
            </div>
          </>
        ) : null}

        {isSpecialDay ? (
          <>
            <Field label="Hazır özel gün tasarımı">
              <select
                className={inputClass}
                value={presetKey}
                onChange={(event) => {
                  const key = event.target.value as SpecialDayPresetKey;
                  onChange({ ...applySpecialDayPreset(key), specialAutoSchedule: scene.specialAutoSchedule }, true);
                }}
              >
                {Object.values(SPECIAL_DAY_PRESETS).map((item) => <option key={item.key} value={item.key}>{item.emoji} {item.label}</option>)}
              </select>
            </Field>
            <Field label="Manuel emoji" hint="İstediğin emojiyi yazabilirsin: 🎃 🇩🇪 🐻 🎄">
              <input className={inputClass} value={scene.specialEmoji || ""} maxLength={16} onChange={(event) => onChange({ specialEmoji: event.target.value })} />
            </Field>
            <Field label="Özel logo / görsel URL" hint="Cloudinary görsel URL’si ekleyebilirsin. Boşsa emoji kullanılır.">
              <input className={inputClass} value={scene.specialLogoUrl || ""} onChange={(event) => onChange({ specialLogoUrl: event.target.value || undefined })} />
            </Field>
            <Field label="Otomatik tarih">
              <button type="button" className={`${inputClass} text-left`} onClick={() => onChange({ specialAutoSchedule: !scene.specialAutoSchedule }, true)}>
                {scene.specialAutoSchedule ? "Açık — hazır tarih aralığında göster" : "Kapalı — manuel başlangıç/bitiş kullan"}
              </button>
            </Field>
            <div className="rounded-xl border border-fuchsia-700/40 bg-black/20 p-3 text-xs leading-relaxed text-fuchsia-100 sm:col-span-2">
              <b>{preset.emoji} {preset.label}</b><br />
              Hazır takvim: {preset.scheduleLabel}. Başlık, alt başlık, duyuru metni, rozet, emoji, logo, renk ve tarihlerin tamamını manuel değiştirebilirsin.
            </div>
          </>
        ) : null}

        {isReviewQr ? (
          <>
            <Field label="Google yorum bağlantısı">
              <input className={inputClass} value={scene.qrUrl || ""} onChange={(event) => onChange({ qrUrl: event.target.value })} />
            </Field>
            <div className="sm:col-span-2 rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-3 text-xs leading-relaxed text-emerald-100">
              QR doğrudan Google yorum sayfasına gitmelidir. Müşteri buradan puanını, yorumunu ve fotoğrafını paylaşabilir. Başlık, metin ve QR açıklaması yukarıdaki alanlardan tamamen düzenlenebilir.
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
