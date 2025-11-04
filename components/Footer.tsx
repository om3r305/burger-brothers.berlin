// components/Footer.tsx
"use client";

import { t } from "@/lib/i18n";
import { useEffect, useRef, useState } from "react";
import { siteConfig } from "@/config/site.config";

/** Admin ayarlarını okuyabileceğimiz tüm anahtarlar */
const LS_KEYS = ["bb_site_config_override", "bb_settings_v1"] as const;

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

/** LS -> contact okuma (öncelik sıralı) + siteConfig fallback */
function readContactFromLocalStorage(): Contact {
  const fallback = (siteConfig as any)?.contact || {};
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
      return mergeContact(fallback, picked);
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export default function Footer() {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // SSR-safe: siteConfig ile başlat, mount’ta LS ile güncelle
  const [contact, setContact] = useState<Contact>(() => (siteConfig as any)?.contact || {});

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
      "https://cdn.pixabay.com/download/audio/2021/09/14/audio_9b8f3e2b3e.mp3?filename=menu-click-110624.mp3"
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

  return (
    <footer className="mt-10 border-t border-stone-700/50 py-10">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 md:grid-cols-3">
        {/* Kontakt */}
        <div>
          <div className="text-sm font-medium text-stone-200">Kontakt</div>

          {contact.phone && (
            <div className="mt-1 text-sm text-stone-400">
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
            <div className="text-sm text-stone-400">
              Adressese:{" "}
              {contact.googleMaps ? (
                <a
                  href={contact.googleMaps}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline-offset-2 hover:underline"
                  aria-label="Adressese auf Google Maps öffnen"
                >
                  {contact.address}
                </a>
              ) : (
                contact.address
              )}
            </div>
          )}

          {contact.email && (
            <div className="text-sm text-stone-400">
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
        <div className="flex flex-wrap items-center gap-3">
          {contact.instagram && (
            <a
              className="flash-btn rounded-full bg-stone-800 px-4 py-2 text-sm hover:bg-stone-700"
              href={contact.instagram}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram öffnen"
            >
              Instagram
            </a>
          )}
          {contact.tiktok && (
            <a
              className="flash-btn rounded-full bg-stone-800 px-4 py-2 text-sm hover:bg-stone-700"
              href={contact.tiktok}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="TikTok öffnen"
            >
              TikTok
            </a>
          )}
          {contact.facebook && (
            <a
              className="flash-btn rounded-full bg-stone-800 px-4 py-2 text-sm hover:bg-stone-700"
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
              className="flash-btn rounded-full bg-stone-800 px-4 py-2 text-sm hover:bg-stone-700"
              href={contact.googleReviews}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Google-Bewertungen ansehen"
            >
              Google Bewertungen
            </a>
          )}
          {contact.googleMaps && (
            <a
              className="flash-btn rounded-full bg-stone-800 px-4 py-2 text-sm hover:bg-stone-700"
              href={contact.googleMaps}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Google Maps öffnen"
            >
              Google Maps
            </a>
          )}
          {waHref && (
            <a
              className="flash-btn rounded-full bg-stone-800 px-4 py-2 text-sm hover:bg-stone-700"
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
        <div className="text-sm text-stone-400">
          © {new Date().getFullYear()} {brandName}
        </div>
      </div>
    </footer>
  );
}
