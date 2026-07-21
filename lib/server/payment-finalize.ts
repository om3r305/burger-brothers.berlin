import type Stripe from "stripe";
import { prisma, getTenantId } from "@/lib/db";
import { readOrderTrackingToken } from "@/lib/server/public-order";
import { getStripeClient, resolveBaseUrl } from "@/lib/server/stripe-client";
import { signPaymentFinalize } from "@/lib/server/payment-signature";

function ensureObj(value: any): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function sanitizeJson(value: any): any {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(sanitizeJson);

  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) continue;
      if (item === undefined) continue;
      out[key] = sanitizeJson(item);
    }
    return out;
  }

  return value;
}

function sessionPaymentIntentId(session: Stripe.Checkout.Session) {
  const intent = session.payment_intent;

  if (typeof intent === "string") return intent;
  if (intent && typeof intent === "object") return intent.id;

  return "";
}

function sessionCustomerId(session: Stripe.Checkout.Session) {
  const customer = session.customer;

  if (typeof customer === "string") return customer;
  if (customer && typeof customer === "object") return customer.id;

  return "";
}

function sessionPaid(session: Stripe.Checkout.Session) {
  return session.payment_status === "paid";
}

function sessionState(session: Stripe.Checkout.Session) {
  if (session.payment_status === "paid") return "paid";
  if (session.status === "expired") return "expired";

  const intent =
    session.payment_intent && typeof session.payment_intent === "object"
      ? session.payment_intent
      : null;
  const intentStatus = String(intent?.status || "").toLowerCase();

  if (
    intentStatus === "canceled" ||
    intentStatus === "requires_payment_method"
  ) {
    return "failed";
  }

  if (session.status === "complete") return "processing";
  return "open";
}

async function expireStripeCheckoutIfOpen(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
) {
  if (session.payment_status === "paid" || session.status !== "open") {
    return session;
  }

  try {
    return await stripe.checkout.sessions.expire(session.id);
  } catch {
    return session;
  }
}

async function refundPaidIntents(params: {
  paymentSessionId: string;
  finalOrderId: string;
  intents: string[];
  reason: string;
}) {
  const stripe = getStripeClient();
  const results: any[] = [];

  for (const paymentIntentId of Array.from(new Set(params.intents.filter(Boolean)))) {
    try {
      const refund = await stripe.refunds.create(
        {
          payment_intent: paymentIntentId,
          metadata: {
            burger_payment_session: params.paymentSessionId,
            burger_order_id: params.finalOrderId,
            reason: params.reason,
          },
        },
        {
          idempotencyKey: `bb-finalize-refund-${params.paymentSessionId}-${paymentIntentId}`,
        },
      );

      results.push({
        paymentIntentId,
        refundId: refund.id,
        status: refund.status,
        amount: refund.amount,
      });
    } catch (error: any) {
      results.push({
        paymentIntentId,
        error: error?.message || "REFUND_FAILED",
      });
    }
  }

  return results;
}

async function findExistingFinalOrder(tenantId: string, finalOrderId: string) {
  if (!finalOrderId) return null;

  return prisma.order.findFirst({
    where: {
      tenantId,
      id: finalOrderId,
    },
  });
}

async function markPendingFinalized(params: {
  pendingId: string;
  nextMeta: Record<string, any>;
  finalOrderId: string;
}) {
  await prisma.order.update({
    where: {
      id: params.pendingId,
    },
    data: {
      status: "payment_completed",
      meta: sanitizeJson({
        ...params.nextMeta,
        pendingOrder: null,
        paymentSession: {
          ...ensureObj(params.nextMeta.paymentSession),
          finalizedAt: new Date().toISOString(),
          finalOrderId: params.finalOrderId,
          finalOrderCreated: true,
          state: "finalized",
        },
      }),
    },
  });
}

export type FinalizePaymentResult = {
  ok: boolean;
  paymentSessionId: string;
  paymentKind: "online" | "split_contactless";
  status:
    | "pending"
    | "processing"
    | "paid"
    | "finalized"
    | "expired"
    | "failed"
    | "refunded";
  finalized: boolean;
  finalOrderId?: string;
  trackingToken?: string;
  order?: any;
  paidCount: number;
  totalCount: number;
  nextUrl?: string | null;
  nextShareIndex?: number | null;
  shares: Array<{
    index: number;
    label: string;
    amount: number;
    baseAmount: number;
    serviceFee: number;
    checkoutSessionId: string;
    paymentIntentId: string;
    stripeCustomerId?: string;
    status: string;
    url?: string | null;
    shareUrl?: string | null;
    shareTokenHash?: string | null;
    shareExpiresAt?: string | null;
    attempt?: number;
    items?: Array<{ key?: string; label?: string }>;
  }>;
  error?: string;
  message?: string;
};

export async function finalizePaymentSession(
  paymentSessionIdRaw: string,
  requestUrl?: string,
): Promise<FinalizePaymentResult> {
  const paymentSessionId = String(paymentSessionIdRaw || "").trim();

  if (!paymentSessionId || !paymentSessionId.startsWith("PAY-")) {
    return {
      ok: false,
      paymentSessionId,
      paymentKind: "online",
      status: "failed",
      finalized: false,
      paidCount: 0,
      totalCount: 0,
      shares: [],
      error: "INVALID_PAYMENT_SESSION",
    };
  }

  const tenantId = await getTenantId();
  const pending = await prisma.order.findFirst({
    where: {
      tenantId,
      id: paymentSessionId,
    },
  });

  if (!pending) {
    return {
      ok: false,
      paymentSessionId,
      paymentKind: "online",
      status: "failed",
      finalized: false,
      paidCount: 0,
      totalCount: 0,
      shares: [],
      error: "PAYMENT_SESSION_NOT_FOUND",
    };
  }

  const meta = ensureObj(pending.meta);
  const paymentSession = ensureObj(meta.paymentSession);
  const pendingOrder = ensureObj(meta.pendingOrder);
  const paymentKind =
    String(paymentSession.kind || "online") === "split_contactless"
      ? "split_contactless"
      : "online";
  const finalOrderId = String(paymentSession.finalOrderId || "").trim();
  const recoveryExpiresAtMs = Date.parse(
    String(paymentSession.recoveryExpiresAt || ""),
  );
  const recoveryExpired =
    Number.isFinite(recoveryExpiresAtMs) &&
    recoveryExpiresAtMs <= Date.now();

  if (paymentSession.finalizedAt && finalOrderId) {
    const existing = await prisma.order.findFirst({
      where: {
        tenantId,
        id: finalOrderId,
      },
    });

    return {
      ok: true,
      paymentSessionId,
      paymentKind,
      status: "finalized",
      finalized: true,
      finalOrderId,
      order: existing || undefined,
      paidCount: Number(paymentSession.shareCount || 1),
      totalCount: Number(paymentSession.shareCount || 1),
      nextUrl: null,
      nextShareIndex: null,
      shares: Array.isArray(paymentSession.shares)
        ? paymentSession.shares
        : [],
    };
  }

  const storedShares = Array.isArray(paymentSession.shares)
    ? paymentSession.shares
    : [];

  if (!storedShares.length) {
    return {
      ok: false,
      paymentSessionId,
      paymentKind,
      status: "failed",
      finalized: false,
      finalOrderId: finalOrderId || undefined,
      paidCount: 0,
      totalCount: 0,
      shares: [],
      error: "PAYMENT_SHARES_MISSING",
    };
  }

  const stripe = getStripeClient();
  const shares: FinalizePaymentResult["shares"] = [];

  for (const stored of storedShares) {
    const checkoutSessionId = String(stored?.checkoutSessionId || "").trim();

    if (!checkoutSessionId) {
      const shareExpiryMs = stored?.shareExpiresAt
        ? Date.parse(String(stored.shareExpiresAt))
        : Number.NaN;
      const shareExpired =
        recoveryExpired ||
        (Number.isFinite(shareExpiryMs) && shareExpiryMs <= Date.now());

      shares.push({
        index: Number(stored?.index || 0),
        label: String(stored?.label || ""),
        amount: Number(stored?.amount || 0),
        baseAmount: Number(stored?.baseAmount || 0),
        serviceFee: Number(stored?.serviceFee || 0),
        checkoutSessionId: "",
        paymentIntentId: "",
        stripeCustomerId: "",
        status: shareExpired ? "expired" : "open",
        url: shareExpired ? null : stored?.shareUrl || null,
        shareUrl: stored?.shareUrl || null,
        shareTokenHash: stored?.shareTokenHash || null,
        shareExpiresAt: stored?.shareExpiresAt || null,
        attempt: Number(stored?.attempt || 0),
        items: Array.isArray(stored?.items) ? stored.items : [],
      });
      continue;
    }

    try {
      let checkout: Stripe.Checkout.Session =
        await stripe.checkout.sessions.retrieve(checkoutSessionId, {
          expand: ["payment_intent"],
        });

      const shareExpiryMs = stored?.shareExpiresAt
        ? Date.parse(String(stored.shareExpiresAt))
        : Number.NaN;
      const initialCheckoutState = sessionState(checkout);
      const shareExpired =
        initialCheckoutState === "open" &&
        (recoveryExpired ||
          (Number.isFinite(shareExpiryMs) && shareExpiryMs <= Date.now()));

      if (shareExpired) {
        checkout = await expireStripeCheckoutIfOpen(stripe, checkout);
      }

      const checkoutState = shareExpired
        ? "expired"
        : sessionState(checkout);

      shares.push({
        index: Number(stored?.index || 0),
        label: String(stored?.label || `Person ${Number(stored?.index || 0) + 1}`),
        amount: Number(stored?.amount || 0),
        baseAmount: Number(stored?.baseAmount || 0),
        serviceFee: Number(stored?.serviceFee || 0),
        checkoutSessionId,
        paymentIntentId: sessionPaymentIntentId(checkout),
        stripeCustomerId: sessionCustomerId(checkout),
        status: checkoutState,
        url:
          checkoutState === "expired"
            ? null
            : stored?.shareUrl ||
              (checkout.status === "open" ? checkout.url : null),
        shareUrl: stored?.shareUrl || null,
        shareTokenHash: stored?.shareTokenHash || null,
        shareExpiresAt: stored?.shareExpiresAt || null,
        attempt: Number(stored?.attempt || 0),
        items: Array.isArray(stored?.items) ? stored.items : [],
      });
    } catch (error: any) {
      shares.push({
        index: Number(stored?.index || 0),
        label: String(stored?.label || ""),
        amount: Number(stored?.amount || 0),
        baseAmount: Number(stored?.baseAmount || 0),
        serviceFee: Number(stored?.serviceFee || 0),
        checkoutSessionId,
        paymentIntentId: String(stored?.paymentIntentId || ""),
        stripeCustomerId: String(stored?.stripeCustomerId || ""),
        status: "error",
        url: stored?.shareUrl || stored?.url || null,
        shareUrl: stored?.shareUrl || null,
        shareTokenHash: stored?.shareTokenHash || null,
        shareExpiresAt: stored?.shareExpiresAt || null,
        attempt: Number(stored?.attempt || 0),
        items: Array.isArray(stored?.items) ? stored.items : [],
      });
    }
  }

  const paidShares = shares.filter((share) => share.status === "paid");
  const cancelled =
    pending.status === "payment_cancelled" ||
    Boolean(paymentSession.cancelledAt) ||
    String(paymentSession.state || "") === "cancelled";
  const unpaidShares = shares.filter((share) => share.status !== "paid");
  const expired = unpaidShares.some((share) => share.status === "expired");
  const processing = unpaidShares.some((share) => share.status === "processing");
  const nextShare =
    unpaidShares.find((share) => share.status === "open" && share.url) || null;
  const failed = unpaidShares.some(
    (share) => share.status === "failed" || share.status === "error" || share.status === "missing",
  );

  const nextMeta = {
    ...meta,
    paymentSession: {
      ...paymentSession,
      shares: shares.map((share) => ({
        ...share,
        url: share.url || null,
      })),
      paidCount: paidShares.length,
      shareCount: shares.length,
      lastCheckedAt: new Date().toISOString(),
    },
  };

  await prisma.order
    .update({
      where: {
        id: pending.id,
      },
      data: {
        meta: sanitizeJson(nextMeta),
      },
    })
    .catch(() => null);

  if (cancelled) {
    const refunds = await refundPaidIntents({
      paymentSessionId,
      finalOrderId: finalOrderId || paymentSessionId,
      intents: paidShares.map((share) => share.paymentIntentId).filter(Boolean),
      reason: "payment_cancelled",
    });
    const refundFailed = refunds.some((refund) => refund?.error);

    await prisma.order
      .update({
        where: { id: pending.id },
        data: {
          status: paidShares.length
            ? refundFailed
              ? "payment_failed"
              : "payment_refunded"
            : "payment_cancelled",
          meta: sanitizeJson({
            ...nextMeta,
            paymentSession: {
              ...ensureObj(nextMeta.paymentSession),
              state: paidShares.length
                ? refundFailed
                  ? "refund_failed"
                  : "refunded"
                : "cancelled",
              terminalAt: new Date().toISOString(),
              autoRefunds: refunds,
            },
          }),
        },
      })
      .catch(() => null);

    return {
      ok: false,
      paymentSessionId,
      paymentKind,
      status: paidShares.length ? "refunded" : "failed",
      finalized: false,
      finalOrderId: finalOrderId || undefined,
      paidCount: paidShares.length,
      totalCount: shares.length,
      nextUrl: null,
      nextShareIndex: null,
      shares,
      error: refundFailed ? "AUTO_REFUND_FAILED" : "PAYMENT_CANCELLED",
      message: paidShares.length
        ? refundFailed
          ? "Die Zahlung wurde abgebrochen. Mindestens eine Rückerstattung muss manuell geprüft werden."
          : "Die Zahlung wurde abgebrochen und bereits bezahlte Anteile wurden automatisch zurückerstattet."
        : "Die Zahlung wurde abgebrochen. Es wurde nichts berechnet.",
    };
  }

  if ((expired || failed) && paidShares.length > 0) {
    const refunds = await refundPaidIntents({
      paymentSessionId,
      finalOrderId: finalOrderId || paymentSessionId,
      intents: paidShares
        .map((share) => share.paymentIntentId)
        .filter(Boolean),
      reason: expired ? "split_payment_expired" : "split_payment_failed",
    });
    const refundFailed = refunds.some((refund) => refund?.error);

    await prisma.order
      .update({
        where: {
          id: pending.id,
        },
        data: {
          status: refundFailed ? "refund_failed" : "payment_refunded",
          meta: sanitizeJson({
            ...nextMeta,
            paymentSession: {
              ...ensureObj(nextMeta.paymentSession),
              state: refundFailed ? "refund_failed" : "refunded",
              terminalAt: new Date().toISOString(),
              terminalReason: expired ? "expired" : "failed",
              autoRefunds: refunds,
            },
          }),
        },
      })
      .catch(() => null);

    return {
      ok: !refundFailed,
      paymentSessionId,
      paymentKind,
      status: refundFailed ? "failed" : "refunded",
      finalized: false,
      finalOrderId: finalOrderId || undefined,
      paidCount: paidShares.length,
      totalCount: shares.length,
      nextUrl: null,
      nextShareIndex: null,
      shares,
      error: refundFailed ? "AUTO_REFUND_FAILED" : undefined,
      message: refundFailed
        ? "Mindestens eine Teilzahlung konnte nicht automatisch zurückerstattet werden. Bitte Burger Brothers kontaktieren."
        : "Die bereits bezahlten Teilbeträge wurden automatisch zurückerstattet, weil die Bestellung nicht vollständig bezahlt wurde.",
    };
  }

  if ((expired || failed) && paidShares.length === 0) {
    await prisma.order
      .update({
        where: {
          id: pending.id,
        },
        data: {
          status: expired ? "payment_expired" : "payment_failed",
          meta: sanitizeJson({
            ...nextMeta,
            paymentSession: {
              ...ensureObj(nextMeta.paymentSession),
              state: expired ? "expired" : "failed",
              terminalAt: new Date().toISOString(),
            },
          }),
        },
      })
      .catch(() => null);

    return {
      ok: false,
      paymentSessionId,
      paymentKind,
      status: expired ? "expired" : "failed",
      finalized: false,
      finalOrderId: finalOrderId || undefined,
      paidCount: 0,
      totalCount: shares.length,
      nextUrl: null,
      nextShareIndex: null,
      shares,
      error: expired ? "PAYMENT_SESSION_EXPIRED" : "PAYMENT_FAILED",
      message: expired
        ? "Die Zahlungssitzung ist abgelaufen. Es wurde nichts berechnet."
        : "Die Zahlung konnte nicht abgeschlossen werden.",
    };
  }

  if (paidShares.length !== shares.length) {
    return {
      ok: true,
      paymentSessionId,
      paymentKind,
      status: expired ? "expired" : processing ? "processing" : "pending",
      finalized: false,
      finalOrderId: finalOrderId || undefined,
      paidCount: paidShares.length,
      totalCount: shares.length,
      nextUrl: nextShare?.url || null,
      nextShareIndex: nextShare?.index ?? null,
      shares,
      message: expired
        ? "Mindestens eine Zahlungssitzung ist abgelaufen."
        : processing
          ? "Die Zahlung wird noch bestätigt."
          : "Weitere Teilzahlung erforderlich.",
    };
  }

  const existing = await findExistingFinalOrder(tenantId, finalOrderId);

  if (existing) {
    await markPendingFinalized({
      pendingId: pending.id,
      nextMeta,
      finalOrderId,
    });

    return {
      ok: true,
      paymentSessionId,
      paymentKind,
      status: "finalized",
      finalized: true,
      finalOrderId,
      trackingToken: readOrderTrackingToken(existing) || undefined,
      order: existing,
      paidCount: shares.length,
      totalCount: shares.length,
      nextUrl: null,
      nextShareIndex: null,
      shares,
    };
  }

  if (!finalOrderId || !Object.keys(pendingOrder).length) {
    return {
      ok: false,
      paymentSessionId,
      paymentKind,
      status: "failed",
      finalized: false,
      finalOrderId: finalOrderId || undefined,
      paidCount: shares.length,
      totalCount: shares.length,
      shares,
      error: "FINAL_ORDER_PAYLOAD_MISSING",
    };
  }

  const paymentIntentIds = shares
    .map((share) => share.paymentIntentId)
    .filter(Boolean);
  const checkoutSessionIds = shares
    .map((share) => share.checkoutSessionId)
    .filter(Boolean);
  const stripeCustomerIds = Array.from(
    new Set(
      shares
        .map((share) => String(share.stripeCustomerId || "").trim())
        .filter(Boolean),
    ),
  );
  const stripeCustomerId = stripeCustomerIds[0] || "";
  const paidAt = new Date().toISOString();
  const paymentId = paymentIntentIds[0] || checkoutSessionIds[0] || paymentSessionId;

  const finalOrder = {
    ...pendingOrder,
    id: finalOrderId,
    paymentMethod: paymentKind,
    paymentStatus: "paid",
    paymentProvider: "stripe_checkout",
    paymentId,
    payment: {
      method: paymentKind,
      status: "paid",
      provider: "stripe_checkout",
      id: paymentId,
      paymentIntentIds,
      checkoutSessionIds,
      stripeCustomerId,
      stripeCustomerIds,
      sessionId: paymentSessionId,
      orderTotal: Number(
        paymentSession.orderTotal ?? paymentSession.baseTotal ?? pendingOrder.total ?? 0,
      ),
      serviceFeeTotal: Number(paymentSession.serviceFeeTotal || 0),
      collectedTotal: Number(
        paymentSession.collectedTotal ?? paymentSession.total ?? pendingOrder.total ?? 0,
      ),
      payableTotal: Number(
        paymentSession.collectedTotal ?? paymentSession.total ?? pendingOrder.total ?? 0,
      ),
      shares,
      paidAt,
    },
    meta: {
      ...ensureObj(pendingOrder.meta),
      paymentMethod: paymentKind,
      paymentStatus: "paid",
      paymentProvider: "stripe_checkout",
      paymentId,
      payment: {
        ...ensureObj(ensureObj(pendingOrder.meta).payment),
        method: paymentKind,
        status: "paid",
        provider: "stripe_checkout",
        id: paymentId,
        paymentIntentIds,
        checkoutSessionIds,
        stripeCustomerId,
        stripeCustomerIds,
        sessionId: paymentSessionId,
        orderTotal: Number(
          paymentSession.orderTotal ?? paymentSession.baseTotal ?? pendingOrder.total ?? 0,
        ),
        serviceFeeTotal: Number(paymentSession.serviceFeeTotal || 0),
        collectedTotal: Number(
          paymentSession.collectedTotal ?? paymentSession.total ?? pendingOrder.total ?? 0,
        ),
        payableTotal: Number(
          paymentSession.collectedTotal ?? paymentSession.total ?? pendingOrder.total ?? 0,
        ),
        shares,
        paidAt,
      },
    },
  };

  const baseUrl = resolveBaseUrl(requestUrl);
  const signature = signPaymentFinalize(paymentSessionId, finalOrderId);

  let response: Response;
  let created: any = null;

  try {
    response = await fetch(`${baseUrl}/api/orders/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-bb-payment-finalize": signature,
        "x-bb-payment-session": paymentSessionId,
      },
      body: JSON.stringify({
        order: finalOrder,
        notify: true,
      }),
      cache: "no-store",
    });

    created = await response.json().catch(() => ({}));

    if (!response.ok || created?.ok === false) {
      throw new Error(
        created?.message ||
          created?.error ||
          `ORDER_FINALIZE_${response.status}`,
      );
    }
  } catch (error: any) {
    /*
     * Webhook ve dönüş sayfası aynı anda finalize edebilir. HTTP cevabı
     * kaybolsa veya benzersiz ID yarışı yaşansa bile sipariş DB'de oluştuysa
     * ödeme iade edilmez; mevcut sipariş başarılı kabul edilir.
     */
    const racedExisting = await findExistingFinalOrder(tenantId, finalOrderId)
      .catch(() => null);

    if (racedExisting) {
      await markPendingFinalized({
        pendingId: pending.id,
        nextMeta,
        finalOrderId,
      }).catch(() => null);

      return {
        ok: true,
        paymentSessionId,
        paymentKind,
        status: "finalized",
        finalized: true,
        finalOrderId,
        trackingToken: readOrderTrackingToken(racedExisting) || undefined,
        order: racedExisting,
        paidCount: shares.length,
        totalCount: shares.length,
        nextUrl: null,
        nextShareIndex: null,
        shares,
      };
    }

    const refunds = await refundPaidIntents({
      paymentSessionId,
      finalOrderId,
      intents: paymentIntentIds,
      reason: "order_finalize_failed",
    });

    await prisma.order
      .update({
        where: {
          id: pending.id,
        },
        data: {
          status: "payment_failed",
          meta: sanitizeJson({
            ...nextMeta,
            paymentSession: {
              ...ensureObj(nextMeta.paymentSession),
              finalizeError: error?.message || "ORDER_FINALIZE_FAILED",
              finalizeFailedAt: new Date().toISOString(),
              autoRefunds: refunds,
              state: "refunded",
            },
          }),
        },
      })
      .catch(() => null);

    return {
      ok: false,
      paymentSessionId,
      paymentKind,
      status: "refunded",
      finalized: false,
      finalOrderId,
      paidCount: shares.length,
      totalCount: shares.length,
      shares,
      error: error?.message || "ORDER_FINALIZE_FAILED",
      message:
        "Die Zahlung wurde zurückerstattet, weil die Bestellung nicht erstellt werden konnte.",
    };
  }

  const finalCreatedOrder =
    created?.order ||
    created?.item ||
    created?.data ||
    created;

  await markPendingFinalized({
    pendingId: pending.id,
    nextMeta,
    finalOrderId,
  });

  return {
    ok: true,
    paymentSessionId,
    paymentKind,
    status: "finalized",
    finalized: true,
    finalOrderId,
    trackingToken:
      String(created?.trackingToken || "").trim() ||
      readOrderTrackingToken(finalCreatedOrder) ||
      undefined,
    order: finalCreatedOrder,
    paidCount: shares.length,
    totalCount: shares.length,
    nextUrl: null,
    nextShareIndex: null,
    shares,
  };
}
