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
  options: {
    retryFailed?: boolean;
    attempt?: number;
  } = {},
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
    (!options.retryFailed &&
      (status === "refund_pending" || status === "partially_refunded"))
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

  const previousPayment = ensureObj(ensureObj(order?.meta)?.payment ?? order?.payment);
  const previousRefund = ensureObj(previousPayment?.refund);
  const previousRefunds = Array.isArray(previousRefund?.refunds)
    ? previousRefund.refunds
    : [];
  const alreadyCreated = new Set(
    previousRefunds
      .filter((item: any) => item?.refundId)
      .map((item: any) => String(item.paymentIntentId || "").trim())
      .filter(Boolean),
  );
  const targets = options.retryFailed
    ? paymentIntentIds.filter((paymentIntentId) => !alreadyCreated.has(paymentIntentId))
    : paymentIntentIds;

  if (options.retryFailed && targets.length === 0) {
    return {
      attempted: false,
      ok: status === "refunded" || status === "refund_pending",
      skipped: true,
      reason: "no_failed_refund_left_to_retry",
      status: status || "refund_pending",
      paymentIntentIds,
      refunds: previousRefunds,
      at,
    };
  }

  const stripe = getStripeClient();
  const newRefunds: PaymentRefundResult["refunds"] = [];

  for (const paymentIntentId of targets) {
    try {
      const orderKey = String(order?.id || order?.orderId || "order");
      const attempt = Math.max(1, Number(options.attempt || 1));
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          metadata: {
            burger_order_id: String(order?.id || order?.orderId || ""),
            cancelled_by: String(by || "tv"),
          },
        },
        {
          // İlk denemenin tarihsel anahtarını koruyoruz; deploy sırasında aynı
          // iptal yeniden işlense bile Stripe yeni iade üretmez.
          idempotencyKey:
            attempt === 1
              ? `bb-cancel-${orderKey}-${paymentIntentId}`
              : `bb-cancel-${orderKey}-${paymentIntentId}-retry-${attempt}`,
        },
      );

      newRefunds.push({
        paymentIntentId,
        refundId: refund.id,
        amount: Number(refund.amount || 0),
        currency: refund.currency,
        status: refund.status || undefined,
      });
    } catch (error: any) {
      newRefunds.push({
        paymentIntentId,
        error: String(error?.code || error?.type || "REFUND_FAILED").slice(0, 80),
      });
    }
  }

  const refunds = options.retryFailed
    ? [
        ...previousRefunds.filter(
          (item: any) =>
            !targets.includes(String(item?.paymentIntentId || "").trim()),
        ),
        ...newRefunds,
      ]
    : newRefunds;
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

export async function reconcileFailedOrderRefunds(limit = 100) {
  const { prisma } = await import("@/lib/db");
  const rows = await prisma.order.findMany({
    where: {
      status: "cancelled",
    },
    orderBy: {
      updatedAt: "asc",
    },
    take: Math.max(1, Math.min(500, Math.trunc(limit || 100))),
    select: {
      id: true,
      meta: true,
      updatedAt: true,
    },
  });

  let eligible = 0;
  let repaired = 0;
  let failed = 0;

  for (const row of rows) {
    const meta = ensureObj(row.meta);
    const payment = ensureObj(meta.payment);
    const refund = ensureObj(payment.refund);
    const refundStatus = String(refund.status || "").toLowerCase().trim();

    if (!["refund_failed", "partially_refunded"].includes(refundStatus)) {
      continue;
    }

    eligible += 1;
    const attempt = Math.max(1, Number(refund.reconcileAttempt || 0) + 1);

    try {
      const result = await refundOrderPayments(
        row,
        "refund-reconciler",
        { retryFailed: true, attempt },
      );
      const nextMeta = {
        ...meta,
        paymentStatus: result.status,
        payment: {
          ...payment,
          status: result.status,
          refund: {
            ...refund,
            ...result,
            reconcileAttempt: attempt,
            reconciledAt: new Date().toISOString(),
            reconciledBy: "cron",
          },
        },
      };

      await prisma.order.update({
        where: { id: row.id },
        data: { meta: nextMeta },
      });

      if (result.ok) repaired += 1;
      else failed += 1;
    } catch (error) {
      failed += 1;
      console.error("[refund-reconcile] order retry failed", {
        orderId: row.id,
        error,
      });
    }
  }

  return {
    scanned: rows.length,
    eligible,
    repaired,
    failed,
  };
}
