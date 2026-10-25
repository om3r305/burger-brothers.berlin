import { prisma, getTenantId } from "@/lib/db";
import { orderAssignedToDriver } from "@/lib/server/driver-order";
import {
  enforceRateLimit,
  getSessionSubject,
  requireMutationRole,
  requireSessionRole,
  securityJson,
} from "@/lib/server/request-security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const denied = await requireSessionRole(req, "driver");
  if (denied) return denied;
  const limited = await enforceRateLimit(
    req,
    "native:driver:route",
    120,
    60_000,
  );
  if (limited) return limited;
  const driverId = await getSessionSubject(req, "driver");
  if (!driverId) return securityJson({ ok: false }, 401);
  const tenantId = await getTenantId();
  const orders = await prisma.order.findMany({
    where: { tenantId, mode: "delivery", status: "out_for_delivery" },
    select: { id: true, driver: true, meta: true },
    take: 200,
  });
  const orderIds = orders
    .filter((row) => orderAssignedToDriver(row, driverId))
    .map((row) => row.id)
    .slice(0, 20);
  return securityJson({ ok: true, driverId, orderIds });
}
export async function POST(req: Request) {
  const denied = await requireMutationRole(req, ["driver"]);
  if (denied) return denied;
  const limited = await enforceRateLimit(req, "native:driver:stop", 30, 60_000);
  if (limited) return limited;
  const body = await req.json().catch(() => ({}));
  if (body.active !== false)
    return securityJson({ ok: false, error: "stop_only" }, 400);
  const tenantId = await getTenantId();
  const driverId = await getSessionSubject(req, "driver");
  if (!driverId) return securityJson({ ok: false }, 401);
  await prisma.trackingSession.updateMany({
    where: { tenantId, driverId, active: true },
    data: { active: false },
  });
  return securityJson({ ok: true });
}
