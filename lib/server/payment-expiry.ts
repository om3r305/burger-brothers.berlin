import { prisma, getTenantId } from "@/lib/db";
import { finalizePaymentSession } from "@/lib/server/payment-finalize";

const TERMINAL = new Set([
  "payment_completed",
  "payment_refunded",
  "payment_failed",
  "payment_expired",
  "payment_cancelled",
]);

export async function expireAbandonedPaymentSessions(requestUrl: string) {
  const tenantId = await getTenantId();
  const candidates = await prisma.order.findMany({
    where: {
      tenantId,
      id: { startsWith: "PAY-" },
      ts: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { ts: "asc" },
    take: 250,
    select: { id: true, status: true },
  });

  const results: any[] = [];
  for (const candidate of candidates) {
    if (TERMINAL.has(String(candidate.status || ""))) continue;
    try {
      const result = await finalizePaymentSession(candidate.id, requestUrl);
      results.push({ id: candidate.id, status: result.status, finalized: result.finalized });
    } catch (error: any) {
      results.push({ id: candidate.id, error: error?.message || "EXPIRY_CHECK_FAILED" });
    }
  }

  return {
    checked: results.length,
    finalized: results.filter((item) => item.finalized).length,
    expired: results.filter((item) => item.status === "expired").length,
    refunded: results.filter((item) => item.status === "refunded").length,
    failed: results.filter((item) => item.error).length,
    results,
  };
}
