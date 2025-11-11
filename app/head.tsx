// app/head.tsx
import { siteConfig } from "@/config/site.config";

export default function Head() {
  // Güvenli fallback: undefined olabilir — sadece string olanları preload ediyoruz
  const click = typeof siteConfig?.audio?.click === "string" ? siteConfig.audio.click : undefined;
  const fire  = typeof siteConfig?.audio?.fireLoop === "string" ? siteConfig.audio.fireLoop : undefined;
  const grill = typeof siteConfig?.audio?.grillLoop === "string" ? siteConfig.audio.grillLoop : undefined;

  return (
    <>
      {/* Arka plan videosu için preload (Safari seviyor) */}
      <link rel="preload" as="video" href="/flames/flame-loop.mp4" type="video/mp4" />
      {/* Sesler için preload (opsiyonel) */}
      {click && <link rel="preload" as="audio" href={click} />}
      {fire  && <link rel="preload" as="audio" href={fire} />}
      {grill && <link rel="preload" as="audio" href={grill} />}

      {/* iOS PWA davranışlarını iyileştiren küçük dokunuşlar */}
      <meta name="apple-mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
      <meta name="format-detection" content="telephone=no" />
    </>
  );
}
