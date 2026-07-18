import { NextResponse } from "next/server";
import { finalizePaymentSession } from "@/lib/server/payment-finalize";
import { prisma, getTenantId } from "@/lib/db";
import { enforceRateLimit } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const rateError = await enforceRateLimit(req, "payments:session", 30, 60_000);
  if (rateError) return rateError;

  const url = new URL(req.url);
  const paymentSessionId =
    url.searchParams.get("id") ||
    url.searchParams.get("paymentSession") ||
    "";

  try {
    const result = await finalizePaymentSession(paymentSessionId, req.url);
    let whatsappShareEnabled = true;

    try {
      const tenantId = await getTenantId();
      const pending = await prisma.order.findFirst({
        where: {
          tenantId,
          id: paymentSessionId,
        },
        select: {
          meta: true,
        },
      });
      const meta =
        pending?.meta && typeof pending.meta === "object" && !Array.isArray(pending.meta)
          ? (pending.meta as Record<string, any>)
          : {};
      const paymentSession =
        meta?.paymentSession &&
        typeof meta.paymentSession === "object" &&
        !Array.isArray(meta.paymentSession)
          ? meta.paymentSession
          : {};

      whatsappShareEnabled = paymentSession?.whatsappShareEnabled !== false;
    } catch {}

    const publicResult = {
      ...result,
      order: undefined,
      whatsappShareEnabled,
      shares: (Array.isArray(result.shares) ? result.shares : []).map((share) => ({
        index: share.index,
        label: share.label,
        amount: share.amount,
        baseAmount: share.baseAmount,
        serviceFee: share.serviceFee,
        status: share.status,
        shareUrl: share.shareUrl || share.url || null,
        items: Array.isArray(share.items) ? share.items : [],
      })),
    };

    return NextResponse.json(publicResult, {
      status: result.ok ? 200 : 400,
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error: any) {
    console.error("[payments/session]", error);

    return NextResponse.json(
      {
        ok: false,
        paymentSessionId,
        status: "failed",
        finalized: false,
        error: error?.message || "PAYMENT_SESSION_FAILED",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
        },
      },
    );
  }
}
