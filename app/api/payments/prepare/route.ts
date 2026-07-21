import { randomBytes, randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { enforceRateLimit, forbiddenResponse, hasTrustedMutationOrigin } from "@/lib/server/request-security";
import { getServerSettings } from "@/lib/server/settings";
import {
  getStripeClient,
  resolveBaseUrl,
  stripeModeLabel,
} from "@/lib/server/stripe-client";
import { createBurgerCheckoutSession } from "@/lib/server/payment-checkout";
import { resolvePaymentProfileCustomerId } from "@/lib/server/payment-profile";
import {
  OrderPricingError,
  rebuildOrderPricingFromDatabase,
} from "@/lib/server/order-pricing";
import {
  OrderValidationError,
  validateOrderForCheckout,
} from "@/lib/server/order-validation";
import {
  buildPaymentManageUrl,
  createPaymentRecoveryToken,
  hashPaymentRecoveryValue,
  normalizePaymentRecoveryToken,
  normalizePaymentRequestId,
  paymentRecoveryExpiresAtMinutes,
  paymentRecoveryValueMatches,
} from "@/lib/server/payment-recovery-token";
import {
  buildPaymentShareUrl,
  createPaymentShareToken,
  hashPaymentShareToken,
} from "@/lib/server/payment-share-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

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

function toNumber(value: any, fallback = 0) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : fallback;
}

function toCents(value: any) {
  return Math.max(0, Math.round(toNumber(value, 0) * 100));
}

function fromCents(value: number) {
  return +(Math.max(0, value) / 100).toFixed(2);
}

function validEmail(value: any) {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanOrderId(value: string) {
  return value
    .replace(/[^A-Z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 12);
}

async function generateFinalOrderId(length: number) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const size = Math.min(12, Math.max(4, length || 6));

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const bytes = randomBytes(size);
    let value = "";

    for (let index = 0; index < size; index += 1) {
      value += chars[bytes[index] % chars.length];
    }

    const id = cleanOrderId(value);
    const exists = await prisma.order.findUnique({
      where: { id },
      select: { id: true },
    });

    if (!exists) return id;
  }

  return `O${Date.now().toString(36).toUpperCase()}`.slice(0, 12);
}

function readPaymentEnabled(
  settings: any,
  key: "online" | "split",
  fallback: boolean,
) {
  const direct = settings?.payments?.[key]?.enabled;
  if (typeof direct === "boolean") return direct;

  const legacy =
    key === "online"
      ? settings?.features?.payments?.onlinePayment ??
        settings?.features?.onlinePayment?.enabled
      : settings?.features?.payments?.splitPayment ??
        settings?.features?.splitPayment?.enabled;

  return typeof legacy === "boolean" ? legacy : fallback;
}

function cleanSplitShares(
  raw: any,
  payableCents: number,
  serviceFeeCents: number,
  maxPeople: number,
) {
  const input = Array.isArray(raw) ? raw : [];
  const count = input.length;

  if (count < 2 || count > maxPeople) {
    throw new Error("SPLIT_PERSON_COUNT_INVALID");
  }

  const shares = input.map((share: any, index: number) => {
    const baseAmountCents = Math.max(
      0,
      Math.round(
        Number(
          share?.baseAmountCents ??
            toCents(share?.baseAmount ?? share?.amount),
        ) || 0,
      ),
    );

    return {
      index,
      label: String(share?.label || `Person ${index + 1}`).slice(0, 80),
      baseAmountCents,
      serviceFeeCents,
      amountCents: baseAmountCents + serviceFeeCents,
      items: Array.isArray(share?.items)
        ? share.items.slice(0, 200).map((item: any) => ({
            key: String(item?.key || "").slice(0, 120),
            label: String(item?.label || "").slice(0, 160),
          }))
        : [],
    };
  });

  const baseSum = shares.reduce(
    (sum, share) => sum + share.baseAmountCents,
    0,
  );

  if (baseSum !== payableCents) {
    throw new Error("SPLIT_TOTAL_MISMATCH");
  }

  if (shares.some((share) => share.baseAmountCents <= 0)) {
    throw new Error("SPLIT_EMPTY_PERSON");
  }

  return shares;
}

function normalizePhone(value: any) {
  return String(value || "").replace(/\D/g, "");
}

async function resolveKnownStripeCustomerId(params: {
  req: Request;
  stripe: ReturnType<typeof getStripeClient>;
  customer: Record<string, any>;
}) {
  const phone = normalizePhone(params.customer?.phone);

  /*
   * Hesap/OTP sistemi olmadığı için yalnızca bu cihazdaki imzalı HttpOnly
   * ödeme profili kullanılır. Sadece telefon numarasıyla başka bir müşterinin
   * kayıtlı Stripe yöntemleri kesinlikle açılmaz.
   */
  return resolvePaymentProfileCustomerId({
    req: params.req,
    stripe: params.stripe,
    // The signed HttpOnly device profile is the authority. Pickup/delivery
    // form differences must not hide methods already saved on this device.
    phone,
    requirePhoneMatch: false,
  });
}

async function findReusablePaymentRequest(params: {
  tenantId: string;
  requestIdHash: string;
  recoveryToken: string;
}) {
  const recent = await prisma.order.findMany({
    where: {
      tenantId: params.tenantId,
      id: { startsWith: "PAY-" },
      status: {
        in: [
          "payment_pending",
          "payment_completed",
          "payment_failed",
          "payment_expired",
          "payment_cancelled",
        ],
      },
      ts: { gte: new Date(Date.now() - 72 * 60 * 60 * 1000) },
    },
    orderBy: { ts: "desc" },
    take: 30,
    select: { id: true, status: true, meta: true },
  });

  for (const row of recent) {
    const meta = ensureObj(row.meta);
    const paymentSession = ensureObj(meta.paymentSession);
    if (String(paymentSession.requestIdHash || "") !== params.requestIdHash) continue;
    if (
      !paymentRecoveryValueMatches(
        params.recoveryToken,
        String(paymentSession.recoveryTokenHash || ""),
      )
    ) {
      continue;
    }

    const expiresAtMs = Date.parse(String(paymentSession.recoveryExpiresAt || ""));
    if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) continue;

    return { row, paymentSession };
  }

  return null;
}

function reusablePaymentResponse(params: {
  paymentSessionId: string;
  paymentSession: Record<string, any>;
  recoveryToken: string;
}) {
  const session = params.paymentSession;
  const shares = Array.isArray(session.shares) ? session.shares : [];
  const isSplit = String(session.kind || "online") === "split_contactless";
  const manageUrl = String(session.manageUrl || "");
  const firstCheckoutUrl = String(shares[0]?.checkoutUrl || shares[0]?.url || "");

  return {
    ok: true,
    reused: true,
    paymentSessionId: params.paymentSessionId,
    finalOrderId: String(session.finalOrderId || ""),
    paymentKind: isSplit ? "split_contactless" : "online",
    shareCount: shares.length,
    baseTotal: Number(session.orderTotal ?? session.baseTotal ?? 0),
    serviceFeeTotal: Number(session.serviceFeeTotal || 0),
    total: Number(session.collectedTotal ?? session.total ?? 0),
    url: isSplit ? manageUrl : firstCheckoutUrl || manageUrl,
    manageUrl,
    recoveryToken: params.recoveryToken,
    recoveryExpiresAt: session.recoveryExpiresAt || null,
    whatsappShareEnabled: session.whatsappShareEnabled !== false,
    shares: shares.map((share: any) => ({
      index: Number(share?.index || 0),
      label: String(share?.label || "Person"),
      baseAmount: Number(share?.baseAmount || 0),
      serviceFee: Number(share?.serviceFee || 0),
      amount: Number(share?.amount || 0),
      status: String(share?.status || "open"),
      shareUrl: share?.shareUrl || null,
    })),
  };
}

function json(payload: any, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) return forbiddenResponse("origin_not_allowed");

  const rateError = await enforceRateLimit(req, "payments:prepare", 10, 5 * 60_000);
  if (rateError) return rateError;

  const body = await req.json().catch(() => ({} as any));
  const order = ensureObj(body?.order);
  const requestedKind =
    String(body?.paymentKind || body?.method || "online")
      .toLowerCase()
      .trim() === "split_contactless"
      ? "split_contactless"
      : "online";

  try {
    const settings = await getServerSettings().catch(() => ({} as any));
    const onlineEnabled = readPaymentEnabled(settings, "online", false);
    const splitEnabled = readPaymentEnabled(settings, "split", false);
    const rememberPaymentAllowed =
      settings?.payments?.online?.rememberPaymentMethods !== false;
    const rememberPayment =
      rememberPaymentAllowed && body?.rememberPayment === true;
    const whatsappShareEnabled =
      settings?.payments?.split?.whatsappShareEnabled !== false;
    const onlinePendingMinutes = Math.max(
      30,
      Math.min(
        24 * 60,
        Math.round(
          toNumber(settings?.payments?.online?.pendingExpiryMinutes, 30),
        ),
      ),
    );
    const splitPendingMinutes = Math.max(
      30,
      Math.min(
        24 * 60,
        Math.round(
          toNumber(settings?.payments?.split?.pendingExpiryMinutes, 30),
        ),
      ),
    );
    const pendingExpiryMinutes =
      requestedKind === "split_contactless"
        ? splitPendingMinutes
        : onlinePendingMinutes;

    if (!onlineEnabled) {
      return json(
        {
          ok: false,
          error: "ONLINE_PAYMENT_DISABLED",
          message: "Online-Zahlung ist im Adminbereich deaktiviert.",
        },
        403,
      );
    }

    if (requestedKind === "split_contactless" && !splitEnabled) {
      return json(
        {
          ok: false,
          error: "SPLIT_PAYMENT_DISABLED",
          message: "Getrennt zahlen ist im Adminbereich deaktiviert.",
        },
        403,
      );
    }

    const tenantId = await getTenantId();
    const recoveryToken =
      normalizePaymentRecoveryToken(body?.recoveryToken) ||
      createPaymentRecoveryToken();
    const paymentRequestId =
      normalizePaymentRequestId(body?.paymentRequestId) ||
      createPaymentRecoveryToken();
    const requestIdHash = hashPaymentRecoveryValue(paymentRequestId);
    const recoveryTokenHash = hashPaymentRecoveryValue(recoveryToken);
    const recoveryExpiresAt =
      paymentRecoveryExpiresAtMinutes(pendingExpiryMinutes);

    const reusable = await findReusablePaymentRequest({
      tenantId,
      requestIdHash,
      recoveryToken,
    });

    if (reusable) {
      return json(
        reusablePaymentResponse({
          paymentSessionId: reusable.row.id,
          paymentSession: reusable.paymentSession,
          recoveryToken,
        }),
      );
    }

    const rebuiltPricing = await rebuildOrderPricingFromDatabase({
      tenantId,
      order,
      settings,
    });
    await validateOrderForCheckout({
      tenantId,
      order,
      settings,
      pricing: rebuiltPricing,
    });
    const payableCents = rebuiltPricing.payableCents;

    if (payableCents < 50) {
      return json(
        {
          ok: false,
          error: "PAYMENT_AMOUNT_TOO_LOW",
          message: "Der Zahlbetrag ist zu niedrig.",
        },
        400,
      );
    }

    const splitSettings = ensureObj(settings?.payments?.split);
    const serviceFeeCents =
      requestedKind === "split_contactless"
        ? Math.max(0, toCents(splitSettings?.serviceFee ?? 0.2))
        : 0;
    const maxPeople = Math.min(
      10,
      Math.max(2, Math.round(toNumber(splitSettings?.maxPeople, 8))),
    );

    const shares =
      requestedKind === "split_contactless"
        ? cleanSplitShares(
            body?.shares,
            payableCents,
            serviceFeeCents,
            maxPeople,
          )
        : [
            {
              index: 0,
              label: "Online-Zahlung",
              baseAmountCents: payableCents,
              serviceFeeCents: 0,
              amountCents: payableCents,
              items: [],
            },
          ];

    const feeTotalCents = shares.reduce(
      (sum, share) => sum + share.serviceFeeCents,
      0,
    );
    const paidTotalCents = shares.reduce(
      (sum, share) => sum + share.amountCents,
      0,
    );

    const stripe = getStripeClient();
    const idLength = Math.max(
      4,
      Math.min(12, Math.round(toNumber(settings?.orders?.idLength, 6))),
    );
    const finalOrderId = await generateFinalOrderId(idLength);
    const paymentSessionId = `PAY-${randomUUID()}`;
    const now = new Date();
    const mode = rebuiltPricing.mode;
    const customer = ensureObj(order?.customer);
    const baseUrl = resolveBaseUrl(req.url);
    const shareExpiresAt =
      Math.floor(recoveryExpiresAt.getTime() / 1000);
    const preparedShares = shares.map((share) => {
      if (requestedKind !== "split_contactless") return { ...share };

      const shareToken = createPaymentShareToken({
        paymentSessionId,
        shareIndex: share.index,
        expiresAt: shareExpiresAt,
      });

      return {
        ...share,
        shareToken,
        shareTokenHash: hashPaymentShareToken(shareToken),
        shareUrl: buildPaymentShareUrl(baseUrl, shareToken),
        shareExpiresAt: new Date(shareExpiresAt * 1000).toISOString(),
      };
    });
    const adjustedOrder = sanitizeJson({
      ...order,
      items: rebuiltPricing.items,
      merchandise: fromCents(rebuiltPricing.merchandiseCents),
      discount: fromCents(rebuiltPricing.discountCents),
      surcharges: fromCents(rebuiltPricing.surchargesCents),
      total: fromCents(payableCents),
      coupon: rebuiltPricing.couponCode,
      couponDiscount: fromCents(rebuiltPricing.couponDiscountCents),
      paymentMethod: requestedKind,
      paymentStatus: "pending",
      paymentProvider: "stripe_checkout",
      meta: {
        ...ensureObj(order?.meta),
        paymentMethod: requestedKind,
        paymentStatus: "pending",
        paymentProvider: "stripe_checkout",
        payment: {
          ...ensureObj(ensureObj(order?.meta)?.payment),
          method: requestedKind,
          status: "pending",
          provider: "stripe_checkout",
          sessionId: paymentSessionId,
          baseTotal: fromCents(payableCents),
          orderTotal: fromCents(payableCents),
          serviceFeeTotal: fromCents(feeTotalCents),
          payableTotal: fromCents(paidTotalCents),
          collectedTotal: fromCents(paidTotalCents),
          pricingSource: "db",
          pricing: rebuiltPricing.pricingMeta,
          shares: preparedShares.map((share) => ({
            index: share.index,
            label: share.label,
            baseAmount: fromCents(share.baseAmountCents),
            serviceFee: fromCents(share.serviceFeeCents),
            amount: fromCents(share.amountCents),
            items: share.items,
            shareUrl: (share as any).shareUrl || null,
          })),
        },
      },
    });

    await prisma.order.create({
      data: {
        id: paymentSessionId,
        tenantId,
        mode,
        channel: "web",
        status: "payment_pending",
        merchandise: fromCents(rebuiltPricing.merchandiseCents),
        discount: fromCents(rebuiltPricing.discountCents),
        surcharges: fromCents(rebuiltPricing.surchargesCents),
        total: fromCents(payableCents),
        coupon: rebuiltPricing.couponCode,
        couponDiscount: fromCents(rebuiltPricing.couponDiscountCents),
        customer: sanitizeJson(customer),
        items: sanitizeJson(rebuiltPricing.items),
        meta: sanitizeJson({
          pendingOrder: adjustedOrder,
          paymentSession: {
            id: paymentSessionId,
            finalOrderId,
            kind: requestedKind,
            state: "creating_checkout",
            stripeMode: stripeModeLabel(),
            createdAt: now.toISOString(),
            requestIdHash,
            recoveryTokenHash,
            recoveryExpiresAt: recoveryExpiresAt.toISOString(),
            shareCount: shares.length,
            paidCount: 0,
            baseTotal: fromCents(payableCents),
            orderTotal: fromCents(payableCents),
            serviceFeeTotal: fromCents(feeTotalCents),
            total: fromCents(paidTotalCents),
            collectedTotal: fromCents(paidTotalCents),
            rememberPayment,
            whatsappShareEnabled,
            pendingExpiryMinutes,
            shares: preparedShares.map((share) => ({
              index: share.index,
              label: share.label,
              baseAmount: fromCents(share.baseAmountCents),
              serviceFee: fromCents(share.serviceFeeCents),
              amount: fromCents(share.amountCents),
              items: share.items,
              shareTokenHash: (share as any).shareTokenHash || null,
              shareUrl: (share as any).shareUrl || null,
              shareExpiresAt: (share as any).shareExpiresAt || null,
              status: "open",
              attempt: 0,
            })),
          },
        }),
        ts: now,
        planned: order?.planned ? String(order.planned) : null,
        etaMin: null,
        etaAdjustMin: 0,
        archivedAt: now,
      } as any,
    });

    const customerEmail = validEmail(customer?.email);
    const checkoutShares: any[] = [];

    try {
      if (requestedKind === "split_contactless") {
        for (const share of preparedShares) {
          checkoutShares.push({
            index: share.index,
            label: share.label,
            baseAmount: fromCents(share.baseAmountCents),
            serviceFee: fromCents(share.serviceFeeCents),
            amount: fromCents(share.amountCents),
            items: share.items,
            checkoutSessionId: "",
            paymentIntentId: "",
            status: "open",
            url: (share as any).shareUrl || null,
            shareUrl: (share as any).shareUrl || null,
            shareTokenHash: (share as any).shareTokenHash || null,
            shareExpiresAt: (share as any).shareExpiresAt || null,
            attempt: 0,
          });
        }
      } else {
        const share = preparedShares[0];
        const successUrl = new URL("/payment/return", baseUrl);
        successUrl.searchParams.set("paymentSession", paymentSessionId);
        successUrl.searchParams.set("recovery", recoveryToken);
        successUrl.searchParams.set("share", String(share.index));
        // URLSearchParams encodes the braces in Stripe's reserved placeholder.
        // Stripe only replaces the exact literal `{CHECKOUT_SESSION_ID}`.
        const successUrlWithCheckoutSession =
          `${successUrl.toString()}&checkout_session_id={CHECKOUT_SESSION_ID}`;

        const cancelUrl = new URL("/payment/return", baseUrl);
        cancelUrl.searchParams.set("payment", "cancelled");
        cancelUrl.searchParams.set("paymentSession", paymentSessionId);
        cancelUrl.searchParams.set("recovery", recoveryToken);
        cancelUrl.searchParams.set("share", String(share.index));

        /*
         * A previously remembered method may be used again even when the
         * customer leaves "remember this payment method" disabled for the
         * current order. The signed HttpOnly profile and phone hash still
         * protect the Stripe Customer lookup.
         */
        const knownCustomerId = await resolveKnownStripeCustomerId({
          req,
          stripe,
          customer,
        });

        const checkout = await createBurgerCheckoutSession({
          stripe,
          paymentSessionId,
          finalOrderId,
          paymentKind: "online",
          share: {
            index: share.index,
            label: share.label,
            amountCents: share.amountCents,
          },
          shareCount: 1,
          successUrl: successUrlWithCheckoutSession,
          cancelUrl: cancelUrl.toString(),
          rememberPayment,
          customerId: knownCustomerId || undefined,
          customerEmail: knownCustomerId ? undefined : customerEmail,
          idempotencyKey: `bb-checkout-${paymentSessionId}-${share.index}`,
          expiresAt: Math.floor(recoveryExpiresAt.getTime() / 1000),
        });

        checkoutShares.push({
          index: share.index,
          label: share.label,
          baseAmount: fromCents(share.baseAmountCents),
          serviceFee: fromCents(share.serviceFeeCents),
          amount: fromCents(share.amountCents),
          items: share.items,
          checkoutSessionId: checkout.id,
          paymentIntentId:
            typeof checkout.payment_intent === "string"
              ? checkout.payment_intent
              : checkout.payment_intent?.id || "",
          status: checkout.payment_status === "paid" ? "paid" : "open",
          url: checkout.url,
          checkoutUrl: checkout.url,
          rememberPayment,
        });
      }
    } catch (error: any) {
      await prisma.order.update({
        where: { id: paymentSessionId },
        data: {
          status: "payment_failed",
          meta: sanitizeJson({
            pendingOrder: adjustedOrder,
            paymentSession: {
              id: paymentSessionId,
              finalOrderId,
              kind: requestedKind,
              state: "checkout_create_failed",
              createdAt: now.toISOString(),
              requestIdHash,
              recoveryTokenHash,
              recoveryExpiresAt: recoveryExpiresAt.toISOString(),
              error: error?.message || "STRIPE_CHECKOUT_CREATE_FAILED",
              shares: checkoutShares,
            },
          }),
        },
      });

      throw error;
    }

    const manageUrl = buildPaymentManageUrl({
      baseUrl,
      paymentSessionId,
      recoveryToken,
      split: requestedKind === "split_contactless",
    });

    await prisma.order.update({
      where: { id: paymentSessionId },
      data: {
        meta: sanitizeJson({
          pendingOrder: adjustedOrder,
          paymentSession: {
            id: paymentSessionId,
            finalOrderId,
            kind: requestedKind,
            state: "waiting_payment",
            stripeMode: stripeModeLabel(),
            createdAt: now.toISOString(),
            requestIdHash,
            recoveryTokenHash,
            recoveryExpiresAt: recoveryExpiresAt.toISOString(),
            shareCount: checkoutShares.length,
            paidCount: 0,
            baseTotal: fromCents(payableCents),
            orderTotal: fromCents(payableCents),
            serviceFeeTotal: fromCents(feeTotalCents),
            total: fromCents(paidTotalCents),
            collectedTotal: fromCents(paidTotalCents),
            rememberPayment,
            whatsappShareEnabled,
            pendingExpiryMinutes,
            manageUrl,
            shares: checkoutShares,
          },
        }),
      },
    });

    return json({
      ok: true,
      paymentSessionId,
      finalOrderId,
      paymentKind: requestedKind,
      stripeMode: stripeModeLabel(),
      shareCount: checkoutShares.length,
      baseTotal: fromCents(payableCents),
      serviceFeeTotal: fromCents(feeTotalCents),
      total: fromCents(paidTotalCents),
      url:
        requestedKind === "split_contactless"
          ? manageUrl
          : checkoutShares[0]?.url || null,
      manageUrl,
      recoveryToken,
      recoveryExpiresAt: recoveryExpiresAt.toISOString(),
      whatsappShareEnabled,
      shares: checkoutShares.map((share) => ({
        index: share.index,
        label: share.label,
        baseAmount: share.baseAmount,
        serviceFee: share.serviceFee,
        amount: share.amount,
        status: share.status,
        shareUrl: share.shareUrl || null,
      })),
    });
  } catch (error: any) {
    console.error("[payments/prepare]", error);

    if (error instanceof OrderPricingError) {
      return json(
        {
          ok: false,
          error: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        error.status,
      );
    }

    if (error instanceof OrderValidationError) {
      return json(
        {
          ok: false,
          error: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
        },
        error.status,
      );
    }

    const message =
      error?.message === "SPLIT_PERSON_COUNT_INVALID"
        ? "Bitte zwischen 2 und der erlaubten Höchstzahl an Personen wählen."
        : error?.message === "SPLIT_TOTAL_MISMATCH"
          ? "Die Teilbeträge stimmen nicht mit dem Bestellbetrag überein."
          : error?.message === "SPLIT_EMPTY_PERSON"
            ? "Jede Person muss mindestens einen Artikel übernehmen."
            : error?.message === "STRIPE_SECRET_KEY_MISSING"
                  ? "Stripe ist auf dem Server noch nicht eingerichtet."
                  : error?.message || "Online-Zahlung konnte nicht gestartet werden.";

    const status =
      error?.message === "STRIPE_SECRET_KEY_MISSING"
        ? 503
        : [
              "SPLIT_PERSON_COUNT_INVALID",
              "SPLIT_TOTAL_MISMATCH",
              "SPLIT_EMPTY_PERSON",
            ].includes(String(error?.message || ""))
          ? 400
          : 500;

    return json(
      {
        ok: false,
        error: error?.message || "PAYMENT_PREPARE_FAILED",
        message,
      },
      status,
    );
  }
}
