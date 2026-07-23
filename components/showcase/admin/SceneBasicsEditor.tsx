"use client";

import {
  CANONICAL_SCENE_TYPES,
  TYPE_LABELS,
  campaignScenePatch,
  canonicalSceneType,
  reviewQrPatch,
  socialVideoPatch,
  specialDayPatch,
  type CanonicalShowcaseSceneType,
} from "@/lib/showcase/editor";
import type { ShowcaseCampaign, ShowcaseDocument, ShowcaseProduct, ShowcaseScene } from "@/lib/showcase/types";

type Props = {
  scene: ShowcaseScene;
  document: ShowcaseDocument;
  products: ShowcaseProduct[];
  campaigns: ShowcaseCampaign[];
  sceneDuration: number;
  inputClass: string;
  onChange: (patch: Partial<ShowcaseScene>, structural?: boolean) => void;
  onTypeChange: (type: CanonicalShowcaseSceneType) => void;
};

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block space-y-1.5"><span className="text-sm font-semibold text-stone-200">{label}</span>{children}{hint ? <span className="block text-xs text-stone-500">{hint}</span> : null}</label>;
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

export default function SceneBasicsEditor({ scene, document, products, campaigns, sceneDuration, inputClass, onChange, onTypeChange }: Props) {
  const selectedCampaign = campaigns.find((campaign) => campaign.id === scene.campaignId);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Dahili ad"><input className={inputClass} value={scene.name} onChange={(event) => onChange({ name: event.target.value })} /></Field>
      <Field label="Sahne türü">
        <select className={inputClass} value={canonicalSceneType(scene.type)} onChange={(event) => onTypeChange(event.target.value as CanonicalShowcaseSceneType)}>
          {CANONICAL_SCENE_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
        </select>
      </Field>

      {scene.type === "video" ? <Field label="Video türü"><select className={inputClass} value={scene.videoVariant || "standard"} onChange={(event) => {
        const variant = event.target.value as "standard" | "social";
        onChange(variant === "social" ? socialVideoPatch() : { videoVariant: "standard", name: "Video" }, true);
      }}><option value="standard">Normal video</option><option value="social">Instagram / TikTok videosu</option></select></Field> : null}

      {scene.type === "qr" ? <Field label="QR kullanım türü"><select className={inputClass} value={scene.qrVariant || "order"} onChange={(event) => {
        const variant = event.target.value as "order" | "google-review" | "custom";
        if (variant === "google-review") onChange(reviewQrPatch(document), true);
        else onChange({ qrVariant: variant, name: variant === "order" ? "Online sipariş" : "Özel QR" }, true);
      }}><option value="order">Online sipariş</option><option value="google-review">Google yorum çağrısı</option><option value="custom">Özel bağlantı</option></select></Field> : null}

      {scene.type === "campaign" ? <Field label="Kampanya görünümü"><select className={inputClass} value={scene.campaignVariant || "standard"} onChange={(event) => {
        const variant = event.target.value as "standard" | "countdown";
        onChange(selectedCampaign ? campaignScenePatch(selectedCampaign, variant) : {
          campaignVariant: variant,
          countdownTargetAt: variant === "countdown" ? scene.countdownTargetAt || new Date(Date.now() + 14 * 86_400_000).toISOString() : undefined,
        }, true);
      }}><option value="standard">Standart kampanya</option><option value="countdown">Geri sayımlı kampanya</option></select></Field> : null}

      {scene.type === "message" ? <Field label="Duyuru türü"><select className={inputClass} value={scene.messageVariant || "standard"} onChange={(event) => {
        const variant = event.target.value as "standard" | "special-day";
        onChange(variant === "special-day" ? specialDayPatch() : { messageVariant: "standard", name: "Duyuru", specialPreset: undefined, specialAutoSchedule: false }, true);
      }}><option value="standard">Standart duyuru</option><option value="special-day">Özel gün / kutlama</option></select></Field> : null}

      <Field label="Başlık" hint="Boş bırakırsan ekranda başlık gösterilmez."><input className={inputClass} value={scene.title ?? ""} onChange={(event) => onChange({ title: event.target.value })} /></Field>
      <Field label="Alt başlık" hint="Boş bırakırsan ekranda alt başlık gösterilmez."><input className={inputClass} value={scene.subtitle ?? ""} onChange={(event) => onChange({ subtitle: event.target.value })} /></Field>
      <Field label="Rozet / küçük başlık" hint="Boş bırakırsan rozet gösterilmez."><input className={inputClass} value={scene.badge ?? ""} onChange={(event) => onChange({ badge: event.target.value })} /></Field>
      {scene.type === "product" || scene.type === "menu" ? <Field label="Toplam sahne süresi" hint="İçeriğe göre hesaplanır ve güvenli limitler uygulanır."><div className={`${inputClass} cursor-default text-stone-300`}>{sceneDuration} saniye</div></Field> : <Field label="Süre (saniye)" hint="Videolarda aynı zamanda güvenlik süresidir."><input type="number" min={5} max={3600} className={inputClass} value={scene.durationSeconds} onChange={(event) => onChange({ durationSeconds: Number(event.target.value) })} /></Field>}

      <div className="md:col-span-2"><Field label={scene.type === "message" ? "Duyuru metni" : "Ek metin"} hint="Boş bırakırsan bu alan ekranda görünmez."><textarea rows={scene.type === "message" ? 5 : 3} className={inputClass} value={scene.body ?? ""} onChange={(event) => onChange({ body: event.target.value })} /></Field></div>
      {scene.type === "message" ? <div className="md:col-span-2 rounded-xl border border-orange-500/25 bg-orange-500/5 p-3 text-xs leading-5 text-stone-300">Standart duyuru veya özel gün seçebilirsin. Özel gün seçildiğinde hazır tema, emoji, logo ve otomatik tarih ayarları aşağıda açılır.</div> : null}

      <Field label="Geçiş efekti"><select className={inputClass} value={scene.transition} onChange={(event) => onChange({ transition: event.target.value as ShowcaseScene["transition"] })}><option value="fade">Yumuşak geçiş</option><option value="slide">Yandan geçiş</option><option value="zoom">Yumuşak yakınlaştırma</option><option value="none">Efektsiz</option></select></Field>
      <Field label="Vurgu rengi"><input type="color" className={`${inputClass} h-11 p-1`} value={scene.accent || "#ff9d2e"} onChange={(event) => onChange({ accent: event.target.value })} /></Field>

      {scene.type === "video" ? <Field label="Videoya bağlı ürün"><select className={inputClass} value={scene.productId || ""} onChange={(event) => onChange({ productId: event.target.value || undefined, productIds: event.target.value ? [event.target.value] : [] })}><option value="">Ürün bağlama</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} · {(product.displayPrice ?? product.price).toFixed(2)} €</option>)}</select></Field> : null}

      {scene.type === "campaign" ? <>
        <Field label="Veritabanından kampanya"><select className={inputClass} value={scene.campaignId || ""} onChange={(event) => {
          const campaign = campaigns.find((item) => item.id === event.target.value);
          onChange(campaign ? campaignScenePatch(campaign, scene.campaignVariant || "standard") : { campaignId: undefined, campaignAutoContent: false }, true);
        }}><option value="">Kampanya bağlama</option>{campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}</select></Field>
        <Field label="Kampanya verisini otomatik kullan"><button type="button" className={`${inputClass} text-left`} onClick={() => {
          const enabled = scene.campaignAutoContent === false;
          if (enabled && selectedCampaign) onChange(campaignScenePatch(selectedCampaign, scene.campaignVariant || "standard"), true);
          else onChange({ campaignAutoContent: enabled }, true);
        }}>{scene.campaignAutoContent !== false ? "Açık — başlık, oran, rozet ve tarihler DB’den canlı gelir" : "Kapalı — metinleri ben yazacağım"}</button></Field>
        {selectedCampaign && scene.campaignAutoContent !== false ? <div className="md:col-span-2 rounded-xl border border-emerald-700/40 bg-emerald-950/20 p-3 text-xs text-emerald-100">Bağlı kampanya: <b>{selectedCampaign.title}</b>. Kampanya panelindeki değişiklikler TV’de yeniden yazı girmeden görünür.</div> : null}
      </> : null}

      {scene.type !== "product" && scene.type !== "menu" ? <Field label="Medya yerleşimi"><select className={inputClass} value={scene.fit || "cover"} onChange={(event) => onChange({ fit: event.target.value as "cover" | "contain" })}><option value="cover">Ekranı tamamen doldur</option><option value="contain">Dosyanın tamamını göster</option></select></Field> : null}
      <Field label="Başlangıç zamanı (isteğe bağlı)"><input type="datetime-local" className={inputClass} value={localDate(scene.startAt)} onChange={(event) => onChange({ startAt: isoDate(event.target.value) })} /></Field>
      <Field label="Bitiş zamanı (isteğe bağlı)"><input type="datetime-local" className={inputClass} value={localDate(scene.endAt)} onChange={(event) => onChange({ endAt: isoDate(event.target.value) })} /></Field>

      <div className="md:col-span-2 rounded-xl border border-stone-800 bg-stone-950/60 p-3"><div className="grid gap-3 sm:grid-cols-4">
        {scene.type === "product" || scene.type === "menu" || scene.type === "hero" ? <div className="flex items-center justify-between gap-3 text-sm text-stone-400"><span>Logo</span><span className="rounded-full border border-stone-700 bg-stone-900 px-2 py-1 text-[11px] font-bold text-stone-300">{scene.type === "hero" ? "Girişte sabit" : "Bu sahnede kapalı"}</span></div> : <label className="flex items-center justify-between gap-3 text-sm">Logoyu göster<input type="checkbox" checked={scene.showLogo !== false} onChange={(event) => onChange({ showLogo: event.target.checked })} /></label>}
        <label className="flex items-center justify-between gap-3 text-sm">QR kodu göster<input type="checkbox" checked={scene.showQr === true} onChange={(event) => onChange({ showQr: event.target.checked })} /></label>
        <label className="flex items-center justify-between gap-3 text-sm">Fiyatı göster<input type="checkbox" checked={scene.showPrice !== false} onChange={(event) => onChange({ showPrice: event.target.checked })} /></label>
        {scene.type === "video" ? <label className="flex items-center justify-between gap-3 text-sm">Video sesi<input type="checkbox" checked={scene.muted === false} onChange={(event) => onChange({ muted: !event.target.checked }, true)} /></label> : <span />}
      </div></div>
      {scene.type === "video" && scene.muted === false ? <div className="md:col-span-2 rounded-xl border border-amber-700/50 bg-amber-950/30 p-3 text-xs text-amber-200">Sesli otomatik oynatma bazı Smart TV ve tarayıcılarda engellenebilir. En güvenli kullanım sessiz videodur.</div> : null}
      <Field label="QR hedefi (boş = varsayılan)"><input className={inputClass} value={scene.qrUrl || ""} placeholder={document.settings.qrUrl} onChange={(event) => onChange({ qrUrl: event.target.value })} /></Field>
      <Field label="QR açıklaması" hint="Boş bırakırsan QR kodunun altında açıklama gösterilmez."><input className={inputClass} value={scene.qrLabel ?? ""} onChange={(event) => onChange({ qrLabel: event.target.value })} /></Field>
    </div>
  );
}
