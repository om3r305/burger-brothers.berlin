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

export default function HomePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [settingsTick, setSettingsTick] = useState(0);
  const [promoOpen, setPromoOpen] = useState(false);

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

  const handlePromoCta = () => {
    const href = String(promo?.ctaHref || "").trim();

    closePromo();

    if (href) {
      router.push(href);
    }
  };

  const handleEnter = async () => {
    try {
      if (clickRef.current) {
        clickRef.current.currentTime = 0;
        await clickRef.current.play();
      }

      await fireRef.current?.play();
      await grillRef.current?.play();
    } catch {
      // iOS/Safari ses politikası nedeniyle sessiz geçilebilir.
    } finally {
      router.push("/menu");
    }
  };

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-black">
      {/* 🔥 Arka plan videosu — autoplay düşerse “Arka planı başlat” butonu çıkar */}
      <VideoBG
        src="/flames/flame-loop.mp4"
        poster="/flames/poster.jpg"
        lighten={0.35}
        shiftY="-10%"
      />

      {/* Üstten hafif koyulaştırma: logonun okunaklı kalması için */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-black/20 to-transparent" />

      {/* Altta amber glow: canlılık + alttaki siyah bantı öldürür */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-amber-400/18 to-transparent mix-blend-screen" />

      {/* Logo + Lokasyon + CTA */}
      <div
        className="relative z-10 mx-auto flex max-w-screen-md flex-col items-center gap-4 p-6 text-center"
        style={{ transform: "translateY(-6vh)" }}
      >
        <Image
          src={siteConfig.brand.logoPath}
          alt={siteConfig.brand.name}
          width={560}
          height={560}
          priority
          className="h-auto w-[56vh] max-w-[72vw] select-none drop-shadow-[0_8px_24px_rgba(0,0,0,0.6)]"
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

      {promoOpen && promo && (
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