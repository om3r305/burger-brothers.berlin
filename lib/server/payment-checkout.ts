import type Stripe from "stripe";

function validEmail(value: any) {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export async function createBurgerCheckoutSession(params: {
  stripe: Stripe;
  paymentSessionId: string;
  finalOrderId: string;
  paymentKind: "online" | "split_contactless";
  share: {
    index: number;
    label: string;
    amountCents: number;
  };
  shareCount: number;
  successUrl: string;
  cancelUrl: string;
  rememberPayment: boolean;
  customerId?: string;
  customerEmail?: string;
  idempotencyKey: string;
  expiresAt?: number;
}) {
  const customerId = String(params.customerId || "").trim();
  const customerEmail = validEmail(params.customerEmail);

  const nowSeconds = Math.floor(Date.now() / 1000);
  const requestedExpiry = Math.floor(Number(params.expiresAt) || 0);
  const expiresAt = Math.max(
    nowSeconds + 30 * 60,
    Math.min(requestedExpiry || nowSeconds + 23 * 60 * 60, nowSeconds + 23 * 60 * 60),
  );

  const customerParams: Stripe.Checkout.SessionCreateParams =
    params.rememberPayment && customerId
    ? {
        customer: customerId,
        customer_update: {
          address: "auto",
          name: "auto",
        },
      }
    : params.rememberPayment
      ? {
          customer_creation: "always",
          ...(customerEmail ? { customer_email: customerEmail } : {}),
        }
      : customerEmail
        ? {
            customer_email: customerEmail,
          }
        : {};

  const metadata = {
    burger_payment_session: params.paymentSessionId,
    burger_order_id: params.finalOrderId,
    payment_kind: params.paymentKind,
    share_index: String(params.share.index),
    share_count: String(params.shareCount),
    remember_payment: params.rememberPayment ? "1" : "0",
  };

  return params.stripe.checkout.sessions.create(
    {
      mode: "payment",
      locale: "de",
      submit_type: "pay",
      ...customerParams,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "eur",
            unit_amount: params.share.amountCents,
            product_data: {
              name:
                params.paymentKind === "split_contactless"
                  ? `Burger Brothers – ${params.share.label}`
                  : "Burger Brothers Bestellung",
              description:
                params.paymentKind === "split_contactless"
                  ? `Teilzahlung ${params.share.index + 1} von ${params.shareCount}`
                  : `Bestellung #${params.finalOrderId}`,
            },
          },
        },
      ],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      expires_at: expiresAt,
      metadata,
      payment_intent_data: {
        metadata,
        ...(params.rememberPayment
          ? {
              setup_future_usage: "off_session" as const,
            }
          : {}),
      },
      ...(params.rememberPayment
        ? {
            saved_payment_method_options: {
              payment_method_save: "enabled",
              payment_method_remove: "enabled",
            },
          }
        : {}),
    },
    {
      idempotencyKey: params.idempotencyKey,
    },
  );
}
