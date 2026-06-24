"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  src: string;
  poster?: string;
  lighten?: number; // 0..1 overlay lightness azaltma/çoğaltma
  shiftY?: string; // örn: "-8%"  videoyu yukarı kaydır
};

export default function VideoBG({ src, poster, lighten = 0.35, shiftY = "-8%" }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [ready, setReady] = useState(false);

  const isIOS =
    typeof window !== "undefined" &&
    /iPhone|iPad|iPod/i.test(window.navigator.userAgent || "");
  const isStandalone =
    typeof window !== "undefined" &&
    // iOS PWA (Safari)
    (window.navigator as any).standalone === true;

  useEffect(() => {
    let cancelled = false;

    const tryPlay = async () => {
      const v = videoRef.current;
      if (!v) return;

      try {
        // Bazı iOS sürümlerinde preload="auto" + muted + playsInline gerekli
        v.muted = true;
        v.playsInline = true; // iOS
        (v as any).webkitPlaysinline = true; // eski iOS

        // Yüklendikten sonra dene
        const start = v.play();
        if (start && typeof start.then === "function") {
          await start;
        }
        if (!cancelled) {
          setNeedsTap(false);
          setReady(true);
        }
      } catch {
        // iOS PWA’da sık görülen durum: user gesture olmadan reddedildi
        if (!cancelled) {
          setNeedsTap(true);
          setReady(true);
        }
      }
    };

    // iOS PWA’da bazen visibility değişince play izni geliyor
    const onVisibility = () => {
      if (document.visibilityState === "visible" && needsTap === false) {
        tryPlay();
      }
    };

    // video yeterince yüklendiyse dene
    const onCanPlay = () => {
      if (!ready) tryPlay();
    };

    const v = videoRef.current;
    v?.addEventListener("canplay", onCanPlay);
    document.addEventListener("visibilitychange", onVisibility);

    // İlk deneme
    tryPlay();

    return () => {
      cancelled = true;
      v?.removeEventListener("canplay", onCanPlay);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTapToStart = async () => {
    try {
      const v = videoRef.current;
      if (!v) return;
      v.muted = true;
      v.playsInline = true;
      (v as any).webkitPlaysinline = true;
      await v.play();
      setNeedsTap(false);
    } catch {
      // yine de başarısızsa butonu bırak
    }
  };

  return (
    <>
      {/* Tam ekran video */}
      <video
        ref={videoRef}
        aria-hidden
        muted
        autoPlay
        loop
        playsInline
        preload="auto"
        poster={poster}
        src={src}
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "center top",
          transform: `translateY(${shiftY})`,
          zIndex: 0,
          pointerEvents: "none",
          // iOS PWA bazen GPU katmanında sorun çıkarıyor; bu küçük hint:
          willChange: "transform",
        }}
      />

      {/* Daha az karanlık overlay (lighten↓ karartmayı azaltır) */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 1,
          pointerEvents: "none",
          background: `linear-gradient(to bottom,
            rgba(0,0,0,${0.45 - lighten * 0.30}),
            rgba(0,0,0,${0.30 - lighten * 0.20}) 30%,
            rgba(0,0,0,${0.45 - lighten * 0.30}))`,
        }}
      />

      {/* iOS/PWA: Autoplay reddedilirse “Başlat” butonu */}
      {needsTap && (
        <div
          className="fixed inset-0 z-[2] flex items-center justify-center"
          style={{
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,.35), rgba(0,0,0,.65))",
          }}
        >
          <button
            onClick={handleTapToStart}
            className="rounded-full bg-white px-6 py-3 text-black font-semibold shadow-lg active:scale-95"
          >
            Arka planı başlat
          </button>
        </div>
      )}
    </>
  );
}
