import { NextResponse } from "next/server";
import { getTenantId } from "@/lib/db";
import { findGeneralPushSubscriptionForRequest } from "@/lib/server/general-push";
import { getServerSettings } from "@/lib/server/settings";
import { evaluateRouteDealForCustomer } from "@/lib/server/route-deal-eligibility";
import {
  enforceRateLimit,
  forbiddenResponse,
  hasTrustedMutationOrigin,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEADERS = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
};

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: HEADERS,
  });
}

function cleanMode(value: unknown): "pickup" | "delivery" {
  const text = String(value ?? "").trim().toLowerCase();
  return ["pickup", "abholung"].includes(text) ? "pickup" : "delivery";
}

function publicDeal(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return {
    id: String(value.id || ""),
    ruleId: value.ruleId ? String(value.ruleId) : null,
    name: value.name ? String(value.name) : "Nachbarschafts-Deal",
    plz: value.plz ? String(value.plz) : null,
    street: value.street ? String(value.street) : null,
    streets: Array.isArray(value.streets)
      ? value.streets.map(String).slice(0, 100)
      : [],
    matchMode: value.matchMode ? String(value.matchMode) : null,
    requireStreet: value.requireStreet === true,
    startedAt: value.startedAt ? String(value.startedAt) : null,
    expiresAt: value.expiresAt ? String(value.expiresAt) : null,
    durationMinutes: Number(value.durationMinutes || 0),
    minTotal: Number(value.minTotal || 0),
    reward:
      value.reward && typeof value.reward === "object" && !Array.isArray(value.reward)
        ? value.reward
        : {},
    message: value.message ? String(value.message) : null,
  };
}

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

  const rate = await enforceRateLimit(
    req,
    "route-deals:eligible",
    120,
    10 * 60_000,
  );
  if (rate) return rate;

  const body = await req.json().catch(() => ({}));
  const mode = cleanMode(body?.mode);
  if (mode !== "delivery") {
    return json({ ok: true, eligible: false, deal: null });
  }

  const tenantId = await getTenantId();
  const [settings, subscription] = await Promise.all([
    getServerSettings(),
    findGeneralPushSubscriptionForRequest(req, tenantId),
  ]);

  const submittedCustomer =
    body?.customer &&
    typeof body.customer === "object" &&
    !Array.isArray(body.customer)
      ? body.customer
      : {};
  const preference = subscription?.preference || {};
  const customer = {
    ...submittedCustomer,
    phone: submittedCustomer.phone || subscription?.phone || undefined,
    email: submittedCustomer.email || subscription?.email || undefined,
    plz:
      submittedCustomer.plz ||
      submittedCustomer.zip ||
      preference.plz ||
      undefined,
    zip:
      submittedCustomer.zip ||
      submittedCustomer.plz ||
      preference.plz ||
      undefined,
    street: submittedCustomer.street || preference.street || undefined,
  };

  const evaluation = await evaluateRouteDealForCustomer({
    tenantId,
    settings,
    mode,
    customer,
    order: body?.order,
    now: new Date(),
  });

  const notice =
    evaluation.reason === "active_order_out_for_delivery"
      ? {
          type: "order_underway",
          title: "Ihre Bestellung ist bereits unterwegs",
          message:
            "Das Nachbarschafts-Angebot kann für diese Bestellung nicht mehr genutzt werden.",
        }
      : evaluation.reason === "source_order_out_for_delivery"
        ? {
            type: "opportunity_ended",
            title: "Das Nachbarschafts-Angebot ist beendet",
            message:
              "Die zugehörige Lieferung hat das Restaurant bereits verlassen. Für neue Bestellungen kann dieser Rabatt nicht mehr genutzt werden.",
          }
        : null;

  return json({
    ok: true,
    eligible: Boolean(evaluation.deal),
    deal: publicDeal(evaluation.deal),
    reason: evaluation.reason,
    notice,
  });
}
