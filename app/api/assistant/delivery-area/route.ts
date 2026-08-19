import { buildCustomerDeliveryAreaResult } from "@/lib/assistant/delivery-area";
import { enforceRateLimit, hasTrustedMutationOrigin, securityJson } from "@/lib/server/request-security";
import { getServerSettings } from "@/lib/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return securityJson({ ok: false, error: "origin_not_allowed" }, 403);
  }
  const rateError = await enforceRateLimit(req, "customer:assistant:delivery-area", 30, 5 * 60_000);
  if (rateError) return rateError;

  const body = await req.json().catch(() => null);
  const postalCode = String(body?.postalCode ?? "").replace(/\D/g, "").slice(0, 5);
  if (!/^\d{5}$/.test(postalCode)) {
    return securityJson({ ok: false, error: "invalid_postal_code" }, 400);
  }

  const settings = await getServerSettings();
  return securityJson({ ok: true, ...buildCustomerDeliveryAreaResult(settings, postalCode) });
}
