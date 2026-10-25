import { prisma, getTenantId } from "@/lib/db";
import {
  fcmEndpointForToken,
  isFcmConfigured,
  normalizeFcmToken,
} from "@/lib/server/fcm";
import {
  DRIVER_PUSH_SCOPE,
  newDriverDeviceHash,
} from "@/lib/server/native-driver-push";
import { readSessionToken } from "@/lib/server/session";
import {
  enforceRateLimit,
  getSessionSubject,
  readRequestCookie,
  requireMutationRole,
  securityJson,
} from "@/lib/server/request-security";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function authorize(req: Request) {
  const denied = await requireMutationRole(req, ["driver"]);
  if (denied) return denied;
  return enforceRateLimit(req, "native:driver:push", 30, 60_000);
}
export async function POST(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;
  if (!isFcmConfigured())
    return securityJson({ ok: false, error: "push_not_configured" }, 409);
  const body = await req.json().catch(() => ({}));
  const token = normalizeFcmToken(body.token);
  if (!token)
    return securityJson({ ok: false, error: "invalid_native_device" }, 400);
  const driverId = await getSessionSubject(req, "driver");
  const session = await readSessionToken(
    readRequestCookie(req, "bb_driver_sess"),
    "driver",
  );
  if (!session?.credential || session.sub !== driverId)
    return securityJson({ ok: false, error: "unauthorized" }, 401);
  const tenantId = await getTenantId();
  const endpoint = fcmEndpointForToken(token, "driver");
  const fields = {
    p256dh: "",
    auth: session.credential,
    deviceId: driverId,
    platform: "android",
    appScope: DRIVER_PUSH_SCOPE,
    active: true,
    expirationTime: new Date(session.exp * 1000),
    lastSeenAt: new Date(),
    failureCount: 0,
  };
  await prisma.pushSubscription.upsert({
    where: { tenantId_endpoint: { tenantId, endpoint } },
    create: {
      tenantId,
      endpoint,
      ...fields,
      deviceTokenHash: newDriverDeviceHash(),
    },
    update: fields,
  });
  return securityJson({ ok: true });
}
export async function DELETE(req: Request) {
  const denied = await authorize(req);
  if (denied) return denied;
  const body = await req.json().catch(() => ({}));
  const token = normalizeFcmToken(body.token);
  if (!token)
    return securityJson({ ok: false, error: "invalid_native_device" }, 400);
  const tenantId = await getTenantId();
  const driverId = await getSessionSubject(req, "driver");
  await prisma.pushSubscription.updateMany({
    where: {
      tenantId,
      endpoint: fcmEndpointForToken(token, "driver"),
      appScope: DRIVER_PUSH_SCOPE,
      deviceId: driverId,
    },
    data: { active: false },
  });
  return securityJson({ ok: true });
}
