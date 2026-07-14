import { getServerSettings } from "@/lib/server/settings";
import { getStripeClient } from "@/lib/server/stripe-client";

function ensureObj(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function uniqueStrings(values: any[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
}

function paymentIntentIdsFromOrder(order: any) {
  const meta = ensureObj(order?.meta);
  const payment = ensureObj(meta?.payment ?? order?.payment);
  const shares = Array.isArray(payment?.shares) ? payment.shares : [];

  return uniqueStrings([
    payment?.id,
    payment?.paymentIntentId,
    ...(Array.isArray(payment?.paymentIntentIds)
      ? payment.paymentIntentIds
      : []),
    ...shares.map((share: any) => share?.paymentIntentId),
  ]);
}

function paymentMethodFromOrder(order: any) {
  const meta = ensureObj(order?.meta);
  const payment = ensureObj(meta?.payment ?? order?.payment);

  return String(
    payment?.method ??
      meta?.paymentMethod ??
      order?.paymentMethod ??
      "",
  )
    .toLowerCase()
    .trim();
}

function paymentStatusFromOrder(order: any) {
  const meta = ensureObj(order?.meta);
  const payment = ensureObj(meta?.payment ?? order?.payment);

  return String(
    payment?.status ??
      meta?.paymentStatus ??
      order?.paymentStatus ??
      "",
  )
    .toLowerCase()
    .trim();
}

export type PaymentRefundResult = {
  attempted: boolean;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  status: string;
  paymentIntentIds: string[];
  refunds: Array<{
    paymentIntentId: string;
    refundId?: string;
    amount?: number;
    currency?: string;
    status?: string;
    error?: string;
  }>;
  at: string;
};

export async function refundOrderPayments(
  order: any,
  by = "tv",
): Promise<PaymentRefundResult> {
  const at = new Date().toISOString();
  const method = paymentMethodFromOrder(order);
  const status = paymentStatusFromOrder(order);
  const paymentIntentIds = paymentIntentIdsFromOrder(order);

  const online =
    method === "online" ||
    method === "stripe" ||
    method === "split" ||
    method === "split_contactless" ||
    method === "split_online";

  if (!online) {
    return {
      attempted: false,
      ok: true,
      skipped: true,
      reason: "not_online",
      status: "not_required",
      paymentIntentIds,
      refunds: [],
      at,
    };
  }

  if (
    status === "refunded" ||
    status === "refund_pending" ||
    status === "partially_refunded"
  ) {
    return {
      attempted: false,
      ok: true,
      skipped: true,
      reason: "already_refunded",
      status,
      paymentIntentIds,
      refunds: [],
      at,
    };
  }

  const settings = await getServerSettings().catch(() => ({} as any));
  const refundOnCancel =
    settings?.payments?.online?.refundOnCancel !== false;

  if (!refundOnCancel) {
    return {
      attempted: false,
      ok: true,
      skipped: true,
      reason: "disabled_in_admin",
      status: "refund_disabled",
      paymentIntentIds,
      refunds: [],
      at,
    };
  }

  if (!paymentIntentIds.length) {
    return {
      attempted: true,
      ok: false,
      status: "refund_failed",
      paymentIntentIds,
      refunds: [
        {
          paymentIntentId: "",
          error: "PAYMENT_INTENT_ID_MISSING",
        },
      ],
      at,
    };
  }

  const stripe = getStripeClient();
  const refunds: PaymentRefundResult["refunds"] = [];

  for (const paymentIntentId of paymentIntentIds) {
    try {
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          metadata: {
            burger_order_id: String(order?.id || order?.orderId || ""),
            cancelled_by: String(by || "tv"),
          },
        },
        {
          idempotencyKey: `bb-cancel-${String(
            order?.id || order?.orderId || "order",
          )}-${paymentIntentId}`,
        },
      );

      refunds.push({
        paymentIntentId,
        refundId: refund.id,
        amount: Number(refund.amount || 0),
        currency: refund.currency,
        status: refund.status || undefined,
      });
    } catch (error: any) {
      refunds.push({
        paymentIntentId,
        error: error?.message || "REFUND_FAILED",
      });
    }
  }

  const successful = refunds.filter((item) => item.refundId).length;
  const failed = refunds.filter((item) => item.error).length;
  const pending = refunds.some((item) => item.status === "pending");

  return {
    attempted: true,
    ok: failed === 0 && successful === paymentIntentIds.length,
    status:
      failed === 0
        ? pending
          ? "refund_pending"
          : "refunded"
        : successful > 0
          ? "partially_refunded"
          : "refund_failed",
    paymentIntentIds,
    refunds,
    at,
  };
}
