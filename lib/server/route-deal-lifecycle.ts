import { getServerSettings, saveServerSettings } from "@/lib/server/settings";

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function array(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, max = 180) {
  return String(value ?? "").trim().slice(0, max);
}

function number(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function refreshRouteDealOpportunityForOrder(
  orderIdInput: unknown,
  opportunityMinutesInput: unknown,
) {
  const orderId = text(orderIdInput, 160);
  if (!orderId) return null;

  const settings = await getServerSettings();
  const routeDeals = object(settings?.routeDeals);
  const active = array(routeDeals.active);

  const index = active.findIndex(
    (deal) => text(deal?.orderId, 160) === orderId,
  );
  if (index < 0) return null;

  const now = new Date();
  const opportunityMinutes = Math.max(
    1,
    Math.min(
      60,
      Math.round(
        number(
          opportunityMinutesInput,
          number(routeDeals.defaultDurationMinutes, 10),
        ),
      ),
    ),
  );

  const current = object(active[index]);
  const refreshed: Record<string, any> = {
    ...current,
    availableAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + opportunityMinutes * 60_000,
    ).toISOString(),
    durationMinutes: opportunityMinutes,
    lastRefreshedAt: now.toISOString(),
    trigger: {
      ...object(current.trigger),
      source: "out_for_delivery",
      orderId,
    },
  };

  const nextActive = active.slice();
  nextActive[index] = refreshed;

  await saveServerSettings({
    routeDeals: {
      ...routeDeals,
      active: nextActive,
    },
  } as any);

  return refreshed;
}
