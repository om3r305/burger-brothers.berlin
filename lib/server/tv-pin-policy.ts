/**
 * TV PIN fallback policy.
 *
 * Güvenlik kuralı:
 * - Development runtime'da yerel fallback kullanılabilir.
 * - Production build localhost/127.0.0.1 üzerinde çalıştırılıyorsa da yerel
 *   TV-PC kilitlenmesin diye fallback kullanılabilir.
 * - Vercel ortamında veya gerçek domain üzerinde production fallback kapalıdır.
 */

function normalizedHostname(req: Request) {
  try {
    return new URL(req.url).hostname.trim().toLowerCase().replace(/\.$/, "");
  } catch {
    return "";
  }
}

export function isLoopbackTvHost(hostname: string) {
  const host = String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "");

  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1"
  );
}

export function mayUseLocalTvPinFallback(
  req: Request,
  nodeEnv = process.env.NODE_ENV,
) {
  if (nodeEnv !== "production") return true;

  // Vercel production/preview üzerinde Host başlığı değiştirilse bile
  // development fallback asla açılmaz.
  if (process.env.VERCEL || process.env.VERCEL_ENV) return false;

  return isLoopbackTvHost(normalizedHostname(req));
}
