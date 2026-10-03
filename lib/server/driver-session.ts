import { createHash } from "node:crypto";
import { prisma, getTenantId } from "@/lib/db";
import type { SessionPayload } from "@/lib/server/session";

export function driverCredentialVersion(driver: { id: string; passwordHash: string; role: string }) {
  return createHash("sha256").update(JSON.stringify([driver.id, driver.passwordHash, driver.role])).digest("hex");
}

export async function driverSessionIsCurrent(payload: SessionPayload): Promise<boolean> {
  if (!payload.sub || !payload.credential) return false;
  try {
    const tenantId = await getTenantId();
    const row = await prisma.setting.findFirst({
      where: { tenantId, key: "drivers" }, orderBy: { updatedAt: "desc" }, select: { value: true },
    });
    const value: any = row?.value;
    const items = Array.isArray(value) ? value : value?.items ?? value?.drivers ?? [];
    const driver = items.find((item: any) => String(item?.id || item?.name || "").trim() === payload.sub);
    return Boolean(driver?.passwordHash && driverCredentialVersion({
      id: payload.sub, passwordHash: String(driver.passwordHash), role: driver.role === "admin" ? "admin" : "fahrer",
    }) === payload.credential);
  } catch {
    // A database failure cannot grant access to customer orders.
    return false;
  }
}
