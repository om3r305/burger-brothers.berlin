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
 * canvas üzerinde ölçer. Kaynak dosyaya dokunmaz; yalnızca kart içindeki
 * sunum ölçeğini ve hizasını düzenler.
 */
export default function NormalizedProductImage({
  src,
  alt,
  onError,
  profile = "menu",
  eager = false,
  fetchPriority = "auto",
}: Props) {
  const [layout, setLayout] = useState<NormalizedImageLayout>(
    () => cachedImageLayout(src, profile) || DEFAULT_LAYOUT,
  );
  const scheduledAnalysisRef = useRef<{
    id: number;
    mode: "idle" | "timeout";
  } | null>(null);

  useEffect(() => {
    setLayout(cachedImageLayout(src, profile) || DEFAULT_LAYOUT);

    return () => {
      const scheduled = scheduledAnalysisRef.current;
      if (!scheduled) return;

      if (scheduled.mode === "idle") {
        const idleWindow = window as Window & {
          cancelIdleCallback?: (id: number) => void;
        };
        idleWindow.cancelIdleCallback?.(scheduled.id);
      } else {
        window.clearTimeout(scheduled.id);
      }

      scheduledAnalysisRef.current = null;
    };
  }, [profile, src]);

  const analyzeImage = (element: HTMLImageElement) => {
    try {
      const cached = cachedImageLayout(src, profile);
      if (cached) {
        setLayout(cached);
        return;
      }

      const naturalWidth = element.naturalWidth;
      const naturalHeight = element.naturalHeight;
      if (!naturalWidth || !naturalHeight) return;

      const sampleWidth = Math.min(240, naturalWidth);
      const sampleHeight = Math.max(
        1,
        Math.round((sampleWidth / naturalWidth) * naturalHeight),
      );
      const canvas = document.createElement("canvas");
      canvas.width = sampleWidth;
      canvas.height = sampleHeight;

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return;

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

      // Şeffaf olmayan görsellerin mevcut object-contain davranışını koru.
      if (opaquePixelCount > sampleWidth * sampleHeight * 0.96) return;

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

      if (minX >= maxX || minY >= maxY) return;

      const x0 = minX / sampleWidth;
      const x1 = (maxX + 1) / sampleWidth;
      const y0 = minY / sampleHeight;
      const y1 = (maxY + 1) / sampleHeight;
      const visibleWidth = x1 - x0;
      const visibleHeight = y1 - y0;
      if (visibleWidth <= 0 || visibleHeight <= 0) return;

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
      const nextLayout = { left, top, scale };

      setLayout(nextLayout);
      cacheImageLayout(src, profile, nextLayout);
    } catch {
      // CORS veya canvas kısıtı varsa güvenli object-contain görünümü kalır.
      setLayout(DEFAULT_LAYOUT);
    }
  };

  const scheduleAnalysis = (element: HTMLImageElement) => {
    if (cachedImageLayout(src, profile)) return;

    const run = () => {
      scheduledAnalysisRef.current = null;
      analyzeImage(element);
    };
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number;
    };

    if (idleWindow.requestIdleCallback) {
      scheduledAnalysisRef.current = {
        id: idleWindow.requestIdleCallback(run, { timeout: 650 }),
        mode: "idle",
      };
    } else {
      scheduledAnalysisRef.current = {
        id: window.setTimeout(run, 32),
        mode: "timeout",
      };
    }
  };

  return (
    <div
      className="absolute"
      style={{
        left: `${layout.left * 100}%`,
        top: `${layout.top * 100}%`,
        width: `${layout.scale * 100}%`,
        height: `${layout.scale * 100}%`,
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
