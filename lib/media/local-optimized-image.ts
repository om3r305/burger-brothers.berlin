const OPTIMIZABLE_LOCAL_PATH =
  /^\/(?:images|badges)\/.+\.png$/i;

function splitAssetUrl(value: string) {
  const match = String(value || "").match(/^([^?#]+)([?#].*)?$/);
  return {
    pathname: match?.[1] || "",
    suffix: match?.[2] || "",
  };
}

export function optimizedLocalImageUrl(value?: string | null) {
  const source = String(value || "").trim();
  if (!source) return source;

  const { pathname, suffix } = splitAssetUrl(source);
  const isBrandLogo = pathname === "/logo-burger-brothers.png";
  if (!isBrandLogo && !OPTIMIZABLE_LOCAL_PATH.test(pathname)) return source;

  return `${pathname.replace(/\.png$/i, ".webp")}${suffix}`;
}

export function restoreLocalImageFallback(
  element: HTMLImageElement,
  original?: string | null,
) {
  const fallback = String(original || "").trim();
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

  element.src = fallback;
}
