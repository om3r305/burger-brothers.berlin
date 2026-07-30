const OPTIMIZABLE_LOCAL_PATH =
  /^\/(?:images|badges)\/.+\.png$/i;

const DURSTLOESCHER_LOCAL_PATH =
  /^\/images\/drinks\/[^?#]*durst[^?#]*$/i;

function splitAssetUrl(value: string) {
  const match = String(value || "").match(/^([^?#]+)([?#].*)?$/);
  return {
    pathname: match?.[1] || "",
    suffix: match?.[2] || "",
  };
}

function canonicalKnownLocalAsset(
  value?: string | null,
  format: "preferred" | "fallback" = "preferred",
) {
  const source = String(value || "").trim();
  if (!source) return source;

  const { pathname, suffix } = splitAssetUrl(source);

  // Windows local geliştirme dosya adlarında büyük/küçük harfi tolere eder.
  // Vercel/Linux etmez. DB'de eski Durstlöscher adı veya farklı harf kullanılsa
  // bile canlıda Git'te bulunan kesin küçük harfli dosyaya yönlendir.
  if (DURSTLOESCHER_LOCAL_PATH.test(pathname)) {
    return `${
      format === "preferred"
        ? "/images/drinks/durst.webp"
        : "/images/drinks/durst.png"
    }${suffix}`;
  }

  return source;
}

export function optimizedLocalImageUrl(value?: string | null) {
  const source = canonicalKnownLocalAsset(value, "preferred");
  if (!source) return source;

  const { pathname, suffix } = splitAssetUrl(source);
  const isBrandLogo = pathname === "/logo-burger-brothers.png";
  if (!isBrandLogo && !OPTIMIZABLE_LOCAL_PATH.test(pathname)) return source;

  return `${pathname.replace(/\.png$/i, ".webp")}${suffix}`;
}

export function localImageFallbackUrl(value?: string | null) {
  return canonicalKnownLocalAsset(value, "fallback");
}

export function restoreLocalImageFallback(
  element: HTMLImageElement,
  original?: string | null,
) {
  const fallback = localImageFallbackUrl(original);
  if (!fallback) return;

  const currentPath = (() => {
    try {
      return new URL(element.currentSrc || element.src, window.location.origin)
        .pathname;
    } catch {
      return element.currentSrc || element.src;
    }
  })();
  const fallbackPath = splitAssetUrl(fallback).pathname;
  if (currentPath === fallbackPath) return;

  // Next/Image bir srcset bırakmış olabilir; ham PNG geri dönüşünün gerçekten
  // seçilmesi için önce optimize edilmiş adayları kaldır.
  element.removeAttribute("srcset");
  element.removeAttribute("sizes");
  element.src = fallback;
}
