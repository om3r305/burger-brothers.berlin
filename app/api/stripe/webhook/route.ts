import { NextResponse } from "next/server";
import { getStripeClient } from "@/lib/server/stripe-client";
import { finalizePaymentSession } from "@/lib/server/payment-finalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function paymentSessionIdFromObject(value: any) {
  return String(
    value?.metadata?.burger_payment_session ||
      value?.payment_intent?.metadata?.burger_payment_session ||
      "",
  ).trim();
}

export async function POST(req: Request) {
  const webhookSecret = String(
    process.env.STRIPE_WEBHOOK_SECRET || "",
  ).trim();

  if (!webhookSecret) {
    return NextResponse.json(
      {
        ok: false,
        error: "STRIPE_WEBHOOK_SECRET_MISSING",
      },
      { status: 503 },
    );
  }

  const signature = req.headers.get("stripe-signature") || "";
  const rawBody = await req.text();

  try {
    const stripe = getStripeClient();
    const event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );

    const supported = new Set([
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
    ]);

    if (supported.has(event.type)) {
      const object = event.data.object as any;
      const paymentSessionId = paymentSessionIdFromObject(object);

      if (paymentSessionId) {
        await finalizePaymentSession(paymentSessionId, req.url);
      }
    }

    return NextResponse.json({
      received: true,
      type: event.type,
    });
  } catch (error: any) {
    console.error("[stripe/webhook]", error);

    return NextResponse.json(
      {
        received: false,
        error: error?.message || "STRIPE_WEBHOOK_FAILED",
      },
      { status: 400 },
    );
  }
}
