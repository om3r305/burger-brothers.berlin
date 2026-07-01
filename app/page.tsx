"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { siteConfig } from "@/config/site.config";
import VideoBG from "@/components/VideoBG";
import {
  LS_SETTINGS,
  readSettings,
  fetchAndApplyRemoteSettings,
} from "@/lib/settings";
import {
  getAllCoupons,
  getAllIssued,
  syncCouponsFromServer,
  type CouponDef,
  type IssuedCoupon,
} from "@/lib/coupons";

type PromoItem = {
  title?: string;
  text?: string;
  imageUrl?: string;
  ctaLabel?: string;
  ctaHref?: string;
  enabled?: boolean;
  startsAt?: string;
  endsAt?: string;
};

type LandingCoupon = {
  def: CouponDef;
  issued: IssuedCoupon;
  code: string;
  validUntil: number | null;
};

const LS_CHECKOUT = "bb_checkout_info_v1";
const LS_ACTIVE_COUPON = "bb_active_coupon_code";
const LS_ACTIVE_COUPON_META = "bb_active_coupon_meta";
const PROFILE_KEY = "bb_checkout_profile_v2";

function isPromoActive(item: PromoItem) {
  if (!item) return false;
  if (item.enabled === false) return false;

  const now = Date.now();

  if (item.startsAt) {
    const startMs = Date.parse(item.startsAt);
    if (Number.isFinite(startMs) && now < startMs) return false;
  }

  if (item.endsAt) {
    const endMs = Date.parse(item.endsAt);
    if (Number.isFinite(endMs) && now > endMs) return false;
  }

  const hasContent =
    Boolean(String(item.title || "").trim()) ||
    Boolean(String(item.text || "").trim()) ||
    Boolean(String(item.imageUrl || "").trim());

  return hasContent;
}

function pickLandingPromo(settings: any): PromoItem | null {
  const announcements = settings?.announcements;

  if (!announcements?.enabled) return null;

  const items = Array.isArray(announcements?.items) ? announcements.items : [];

  const active = items.find((item: PromoItem) => isPromoActive(item));

  return active || null;
}

function promoStorageKey(promo: PromoItem | null) {
  if (!promo) return "";

  const raw = [
    promo.title || "",
    promo.text || "",
    promo.imageUrl || "",
    promo.startsAt || "",
    promo.endsAt || "",
  ].join("|");

  let hash = 0;

  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }

  return `bb_landing_promo_closed_${Math.abs(hash)}`;
}

function formatDateRange(promo: PromoItem | null) {
  if (!promo?.startsAt && !promo?.endsAt) return "";

  const fmt = (value?: string) => {
    if (!value) return "";

    const date = new Date(value);
    if (!Number.isFinite(date.valueOf())) return "";

    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  };

  const start = fmt(promo.startsAt);
  const end = fmt(promo.endsAt);

  if (start && end) return `${start} – ${end}`;
  if (start) return `ab ${start}`;
  if (end) return `bis ${end}`;

  return "";
}

function cleanCode(value: any) {
  return String(value || "")
    .replace(/[\s\u00A0\u2000-\u200B\u202F\u205F\u3000\uFEFF]/g, "")
    .trim()
    .toUpperCase();
}

function normalizePhone(value?: string | null) {
  return String(value ?? "").replace(/[^\d+]/g, "").trim();
}

function samePhone(left?: string | null, right?: string | null) {
  const a = normalizePhone(left);
  const b = normalizePhone(right);

  return Boolean(a && b && a === b);
}

function readJson<T = any>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function readKnownCustomerPhone() {
  try {
    const checkout = readJson<any>(LS_CHECKOUT);
    const checkoutPhone = normalizePhone(checkout?.addr?.phone);

    if (checkoutPhone) return checkoutPhone;

    const checkoutMode =
      checkout?.orderMode === "pickup" || checkout?.orderMode === "delivery"
        ? checkout.orderMode
        : null;

    if (checkoutMode) {
      const profile = readJson<any>(`${PROFILE_KEY}:${checkoutMode}`);
      const profilePhone = normalizePhone(profile?.phone);

      if (profilePhone) return profilePhone;
    }

    const pickupProfile = readJson<any>(`${PROFILE_KEY}:pickup`);
    const pickupPhone = normalizePhone(pickupProfile?.phone);

    if (pickupPhone) return pickupPhone;

    const deliveryProfile = readJson<any>(`${PROFILE_KEY}:delivery`);
    const deliveryPhone = normalizePhone(deliveryProfile?.phone);

    if (deliveryPhone) return deliveryPhone;
  } catch {}

  return "";
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

function formatCouponDate(value?: number | null) {
  if (!value) return "ohne Ablaufdatum";

  try {
    return new Date(value).toLocaleDateString("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch {
    return "ohne Ablaufdatum";
  }
}

function couponTitle(def: CouponDef) {
  if (def.title) return def.title;

  if (def.type === "percent") return `${Number(def.value || 0)}% Rabatt`;
  if (def.type === "fixed") return `${formatMoney(Number(def.value || 0))} Rabatt`;
  if (def.type === "free_item") return `Gratis ${def.meta?.freeItemName || "Artikel"}`;
  if (def.type === "bogo") return "Gratis-Aktion";

  return "Gutschein";
}

function couponText(def: CouponDef) {
  if (def.meta?.aboutText) return String(def.meta.aboutText);

  if (def.type === "percent") {
    return `${Number(def.value || 0)}% Rabatt auf Ihre nächste Bestellung.`;
  }

  if (def.type === "fixed") {
    return `${formatMoney(Number(def.value || 0))} Rabatt auf Ihre nächste Bestellung.`;
  }

  if (def.type === "free_item") {
    return `Gratis: ${def.meta?.freeItemName || "Artikel"}.`;
  }

  if (def.type === "bogo") {
    const bogo = def.meta?.bogo;

    if (bogo) {
      return `${bogo.buyQty} kaufen, ${bogo.freeQty} gratis.`;
    }

    return "Gratis-Aktion für Ihre Bestellung.";
  }

  return "Ihr persönlicher Gutschein wartet auf Sie.";
}

function landingCouponStorageKey(coupon: LandingCoupon | null) {
  if (!coupon?.code) return "";

  return `bb_landing_coupon_closed_${coupon.issued.id || coupon.code}`;
}

function isIssuedUsableForLanding(params: {
  issued: IssuedCoupon;
  def: CouponDef;
  phone: string;
  now: number;
}) {
  const { issued, def, phone, now } = params;

  if (!samePhone(issued.assignedToPhone, phone)) return false;
  if (issued.used) return false;
  if (issued.note === "cancelled") return false;
  if (issued.note === "scheduled" && issued.issuedAt > now) return false;
  if (issued.expiresAt && issued.expiresAt < now) return false;

  if (def.validFrom && now < def.validFrom) return false;
  if (def.validUntil && now > def.validUntil) return false;

  return true;
}

function findLandingCouponForPhone(phoneInput: string): LandingCoupon | null {
  const phone = normalizePhone(phoneInput);

  if (!phone || phone.length < 6) return null;

  const now = Date.now();
  const coupons = getAllCoupons();
  const issued = getAllIssued();

  const activeCode = cleanCode(
    typeof window !== "undefined" ? localStorage.getItem(LS_ACTIVE_COUPON) || "" : "",
  );

  const candidates = issued
    .filter((item) => {
      const def = coupons.find((coupon) => coupon.id === item.couponId) || null;

      if (!def) return false;

      return isIssuedUsableForLanding({
        issued: item,
        def,
        phone,
        now,
      });
    })
    .sort((a, b) => {
      const aExpires = a.expiresAt || Number.MAX_SAFE_INTEGER;
      const bExpires = b.expiresAt || Number.MAX_SAFE_INTEGER;

      if (aExpires !== bExpires) return aExpires - bExpires;

      return (b.issuedAt || 0) - (a.issuedAt || 0);
    });

  for (const item of candidates) {
    const def = coupons.find((coupon) => coupon.id === item.couponId) || null;

    if (!def) continue;

    const code = cleanCode(item.code || def.code);

    if (!code) continue;

    if (activeCode && activeCode === code) {
      continue;
    }

    return {
      def,
      issued: item,
      code,
      validUntil: item.expiresAt ?? def.validUntil ?? null,
    };
  }

  return null;
}

function persistLandingCoupon(coupon: LandingCoupon) {
  try {
    const meta = {
      kind: "issued",
      couponId: coupon.def.id,
      issuedId: coupon.issued.id ?? null,
      code: coupon.code,
      type: coupon.def.type,
      value: Number(coupon.def.value || 0),
      title: coupon.def.title,
      discountAmount: 0,
      message: couponText(coupon.def),
    };

    localStorage.setItem(LS_ACTIVE_COUPON, cleanCode(coupon.code));
    localStorage.setItem(LS_ACTIVE_COUPON_META, JSON.stringify(meta));

    window.dispatchEvent(new CustomEvent("bb_coupon_changed"));
    window.dispatchEvent(new CustomEvent("bb:coupon-sync"));
  } catch {}
}

export default function HomePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [settingsTick, setSettingsTick] = useState(0);
  const [promoOpen, setPromoOpen] = useState(false);
  const [landingCoupon, setLandingCoupon] = useState<LandingCoupon | null>(null);
  const [couponOpen, setCouponOpen] = useState(false);

  const clickRef = useRef<HTMLAudioElement | null>(null);
  const fireRef = useRef<HTMLAudioElement | null>(null);
  const grillRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const vol = siteConfig?.audio?.volume ?? {};
    const vClick = typeof vol.click === "number" ? vol.click : 0.8;
    const vFire = typeof vol.fire === "number" ? vol.fire : 0.45;
    const vGrill = typeof vol.grill === "number" ? vol.grill : 0.45;

    clickRef.current = new Audio(siteConfig.audio.click);
    fireRef.current = new Audio(siteConfig.audio.fireLoop);
    grillRef.current = new Audio(siteConfig.audio.grillLoop);

    if (clickRef.current) {
      clickRef.current.volume = Math.min(Math.max(vClick, 0), 1);
    }

    if (fireRef.current) {
      fireRef.current.loop = true;
      fireRef.current.volume = Math.min(Math.max(vFire, 0), 1);
    }

    if (grillRef.current) {
      grillRef.current.loop = true;
      grillRef.current.volume = Math.min(Math.max(vGrill, 0), 1);
    }

    setReady(true);

    return () => {
      fireRef.current?.pause();
      grillRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    let stop = false;

    const refreshSettings = async () => {
      try {
        await fetchAndApplyRemoteSettings();
      } catch {}

      if (!stop) {
        setSettingsTick((tick) => tick + 1);
      }
    };

    refreshSettings();

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === LS_SETTINGS) {
        setSettingsTick((tick) => tick + 1);
      }
    };

    const onSettingsChanged = () => {
      setSettingsTick((tick) => tick + 1);
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("bb_settings_changed", onSettingsChanged as EventListener);
    window.addEventListener("bb:settings-sync", onSettingsChanged as EventListener);

    return () => {
      stop = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("bb_settings_changed", onSettingsChanged as EventListener);
      window.removeEventListener("bb:settings-sync", onSettingsChanged as EventListener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let syncInFlight = false;

    async function refreshLandingCoupon(options: { sync?: boolean } = {}) {
      const phone = readKnownCustomerPhone();

      if (!phone) {
        if (!cancelled) {
          setLandingCoupon(null);
          setCouponOpen(false);
        }

        return;
      }

      if (options.sync && !syncInFlight) {
        syncInFlight = true;

        try {
          await syncCouponsFromServer();
        } catch {}

        syncInFlight = false;
      }

      if (cancelled) return;

      const found = findLandingCouponForPhone(phone);

      if (!found) {
        setLandingCoupon(null);
        setCouponOpen(false);
        return;
      }

      const key = landingCouponStorageKey(found);
      let closed = false;

      try {
        closed = sessionStorage.getItem(key) === "1";
      } catch {}

      setLandingCoupon(found);
      setCouponOpen(!closed);
    }

    void refreshLandingCoupon({ sync: true });

    const onStorage = (event: StorageEvent) => {
      const key = event.key || "";

      if (
        !event.key ||
        key === LS_CHECKOUT ||
        key === LS_ACTIVE_COUPON ||
        key === LS_ACTIVE_COUPON_META ||
        key.startsWith(PROFILE_KEY)
      ) {
        void refreshLandingCoupon({ sync: false });
      }
    };

    const onFocus = () => {
      void refreshLandingCoupon({ sync: true });
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refreshLandingCoupon({ sync: true });
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const settings = useMemo(() => readSettings() as any, [settingsTick]);
  const promo = useMemo(() => pickLandingPromo(settings), [settings]);
  const promoKey = useMemo(() => promoStorageKey(promo), [promo]);
  const promoDateRange = useMemo(() => formatDateRange(promo), [promo]);

  useEffect(() => {
    if (!promo || !promoKey) {
      setPromoOpen(false);
      return;
    }

    try {
      const closed = sessionStorage.getItem(promoKey) === "1";
      setPromoOpen(!closed);
    } catch {
      setPromoOpen(true);
    }
  }, [promo, promoKey]);

  const closePromo = () => {
    try {
      if (promoKey) {
        sessionStorage.setItem(promoKey, "1");
      }
    } catch {}

    setPromoOpen(false);
  };

  const closeCoupon = () => {
    try {
      const key = landingCouponStorageKey(landingCoupon);
      if (key) {
        sessionStorage.setItem(key, "1");
      }
    } catch {}

    setCouponOpen(false);
  };

  const handleCouponCta = () => {
    if (landingCoupon) {
      persistLandingCoupon(landingCoupon);
    }

    closeCoupon();
    router.push("/menu");
  };

  const handlePromoCta = () => {
    const href = String(promo?.ctaHref || "").trim();

    closePromo();

    if (href) {
      router.push(href);
    }
  };

  const handleEnter = () => {
    try {
      if (clickRef.current) {
        clickRef.current.currentTime = 0;
        void clickRef.current.play().catch(() => {});
      }

      void fireRef.current?.play().catch(() => {});
      void grillRef.current?.play().catch(() => {});
    } catch {
      // iOS/Safari ses politikası nedeniyle sessiz geçilebilir.
    }

    router.push("/menu");
  };

  return (
    <main id="bb-landing-page" className="relative flex min-h-svh items-center justify-center overflow-hidden bg-black">
      {/* 🔥 Arka plan videosu — autoplay düşerse “Arka planı başlat” butonu çıkar */}
      <VideoBG
        src="/flames/flame-loop.mp4"
        poster="/flames/poster.jpg"
        lighten={0.35}
        shiftY="-6%"
      />

      {/* Üstten hafif koyulaştırma: logonun okunaklı kalması için */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-black/20 to-transparent" />

      {/* Altta amber glow: canlılık + alttaki siyah bantı öldürür */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/55 via-amber-400/14 to-transparent mix-blend-screen sm:h-40" />

      {/* Logo + Lokasyon + CTA */}
      <div
        className="relative z-10 mx-auto flex max-w-screen-md flex-col items-center gap-3 p-5 text-center sm:gap-4 sm:p-6"
        style={{ transform: "translateY(-9vh)" }}
      >
        <Image
          src={siteConfig.brand.logoPath}
          alt={siteConfig.brand.name}
          width={560}
          height={560}
          priority
          className="h-auto w-[44vh] max-w-[68vw] select-none drop-shadow-[0_8px_24px_rgba(0,0,0,0.6)] sm:w-[52vh] sm:max-w-[72vw]"
          draggable={false}
        />

        <div
          aria-label="Standort"
          className="rounded-full border border-white/20 bg-white/12 px-4 py-2 text-base font-semibold text-white/90 shadow backdrop-blur md:text-lg"
          style={{ marginTop: "-0.25rem" }}
        >
          <span className="mr-1.5" aria-hidden>
            📍
          </span>
          13507 Berlin Tegel
        </div>

        <button
          onClick={handleEnter}
          disabled={!ready}
          className="mt-1 rounded-full bg-gradient-to-r from-orange-500 to-yellow-500 px-10 py-4 text-lg font-semibold text-black shadow-lg transition-all hover:scale-105 hover:shadow-amber-400/70 disabled:cursor-not-allowed disabled:opacity-60 md:text-xl"
        >
          {siteConfig?.ui?.entryButtonLabel ?? "Jetzt bestellen"}
        </button>
      </div>

      {couponOpen && landingCoupon && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-lg overflow-hidden rounded-3xl border border-amber-400/40 bg-stone-950 shadow-2xl shadow-amber-900/40">
            <button
              type="button"
              onClick={closeCoupon}
              className="absolute right-3 top-3 z-20 rounded-full border border-white/20 bg-black/55 px-3 py-1 text-sm font-semibold text-white shadow backdrop-blur transition hover:bg-white/15"
              aria-label="Schließen"
            >
              ✕
            </button>

            <div className="bg-gradient-to-br from-amber-500/25 via-orange-500/15 to-stone-950 px-5 pb-5 pt-7 text-center">
              <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-amber-400 text-4xl text-black shadow-lg shadow-amber-500/30">
                🎁
              </div>

              <div className="mt-4 inline-flex rounded-full border border-amber-300/40 bg-black/35 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-amber-100">
                Persönlicher Gutschein
              </div>

              <h2 className="mt-4 text-3xl font-black tracking-tight text-white md:text-4xl">
                Glückwunsch!
              </h2>

              <p className="mt-2 text-sm leading-relaxed text-stone-200 md:text-base">
                Ihr persönlicher Gutschein wartet auf Sie.
              </p>
            </div>

            <div className="space-y-4 p-5 text-center">
              <div className="rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4">
                <div className="text-2xl font-black text-amber-100">
                  {couponTitle(landingCoupon.def)}
                </div>

                <div className="mt-2 text-sm text-stone-200">
                  {couponText(landingCoupon.def)}
                </div>

                <div className="mt-4 grid gap-2 text-sm text-stone-200 sm:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="text-xs uppercase tracking-wide text-stone-400">
                      Code
                    </div>
                    <div className="mt-1 font-black tracking-widest text-amber-100">
                      {landingCoupon.code}
                    </div>
                  </div>

                  <div className="rounded-xl border border-white/10 bg-black/25 p-3">
                    <div className="text-xs uppercase tracking-wide text-stone-400">
                      Gültig bis
                    </div>
                    <div className="mt-1 font-black text-amber-100">
                      {formatCouponDate(landingCoupon.validUntil)}
                    </div>
                  </div>

                  {typeof landingCoupon.def.minCartTotal === "number" && (
                    <div className="rounded-xl border border-white/10 bg-black/25 p-3 sm:col-span-2">
                      <div className="text-xs uppercase tracking-wide text-stone-400">
                        Mindestbestellwert
                      </div>
                      <div className="mt-1 font-black text-amber-100">
                        {formatMoney(landingCoupon.def.minCartTotal)}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  onClick={handleCouponCta}
                  className="rounded-full bg-gradient-to-r from-orange-500 to-yellow-400 px-6 py-3 text-sm font-black text-black shadow-lg transition hover:scale-[1.02] hover:shadow-amber-400/50"
                >
                  Jetzt bestellen
                </button>

                <button
                  type="button"
                  onClick={closeCoupon}
                  className="rounded-full border border-white/15 bg-white/10 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
                >
                  Später
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {promoOpen && promo && !couponOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="relative max-h-[92svh] w-full max-w-lg overflow-hidden rounded-3xl border border-amber-400/30 bg-stone-950 shadow-2xl shadow-amber-900/30">
            <button
              type="button"
              onClick={closePromo}
              className="absolute right-3 top-3 z-20 rounded-full border border-white/20 bg-black/55 px-3 py-1 text-sm font-semibold text-white shadow backdrop-blur transition hover:bg-white/15"
              aria-label="Schließen"
            >
              ✕
            </button>

            {promo.imageUrl && (
              <div className="relative bg-black">
                {/* Dinamik kampanya görselleri için normal img kullanıyoruz.
                    Böylece /campaigns/... veya dış URL fark etmeden çalışır. */}
                <img
                  src={promo.imageUrl}
                  alt={promo.title || "Burger Brothers Aktion"}
                  className="max-h-[58svh] w-full object-contain"
                />

                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-stone-950 to-transparent" />
              </div>
            )}

            {(promo.title || promo.text || promoDateRange || promo.ctaLabel) && (
              <div className="space-y-3 p-5 text-center">
                {promoDateRange && (
                  <div className="mx-auto inline-flex rounded-full border border-amber-400/35 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-200">
                    {promoDateRange}
                  </div>
                )}

                {promo.title && (
                  <h2 className="text-2xl font-black tracking-tight text-white md:text-3xl">
                    {promo.title}
                  </h2>
                )}

                {promo.text && (
                  <p className="whitespace-pre-line text-sm leading-relaxed text-stone-200 md:text-base">
                    {promo.text}
                  </p>
                )}

                <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-center">
                  {promo.ctaLabel && promo.ctaHref && (
                    <button
                      type="button"
                      onClick={handlePromoCta}
                      className="rounded-full bg-gradient-to-r from-orange-500 to-yellow-400 px-5 py-3 text-sm font-bold text-black shadow-lg transition hover:scale-[1.02] hover:shadow-amber-400/50"
                    >
                      {promo.ctaLabel}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={closePromo}
                    className="rounded-full border border-white/15 bg-white/10 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/15"
                  >
                    Weiter
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}