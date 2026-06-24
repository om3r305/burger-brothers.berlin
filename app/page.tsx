"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { siteConfig } from "@/config/site.config";
import VideoBG from "@/components/VideoBG";

export default function HomePage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  const clickRef = useRef<HTMLAudioElement | null>(null);
  const fireRef  = useRef<HTMLAudioElement | null>(null);
  const grillRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const vol = siteConfig?.audio?.volume ?? {};
    const vClick = typeof vol.click === "number" ? vol.click : 0.8;
    const vFire  = typeof vol.fire  === "number" ? vol.fire  : 0.45;
    const vGrill = typeof vol.grill === "number" ? vol.grill : 0.45;

    clickRef.current = new Audio(siteConfig.audio.click);
    fireRef.current  = new Audio(siteConfig.audio.fireLoop);
    grillRef.current = new Audio(siteConfig.audio.grillLoop);

    if (clickRef.current) clickRef.current.volume = Math.min(Math.max(vClick, 0), 1);
    if (fireRef.current)  { fireRef.current.loop = true;  fireRef.current.volume = Math.min(Math.max(vFire, 0), 1); }
    if (grillRef.current) { grillRef.current.loop = true; grillRef.current.volume = Math.min(Math.max(vGrill, 0), 1); }

    setReady(true);
    return () => { fireRef.current?.pause(); grillRef.current?.pause(); };
  }, []);

  const handleEnter = async () => {
    try {
      // iOS ses politikası: user gesture anında play
      if (clickRef.current) { clickRef.current.currentTime = 0; await clickRef.current.play(); }
      await fireRef.current?.play();
      await grillRef.current?.play();
    } catch {/* sessiz */}
    finally { router.push("/menu"); }
  };

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-black">
      {/* 🔥 Arka plan videosu — autoplay düşerse “Arka planı başlat” butonu çıkar */}
      <VideoBG
        src="/flames/flame-loop.mp4"
        poster="/flames/poster.jpg"
        lighten={0.35}     // <-- alevler daha canlı (daha az karartma)
        shiftY="-10%"      // yukarı kaydırma (alt çizgiyi gizlemeye yardım eder)
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
          className="rounded-full border border-white/20 bg-white/12 px-4 py-2 text-base md:text-lg font-semibold text-white/90 shadow backdrop-blur"
          style={{ marginTop: "-0.25rem" }}
        >
          <span className="mr-1.5" aria-hidden>📍</span>
          13507 Berlin Tegel
        </div>

        <button
          onClick={handleEnter}
          disabled={!ready}
          className="mt-1 rounded-full bg-gradient-to-r from-orange-500 to-yellow-500 px-10 py-4 text-lg md:text-xl font-semibold text-black shadow-lg transition-all hover:scale-105 hover:shadow-amber-400/70 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {siteConfig?.ui?.entryButtonLabel ?? "Jetzt bestellen"}
        </button>
      </div>
    </main>
  );
}
