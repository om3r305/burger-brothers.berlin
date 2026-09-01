"use client";

import { useEffect, useRef, useState } from "react";

type NormalizedImageLayout = {
  left: number;
  top: number;
  scale: number;
};

type Props = {
  src: string;
  alt: string;
  onError: () => void;
  profile?: "menu" | "schnell";
  eager?: boolean;
  fetchPriority?: "high" | "low" | "auto";
};

const DEFAULT_LAYOUT: NormalizedImageLayout = {
  left: 0,
  top: 0,
  scale: 1,
};

const IMAGE_LAYOUT_CACHE_KEY = "bb_product_image_layout_v4";
const imageLayoutCache = new Map<string, NormalizedImageLayout>();
let imageLayoutCacheHydrated = false;

function hydrateImageLayoutCache() {
  if (imageLayoutCacheHydrated || typeof window === "undefined") return;
  imageLayoutCacheHydrated = true;

  try {
    const parsed = JSON.parse(
      sessionStorage.getItem(IMAGE_LAYOUT_CACHE_KEY) || "{}",
    ) as Record<string, NormalizedImageLayout>;

    for (const [key, value] of Object.entries(parsed)) {
      if (
        Number.isFinite(value?.left) &&
        Number.isFinite(value?.top) &&
        Number.isFinite(value?.scale)
      ) {
        imageLayoutCache.set(key, value);
      }
    }
  } catch {
    // Bellek içi önbellek bu oturum için yeterlidir.
  }
}

function cacheKey(src: string, profile: Props["profile"]) {
  return `${profile || "menu"}:${src}`;
}

function cachedImageLayout(src: string, profile: Props["profile"]) {
  hydrateImageLayoutCache();
  return imageLayoutCache.get(cacheKey(src, profile));
}

function cacheImageLayout(
  src: string,
  profile: Props["profile"],
  value: NormalizedImageLayout,
) {
  imageLayoutCache.set(cacheKey(src, profile), value);
  if (typeof window === "undefined") return;

  try {
    const compact = Object.fromEntries(
      Array.from(imageLayoutCache.entries()).slice(-100),
    );
    sessionStorage.setItem(IMAGE_LAYOUT_CACHE_KEY, JSON.stringify(compact));
  } catch {
    // sessionStorage kapalıysa bellek içi önbellek kullanılmaya devam eder.
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Şeffaf ürün görsellerindeki gerçek görünür alanı düşük çözünürlüklü bir
 * canvas üzerinde ölçer. İlk paint'te varsayılan geometriyi göstermeyiz;
 * analiz bittikten sonra son geometri tek seferde görünür olur. Böylece
 * burger görseli yüklenip sonradan zıplamaz.
 */
export default function NormalizedProductImage({
  src,
  alt,
  onError,
  profile = "menu",
  eager = false,
  fetchPriority = "auto",
}: Props) {
  const initialCached = cachedImageLayout(src, profile);
  const [layout, setLayout] = useState<NormalizedImageLayout>(
    () => initialCached || DEFAULT_LAYOUT,
  );
  const [ready, setReady] = useState(() => Boolean(initialCached));
  const scheduledAnalysisRef = useRef<number | null>(null);

  useEffect(() => {
    const cached = cachedImageLayout(src, profile);
    setLayout(cached || DEFAULT_LAYOUT);
    setReady(Boolean(cached));

    return () => {
      if (scheduledAnalysisRef.current !== null) {
        window.clearTimeout(scheduledAnalysisRef.current);
        scheduledAnalysisRef.current = null;
      }
    };
  }, [profile, src]);

  const commitLayout = (nextLayout: NormalizedImageLayout) => {
    cacheImageLayout(src, profile, nextLayout);
    setLayout(nextLayout);
    setReady(true);
  };

  const analyzeImage = (element: HTMLImageElement) => {
    try {
      const cached = cachedImageLayout(src, profile);
      if (cached) {
        setLayout(cached);
        setReady(true);
        return;
      }

      const naturalWidth = element.naturalWidth;
      const naturalHeight = element.naturalHeight;
      if (!naturalWidth || !naturalHeight) {
        commitLayout(DEFAULT_LAYOUT);
        return;
      }

      const sampleWidth = Math.min(240, naturalWidth);
      const sampleHeight = Math.max(
        1,
        Math.round((sampleWidth / naturalWidth) * naturalHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = sampleWidth;
      canvas.height = sampleHeight;

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        commitLayout(DEFAULT_LAYOUT);
        return;
      }

      context.clearRect(0, 0, sampleWidth, sampleHeight);
      context.drawImage(element, 0, 0, sampleWidth, sampleHeight);

      const pixels = context.getImageData(
        0,
        0,
        sampleWidth,
        sampleHeight,
      ).data;
      const columnHits = new Uint16Array(sampleWidth);
      const rowHits = new Uint16Array(sampleHeight);
      let opaquePixelCount = 0;

      for (let y = 0; y < sampleHeight; y += 1) {
        for (let x = 0; x < sampleWidth; x += 1) {
          const alpha = pixels[(y * sampleWidth + x) * 4 + 3];
          if (alpha < 24) continue;
          columnHits[x] += 1;
          rowHits[y] += 1;
          opaquePixelCount += 1;
        }
      }

      // Şeffaf olmayan görseller mevcut tam-kart geometrisinde kalır.
      if (opaquePixelCount > sampleWidth * sampleHeight * 0.96) {
        commitLayout(DEFAULT_LAYOUT);
        return;
      }

      const minColumnHits = Math.max(2, Math.floor(sampleHeight * 0.004));
      const minRowHits = Math.max(2, Math.floor(sampleWidth * 0.004));

      let minX = 0;
      while (minX < sampleWidth && columnHits[minX] < minColumnHits) minX += 1;

      let maxX = sampleWidth - 1;
      while (maxX >= 0 && columnHits[maxX] < minColumnHits) maxX -= 1;

      let minY = 0;
      while (minY < sampleHeight && rowHits[minY] < minRowHits) minY += 1;

      let maxY = sampleHeight - 1;
      while (maxY >= 0 && rowHits[maxY] < minRowHits) maxY -= 1;

      if (minX >= maxX || minY >= maxY) {
        commitLayout(DEFAULT_LAYOUT);
        return;
      }

      const x0 = minX / sampleWidth;
      const x1 = (maxX + 1) / sampleWidth;
      const y0 = minY / sampleHeight;
      const y1 = (maxY + 1) / sampleHeight;
      const visibleWidth = x1 - x0;
      const visibleHeight = y1 - y0;
      if (visibleWidth <= 0 || visibleHeight <= 0) {
        commitLayout(DEFAULT_LAYOUT);
        return;
      }

      const targetWidth = profile === "schnell" ? 0.86 : 0.84;
      const targetHeight = profile === "schnell" ? 0.84 : 0.82;
      const targetBottom = profile === "schnell" ? 0.92 : 0.91;
      const scale = clamp(
        Math.min(targetWidth / visibleWidth, targetHeight / visibleHeight),
        0.76,
        2.5,
      );
      const left = (1 - visibleWidth * scale) / 2 - x0 * scale;
      const top = targetBottom - y1 * scale;

      commitLayout({ left, top, scale });
    } catch {
      // CORS veya canvas kısıtı varsa güvenli tam-kart görünümü tek seferde açılır.
      commitLayout(DEFAULT_LAYOUT);
    }
  };

  const scheduleAnalysis = (element: HTMLImageElement) => {
    const cached = cachedImageLayout(src, profile);
    if (cached) {
      setLayout(cached);
      setReady(true);
      return;
    }

    if (scheduledAnalysisRef.current !== null) {
      window.clearTimeout(scheduledAnalysisRef.current);
    }

    // Görsel opacity:0 iken analiz edilir; son geometri hazır olduğunda açılır.
    scheduledAnalysisRef.current = window.setTimeout(() => {
      scheduledAnalysisRef.current = null;
      analyzeImage(element);
    }, 0);
  };

  return (
    <div
      className="absolute"
      style={{
        left: `${layout.left * 100}%`,
        top: `${layout.top * 100}%`,
        width: `${layout.scale * 100}%`,
        height: `${layout.scale * 100}%`,
        opacity: ready ? 1 : 0,
        transition: "opacity 120ms ease-out",
        willChange: ready ? "auto" : "opacity",
      }}
    >
      <img
        src={src}
        alt={alt}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={fetchPriority}
        className="h-full w-full select-none object-fill"
        onLoad={(event) => scheduleAnalysis(event.currentTarget)}
        onError={onError}
      />
    </div>
  );
}
