import { NextResponse } from "next/server";
import { finalizePaymentSession } from "@/lib/server/payment-finalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const paymentSessionId =
    url.searchParams.get("id") ||
    url.searchParams.get("paymentSession") ||
    "";

  try {
    const result = await finalizePaymentSession(paymentSessionId, req.url);
    const publicResult = {
      ...result,
      order: undefined,
      shares: (Array.isArray(result.shares) ? result.shares : []).map((share) => ({
        index: share.index,
        label: share.label,
        amount: share.amount,
        baseAmount: share.baseAmount,
        serviceFee: share.serviceFee,
        status: share.status,
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
