"use client";

/**
 * Gerçekçi alev katmanı (video tabanlı)
 * - public/flames/flame-loop.webm ve flame-loop.mp4 bekler
 * - Alt kenarda gradient maske ile sahneye karışır
 * - Video muted olduğu için autoplay çalışır; sesleri tıklamada başlatıyoruz (app/page.tsx)
 */
export default function ScreenFlamesVideo() {
  return (
    <div aria-hidden className="flame-video-wrap">
      <video
        className="flame-video"
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        poster="/flames/flame-poster.jpg" /* opsiyonel */
      >
        <source src="/flames/flame-loop.webm" type="video/webm" />
        <source src="/flames/flame-loop.mp4" type="video/mp4" />
      </video>

      {/* Üste doğru yumuşak karışım + hafif duman */}
      <div className="flame-mask" />
      <div className="flame-smoke" />
    </div>
  );
}
