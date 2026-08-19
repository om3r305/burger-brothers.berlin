import {
  buildCustomerDeliveryAreaResult,
  normalizeCustomerPostalCode,
} from "@/lib/assistant/delivery-area";
import { enforceRateLimit, securityJson } from "@/lib/server/request-security";
import { getServerSettings } from "@/lib/server/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const rateError = await enforceRateLimit(req, "customer:assistant:delivery-area", 40, 5 * 60_000);
  if (rateError) return rateError;

  const postalCode = normalizeCustomerPostalCode(new URL(req.url).searchParams.get("plz"));
  if (!postalCode) return securityJson({ ok: false, error: "invalid_postal_code" }, 400);

  const result = buildCustomerDeliveryAreaResult(await getServerSettings(), postalCode);
  return securityJson({ ok: true, result });
}
