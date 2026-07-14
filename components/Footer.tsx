// components/Footer.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { siteConfig } from "@/config/site.config";

/** Admin ayarlarını okuyabileceğimiz tüm anahtarlar */
const LS_KEYS = ["bb_site_config_override", "bb_settings_v1", "bb_settings_v6"] as const;

const DEFAULT_INSTAGRAM =
  "https://www.instagram.com/burgerbrotherstegel?igsh=anNzZm10OHBjeWZi";
const DEFAULT_TIKTOK = "https://www.tiktok.com/@burger.brothers.t";
const DEFAULT_GOOGLE_REVIEWS = "https://g.page/r/CcInXgYas-3xEBE/review";

type Contact = {
  phone?: string;
  address?: string;
  email?: string;
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  googleMaps?: string;
  googleReviews?: string;
  whatsappNumber?: string;         // sadece rakamlar (ülke kodu ile)
  whatsappDefaultMessage?: string; // opsiyonel
};

/** Boş/undefined alanları atıp, dolu alanlarla base’i override eder */
function mergeContact(base: Contact, override?: Contact): Contact {
  const out: Contact = { ...base };

  if (override && typeof override === "object") {
    (Object.keys(override) as (keyof Contact)[]).forEach((k) => {
      const v = override[k];

      if (typeof v === "string" && v.trim() === "") return; // boş string ile ezme
      if (v !== undefined) out[k] = v as any;
    });
  }

  return out;
}

function normalizeSocialUrl(value: any) {
  const url = String(value || "").trim();

  if (!url) return "";
  if (/^(https?:|mailto:|tel:|sms:|whatsapp:)/i.test(url)) return url;

  if (url.startsWith("//")) return `https:${url}`;

  return `https://${url.replace(/^\/+/, "")}`;
}

function isCorrectInstagram(value: any) {
  const url = normalizeSocialUrl(value).toLowerCase();

  return (
    url.includes("instagram.com/burgerbrotherstegel") ||
    url.includes("instagram.com/@burgerbrotherstegel")
  );
}

function isCorrectTikTok(value: any) {
  const url = normalizeSocialUrl(value).toLowerCase();

  return (
    url.includes("tiktok.com/@burger.brothers.t") ||
    url.includes("tiktok.com/burger.brothers.t")
  );
}

function isCorrectGoogleReviews(value: any) {
  const url = normalizeSocialUrl(value).toLowerCase();

  return url.includes("g.page/r/ccinxgyas-3xebe/review");
}

function withDefaultSocialLinks(contact: Contact): Contact {
  return {
    ...contact,
    /*
      Admin/localStorage içinde eski veya yanlış link kalmışsa onu ezip
      doğru resmi sosyal hesaplara yollarız.
    */
    instagram: isCorrectInstagram(contact.instagram)
      ? normalizeSocialUrl(contact.instagram)
      : DEFAULT_INSTAGRAM,
    tiktok: isCorrectTikTok(contact.tiktok)
      ? normalizeSocialUrl(contact.tiktok)
      : DEFAULT_TIKTOK,
    googleReviews: isCorrectGoogleReviews(contact.googleReviews)
      ? normalizeSocialUrl(contact.googleReviews)
      : DEFAULT_GOOGLE_REVIEWS,
  };
}

/** LS -> contact okuma (öncelik sıralı) + siteConfig fallback */
function readContactFromLocalStorage(): Contact {
  const fallback = withDefaultSocialLinks((siteConfig as any)?.contact || {});

  try {
    for (const key of LS_KEYS) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const parsed = JSON.parse(raw);
      const c: any = parsed?.contact ?? {};
      const picked: Contact = {
        phone: typeof c.phone === "string" ? c.phone : undefined,
        address: typeof c.address === "string" ? c.address : undefined,
        email: typeof c.email === "string" ? c.email : undefined,
        instagram: typeof c.instagram === "string" ? c.instagram : undefined,
        tiktok: typeof c.tiktok === "string" ? c.tiktok : undefined,
        facebook: typeof c.facebook === "string" ? c.facebook : undefined,
        googleMaps: typeof c.googleMaps === "string" ? c.googleMaps : undefined,
        googleReviews: typeof c.googleReviews === "string" ? c.googleReviews : undefined,
        whatsappNumber: typeof c.whatsappNumber === "string" ? c.whatsappNumber : undefined,
        whatsappDefaultMessage:
          typeof c.whatsappDefaultMessage === "string" ? c.whatsappDefaultMessage : undefined,
      };

      return withDefaultSocialLinks(mergeContact(fallback, picked));
    }

    return fallback;
  } catch {
    return fallback;
  }
}

export default function Footer() {
  const pathname = usePathname();
  const isLanding = pathname === "/";
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // SSR-safe: siteConfig ile başlat, mount’ta LS ile güncelle
  const [contact, setContact] = useState<Contact>(() =>
    withDefaultSocialLinks((siteConfig as any)?.contact || {}),
  );

  // LS’ten yükle + diğer sekmelerde değişirse güncelle
  useEffect(() => {
    setContact(readContactFromLocalStorage());

    const onStorage = (e: StorageEvent) => {
      if (e.key && LS_KEYS.includes(e.key as any)) {
        setContact(readContactFromLocalStorage());
      }
    };

    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Flash buton tık sesi
  useEffect(() => {
    audioRef.current = new Audio(
      "https://cdn.pixabay.com/download/audio/2021/09/14/audio_9b8f3e2b3e.mp3?filename=menu-click-110624.mp3",
    );

    const onClick = (ev: MouseEvent) => {
      const target = ev.target as HTMLElement | null;
      const a = target?.closest("a.flash-btn") as HTMLAnchorElement | null;

      if (!a || !audioRef.current) return;

      try {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      } catch {}
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // WhatsApp link (numara + opsiyonel mesaj)
  const waNumberRaw =
    contact.whatsappNumber || (siteConfig as any)?.contact?.whatsappNumber || "";
  const waNumber = String(waNumberRaw).replace(/\D/g, "");
  const waMsg =
    contact.whatsappDefaultMessage ||
    (siteConfig as any)?.contact?.whatsappDefaultMessage ||
    "";
  const waHref = waNumber
    ? `https://wa.me/${waNumber}${waMsg ? `?text=${encodeURIComponent(waMsg)}` : ""}`
    : null;

  const brandName = (siteConfig as any)?.brand?.name ?? "Burger Brothers Berlin";

  const socialButtonClass = (
    kind: "instagram" | "tiktok" | "google" | "maps" | "default",
  ) => {
    const base =
      "flash-btn inline-flex items-center justify-center rounded-full px-4 py-2.5 text-sm font-semibold " +
      "shadow-lg backdrop-blur-md transition hover:-translate-y-0.5 hover:scale-[1.02] active:scale-95";

    if (kind === "instagram") {
      return `${base} border border-pink-300/35 bg-gradient-to-r from-fuchsia-600/90 via-pink-500/90 to-orange-400/90 text-white shadow-pink-900/30`;
    }

    if (kind === "tiktok") {
      return `${base} border border-cyan-300/35 bg-gradient-to-r from-cyan-500/90 via-stone-950/95 to-rose-500/90 text-white shadow-cyan-900/25`;
    }

    if (kind === "google") {
      return `${base} border border-amber-300/25 bg-stone-950/75 text-stone-100 shadow-black/35 hover:bg-stone-900/85`;
    }

    if (kind === "maps") {
      return `${base} border border-emerald-300/25 bg-stone-950/75 text-stone-100 shadow-black/35 hover:bg-stone-900/85`;
    }

    return `${base} border border-white/15 bg-stone-950/75 text-stone-100 shadow-black/35 hover:bg-stone-900/85`;
  };

  return (
    <footer
      className={`bb-site-footer ${
        isLanding
          ? "relative z-20 -mt-36 border-t-0 bg-transparent pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-0 sm:-mt-32 md:-mt-28"
          : "border-t border-stone-800/60 bg-black py-4 sm:py-6"
      }`}
    >
      <div
        className={
          isLanding
            ? "mx-auto grid max-w-6xl gap-3 px-4 sm:gap-4 md:grid-cols-[1fr_1.35fr_auto] md:items-center"
            : "mx-auto grid max-w-6xl gap-4 px-4 sm:gap-5 md:grid-cols-[1fr_1.35fr_auto] md:items-center"
        }
      >
        {/* Kontakt */}
        <div
          className={
            isLanding
              ? "order-2 rounded-2xl border border-white/10 bg-black/45 p-3 text-center text-xs shadow-lg shadow-black/30 backdrop-blur-md md:order-none md:text-left lg:block"
              : "hidden md:block"
          }
        >
          <div className={isLanding ? "text-xs font-bold uppercase tracking-wide text-stone-200/90" : "text-sm font-medium text-stone-200"}>Kontakt</div>

          {contact.phone && (
            <div className={isLanding ? "mt-1 text-xs text-stone-300" : "mt-1 text-sm text-stone-400"}>
              Tel:{" "}
              <a
                href={`tel:${contact.phone.replace(/\s/g, "")}`}
                className="underline-offset-2 hover:underline"
                aria-label="Telefonnummer anrufen"
              >
                {contact.phone}
              </a>
            </div>
          )}

          {contact.address && (
            <div className={isLanding ? "text-xs text-stone-300" : "text-sm text-stone-400"}>
              Adresse:{" "}
              {contact.googleMaps ? (
                <a
                  href={contact.googleMaps}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 hover:underline"
                  aria-label="Adresse auf Google Maps öffnen"
                >
                  {contact.address}
                </a>
              ) : (
                contact.address
              )}
            </div>
          )}

          {contact.email && (
            <div className={isLanding ? "text-xs text-stone-300" : "text-sm text-stone-400"}>
              E-Mail:{" "}
              <a
                href={`mailto:${contact.email}`}
                className="underline-offset-2 hover:underline"
                aria-label="E-Mail senden"
              >
                {contact.email}
              </a>
            </div>
          )}
        </div>

        {/* Links / Social / Reviews */}
        <div
          className={
            isLanding
              ? "order-1 flex flex-wrap items-center justify-center gap-2 sm:gap-3 md:order-none md:justify-start"
              : "flex flex-wrap items-center gap-2 sm:gap-3"
          }
        >
          {contact.instagram && (
            <a
              className={socialButtonClass("instagram")}
              href={contact.instagram}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram öffnen"
            >
              <span className="mr-1.5" aria-hidden>
                📸
              </span>
              Instagram
            </a>
          )}

          {contact.tiktok && (
            <a
              className={socialButtonClass("tiktok")}
              href={contact.tiktok}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="TikTok öffnen"
            >
              <span className="mr-1.5" aria-hidden>
                ♪
              </span>
              TikTok
            </a>
          )}

          {contact.facebook && (
            <a
              className={socialButtonClass("default")}
              href={contact.facebook}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Facebook öffnen"
            >
              Facebook
            </a>
          )}

          {contact.googleReviews && (
            <a
              className={socialButtonClass("google")}
              href={contact.googleReviews}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Google-Bewertungen ansehen"
            >
              <span className="mr-1.5" aria-hidden>
                ⭐
              </span>
              Google Bewertungen
            </a>
          )}

          {contact.googleMaps && (
            <a
              className={socialButtonClass("maps")}
              href={contact.googleMaps}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Google Maps öffnen"
            >
              <span className="mr-1.5" aria-hidden>
                📍
              </span>
              Google Maps
            </a>
          )}

          {waHref && (
            <a
              className={socialButtonClass("default")}
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp-Chat starten"
            >
              WhatsApp
            </a>
          )}
        </div>

        {/* Copyright */}
        <div
          className={
            isLanding
              ? "order-3 text-center text-xs text-stone-500 md:order-none md:text-right md:text-sm"
              : "text-sm text-stone-500 md:text-right"
          }
        >
          © {new Date().getFullYear()} {brandName}
        </div>
      </div>
    </footer>
  );
}
