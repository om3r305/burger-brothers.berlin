/**
 * TV host helpers retained for cookie/local-network behavior.
 * A hard-coded TV PIN fallback is intentionally never allowed.
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
  _req: Request,
  _nodeEnv = process.env.NODE_ENV,
) {
  return false;
}

export function isLoopbackTvRequest(req: Request) {
  return isLoopbackTvHost(normalizedHostname(req));
}
