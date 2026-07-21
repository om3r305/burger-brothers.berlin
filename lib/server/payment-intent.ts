import type Stripe from "stripe";

function objectId(value: any) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return String(value.id || "");
  return "";
}

export type DirectPaymentResult = {
  paymentIntentId: string;
  paymentMethodId: string;
  paymentMethodType: string;
  stripeCustomerId: string;
  status: "paid" | "processing" | "requires_action" | "failed";
  stripeStatus: string;
  errorCode?: string;
  errorMessage?: string;
};

function classifyPaymentIntent(
  intent: Stripe.PaymentIntent,
): DirectPaymentResult["status"] {
  if (intent.status === "succeeded") return "paid";
  if (intent.status === "processing") return "processing";
  if (intent.status === "requires_action") return "requires_action";
  return "failed";
}

export async function validateCustomerPaymentMethod(params: {
  stripe: Stripe;
  customerId: string;
  paymentMethodId: string;
}) {
  const customerId = String(params.customerId || "").trim();
  const paymentMethodId = String(params.paymentMethodId || "").trim();
  if (!customerId || !paymentMethodId) {
    throw new Error("SAVED_PAYMENT_METHOD_MISSING");
  }

  const paymentMethod =
    await params.stripe.paymentMethods.retrieve(paymentMethodId);
  const attachedCustomerId = objectId(paymentMethod.customer);
  if (!attachedCustomerId || attachedCustomerId !== customerId) {
    throw new Error("STRIPE_PAYMENT_METHOD_CUSTOMER_MISMATCH");
  }

  return paymentMethod;
}

export async function createAndConfirmSavedPayment(params: {
  stripe: Stripe;
  paymentSessionId: string;
  finalOrderId: string;
  paymentKind: "online" | "split_contactless";
  shareIndex: number;
  shareCount: number;
  amountCents: number;
  customerId: string;
  paymentMethodId: string;
  returnUrl: string;
  idempotencyKey: string;
}): Promise<DirectPaymentResult> {
  const amountCents = Math.round(Number(params.amountCents) || 0);
  if (amountCents < 50) {
    throw new Error("PAYMENT_AMOUNT_TOO_LOW");
  }

  const paymentMethod = await validateCustomerPaymentMethod({
    stripe: params.stripe,
    customerId: params.customerId,
    paymentMethodId: params.paymentMethodId,
  });

  const metadata = {
    burger_payment_session: params.paymentSessionId,
    burger_order_id: params.finalOrderId,
    payment_kind: params.paymentKind,
    share_index: String(params.shareIndex),
    share_count: String(params.shareCount),
    saved_payment: "1",
  };

  try {
    const intent = await params.stripe.paymentIntents.create(
      {
        amount: amountCents,
        currency: "eur",
        customer: params.customerId,
        payment_method: params.paymentMethodId,
        confirm: true,
        off_session: true,
        return_url: params.returnUrl,
        description:
          params.paymentKind === "split_contactless"
            ? `Burger Brothers Teilzahlung ${params.shareIndex + 1}/${params.shareCount}`
            : `Burger Brothers Bestellung #${params.finalOrderId}`,
        metadata,
      },
      { idempotencyKey: params.idempotencyKey },
    );

    return {
      paymentIntentId: intent.id,
      paymentMethodId: params.paymentMethodId,
      paymentMethodType: String(paymentMethod.type || "payment_method"),
      stripeCustomerId: params.customerId,
      status: classifyPaymentIntent(intent),
      stripeStatus: intent.status,
    };
  } catch (error: any) {
    const intent = error?.payment_intent as Stripe.PaymentIntent | undefined;
    if (intent?.id) {
      return {
        paymentIntentId: intent.id,
        paymentMethodId: params.paymentMethodId,
        paymentMethodType: String(paymentMethod.type || "payment_method"),
        stripeCustomerId: params.customerId,
        status: classifyPaymentIntent(intent),
        stripeStatus: String(intent.status || "requires_payment_method"),
        errorCode: String(
          error?.code || error?.decline_code || "PAYMENT_CONFIRM_FAILED",
        ),
        errorMessage: String(
          error?.message ||
            "Die gespeicherte Zahlungsart konnte nicht belastet werden.",
        ),
      };
    }
    throw error;
  }
}

export async function retrieveAuthorizedPaymentAction(params: {
  stripe: Stripe;
  paymentIntentId: string;
  paymentSessionId: string;
  shareIndex: number;
}) {
  const intent = await params.stripe.paymentIntents.retrieve(
    params.paymentIntentId,
  );
  const metadata = intent.metadata || {};
  if (
    String(metadata.burger_payment_session || "") !== params.paymentSessionId ||
    Number(metadata.share_index) !== params.shareIndex
  ) {
    throw new Error("PAYMENT_INTENT_ACCESS_MISMATCH");
  }
  if (intent.status === "requires_action" && intent.client_secret) {
    return {
      clientSecret: intent.client_secret,
      paymentIntentId: intent.id,
      status: intent.status,
      completed: false,
    };
  }
  if (["succeeded", "processing"].includes(intent.status)) {
    return {
      clientSecret: null,
      paymentIntentId: intent.id,
      status: intent.status,
      completed: true,
    };
  }
  throw new Error("PAYMENT_ACTION_NOT_REQUIRED");
}

export async function cancelPaymentIntentIfOpen(
  stripe: Stripe,
  paymentIntentId: string,
) {
  const id = String(paymentIntentId || "").trim();
  if (!id) return;
  try {
    const intent = await stripe.paymentIntents.retrieve(id);
    if (
      [
        "requires_payment_method",
        "requires_confirmation",
        "requires_action",
        "requires_capture",
        "processing",
      ].includes(intent.status)
    ) {
      await stripe.paymentIntents.cancel(id);
    }
  } catch {
    // A missing or already terminal PaymentIntent must not block cancellation.
  }
}
