import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { getServerSettings } from "@/lib/server/settings";
import {
  getStripeClient,
  resolveBaseUrl,
} from "@/lib/server/stripe-client";
import { createBurgerCheckoutSession } from "@/lib/server/payment-checkout";
import { resolvePaymentProfileCustomerId } from "@/lib/server/payment-profile";
import {
  hashPaymentShareToken,
  verifyPaymentShareToken,
} from "@/lib/server/payment-share-token";
import { finalizePaymentSession } from "@/lib/server/payment-finalize";
import { readOrderTrackingToken } from "@/lib/server/public-order";
import {
  enforceRateLimit,
  forbiddenResponse,
  hasTrustedMutationOrigin,
} from "@/lib/server/request-security";

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
  if (value === undefined || value === null) return null;
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

function json(payload: any, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  });
}

function readPaymentEnabled(settings: any, key: "online" | "split") {
  const direct = settings?.payments?.[key]?.enabled;
  if (typeof direct === "boolean") return direct;

  const legacy =
    key === "online"
      ? settings?.features?.payments?.onlinePayment ??
        settings?.features?.onlinePayment?.enabled
      : settings?.features?.payments?.splitPayment ??
        settings?.features?.splitPayment?.enabled;

  return Boolean(legacy);
}

async function loadShare(tokenRaw: string) {
  const token = String(tokenRaw || "").trim();
  const payload = verifyPaymentShareToken(token);

  if (!payload) {
    throw new Error("PAYMENT_SHARE_TOKEN_INVALID");
  }

  const tenantId = await getTenantId();
  const pending = await prisma.order.findFirst({
    where: {
      tenantId,
      id: payload.paymentSessionId,
    },
  });

  if (!pending) {
    throw new Error("PAYMENT_SESSION_NOT_FOUND");
  }

  const meta = ensureObj(pending.meta);
  const paymentSession = ensureObj(meta.paymentSession);
  const shares = Array.isArray(paymentSession.shares)
    ? paymentSession.shares
    : [];
  const sharePosition = shares.findIndex(
    (item: any) => Number(item?.index) === payload.shareIndex,
  );
  const share = sharePosition >= 0 ? shares[sharePosition] : null;

  if (!share) {
    throw new Error("PAYMENT_SHARE_NOT_FOUND");
  }

  if (
    String(share?.shareTokenHash || "") !== hashPaymentShareToken(token)
  ) {
    throw new Error("PAYMENT_SHARE_TOKEN_REVOKED");
  }

  return {
    token,
    payload,
    tenantId,
    pending,
    meta,
    paymentSession,
    shares,
    share,
    sharePosition,
  };
}

function publicShare(share: any, fallbackUrl = "") {
  return {
    index: Number(share?.index || 0),
    label: String(share?.label || "Person"),
    amount: Number(share?.amount || 0),
    baseAmount: Number(share?.baseAmount || 0),
    serviceFee: Number(share?.serviceFee || 0),
    status: String(share?.status || "open"),
    items: Array.isArray(share?.items) ? share.items : [],
    shareUrl: String(share?.shareUrl || fallbackUrl || ""),
  };
}

function numberOrNull(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function publicFinalOrderSummary(result: any) {
  const order = ensureObj(result?.order);
  const orderMeta = ensureObj(order?.meta);

  return {
    trackingToken:
      String(result?.trackingToken || "").trim() ||
      readOrderTrackingToken(order) ||
      null,
    mode: String(order?.mode || "").trim() || null,
    planned:
      String(order?.planned ?? orderMeta?.planned ?? orderMeta?.plannedTime ?? "").trim() ||
      null,
    etaMin: numberOrNull(
      order?.etaMin ?? orderMeta?.etaMin ?? orderMeta?.suggestedEtaMin,
    ),
    etaAdjustMin:
      numberOrNull(order?.etaAdjustMin ?? orderMeta?.etaAdjustMin) ?? 0,
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";

  try {
    const loaded = await loadShare(token);
    const result = await finalizePaymentSession(
      loaded.payload.paymentSessionId,
      req.url,
    );
    const resultShare = (Array.isArray(result.shares) ? result.shares : []).find(
      (item: any) => Number(item?.index) === loaded.payload.shareIndex,
    );
    const share = {
      ...loaded.share,
      ...ensureObj(resultShare),
      shareUrl: loaded.share?.shareUrl,
      items: loaded.share?.items,
    };

    return json({
      ok: result.ok,
      paymentSessionId: loaded.payload.paymentSessionId,
      finalOrderId: result.finalOrderId || null,
      finalized: result.finalized,
      sessionStatus: result.status,
      paidCount: result.paidCount,
      totalCount: result.totalCount,
      ...publicFinalOrderSummary(result),
      share: publicShare(share, loaded.share?.shareUrl),
      message: result.message || null,
      error: result.error || null,
    });
  } catch (error: any) {
    const code = String(error?.message || "PAYMENT_SHARE_FAILED");
    const status =
      code === "PAYMENT_SHARE_TOKEN_INVALID" ||
      code === "PAYMENT_SHARE_TOKEN_REVOKED"
        ? 403
        : code === "PAYMENT_SESSION_NOT_FOUND" ||
            code === "PAYMENT_SHARE_NOT_FOUND"
          ? 404
          : 500;

    return json(
      {
        ok: false,
        error: code,
        message:
          status === 403
            ? "Dieser Zahlungslink ist ungültig oder abgelaufen."
            : "Der Zahlungsanteil konnte nicht geladen werden.",
      },
      status,
    );
  }
}

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

  const rateError = await enforceRateLimit(
    req,
    "payments:share:start",
    20,
    10 * 60_000,
  );
  if (rateError) return rateError;

  const body = await req.json().catch(() => ({} as any));
  const token = String(body?.token || "").trim();

  try {
    const settings = await getServerSettings().catch(() => ({} as any));

    if (
      !readPaymentEnabled(settings, "online") ||
      !readPaymentEnabled(settings, "split")
    ) {
      return json(
        {
          ok: false,
          error: "SPLIT_PAYMENT_DISABLED",
          message: "Getrennt zahlen ist aktuell deaktiviert.",
        },
        403,
      );
    }

    const loaded = await loadShare(token);
    const checked = await finalizePaymentSession(
      loaded.payload.paymentSessionId,
      req.url,
    );
    const checkedShare = (
      Array.isArray(checked.shares) ? checked.shares : []
    ).find(
      (item: any) => Number(item?.index) === loaded.payload.shareIndex,
    );

    if (checked.finalized || checkedShare?.status === "paid") {
      return json({
        ok: true,
        paid: true,
        finalized: checked.finalized,
        finalOrderId: checked.finalOrderId || null,
      });
    }

    if (
      checked.status === "failed" ||
      checked.status === "refunded" ||
      checked.status === "expired"
    ) {
      return json(
        {
          ok: false,
          error: `PAYMENT_${String(checked.status).toUpperCase()}`,
          message:
            checked.message ||
            "Diese gemeinsame Zahlung kann nicht mehr fortgesetzt werden.",
        },
        409,
      );
    }

    const stripe = getStripeClient();
    const storedCheckoutSessionId = String(
      loaded.share?.checkoutSessionId || "",
    ).trim();

    if (storedCheckoutSessionId) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(
          storedCheckoutSessionId,
        );

        if (existing.payment_status === "paid") {
          const finalized = await finalizePaymentSession(
            loaded.payload.paymentSessionId,
            req.url,
          );

          return json({
            ok: true,
            paid: true,
            finalized: finalized.finalized,
            finalOrderId: finalized.finalOrderId || null,
          });
        }

        if (existing.status === "open" && existing.url) {
          return json({
            ok: true,
            paid: false,
            url: existing.url,
          });
        }

        if (existing.status === "complete") {
          return json(
            {
              ok: false,
              error: "PAYMENT_PROCESSING",
              message: "Die Zahlung wird noch bestätigt.",
            },
            409,
          );
        }
      } catch {
        /* Stripe oturumu bulunamazsa yeni deneme oluşturulur. */
      }
    }

    const rememberAllowed =
      settings?.payments?.online?.rememberPaymentMethods !== false;
    const rememberPayment =
      rememberAllowed && body?.rememberPayment === true;
    // A saved method belongs to the signed device profile and can be reused
    // for every non-cash flow. rememberPayment only controls saving a new method.
    const profileCustomerId = await resolvePaymentProfileCustomerId({
      req,
      stripe,
    });

    const baseUrl = resolveBaseUrl(req.url);
    const successUrl = new URL(
      `/pay/${encodeURIComponent(token)}`,
      baseUrl,
    );
    successUrl.searchParams.set("payment", "success");
    // Stripe replaces only the exact, unencoded placeholder literal.
    const successUrlWithCheckoutSession =
      `${successUrl.toString()}&checkout_session_id={CHECKOUT_SESSION_ID}`;

    const cancelUrl = new URL(
      `/pay/${encodeURIComponent(token)}`,
      baseUrl,
    );
    cancelUrl.searchParams.set("payment", "cancelled");

    const attempt = Math.max(
      1,
      Math.round(Number(loaded.share?.attempt || 0)) + 1,
    );

    const checkout = await createBurgerCheckoutSession({
      stripe,
      paymentSessionId: loaded.payload.paymentSessionId,
      finalOrderId: String(loaded.paymentSession.finalOrderId || ""),
      paymentKind: "split_contactless",
      share: {
        index: Number(loaded.share?.index || 0),
        label: String(loaded.share?.label || "Person"),
        amountCents: Math.max(
          0,
          Math.round(Number(loaded.share?.amount || 0) * 100),
        ),
      },
      shareCount: loaded.shares.length,
      successUrl: successUrlWithCheckoutSession,
      cancelUrl: cancelUrl.toString(),
      rememberPayment,
      customerId: profileCustomerId || undefined,
      idempotencyKey: `bb-share-checkout-${loaded.payload.paymentSessionId}-${loaded.payload.shareIndex}-${attempt}`,
      expiresAt: Number(loaded.payload.expiresAt || 0),
    });

    const nextShares = loaded.shares.map((item: any, index: number) =>
      index === loaded.sharePosition
        ? {
            ...item,
            attempt,
            checkoutSessionId: checkout.id,
            paymentIntentId:
              typeof checkout.payment_intent === "string"
                ? checkout.payment_intent
                : checkout.payment_intent?.id || "",
            status:
              checkout.payment_status === "paid" ? "paid" : "open",
            checkoutUrl: checkout.url || null,
            rememberPayment,
            startedAt: new Date().toISOString(),
          }
        : item,
    );

    await prisma.order.update({
      where: {
        id: loaded.pending.id,
      },
      data: {
        meta: sanitizeJson({
          ...loaded.meta,
          paymentSession: {
            ...loaded.paymentSession,
            state: "waiting_payment",
            shares: nextShares,
            lastShareStartedAt: new Date().toISOString(),
          },
        }),
      },
    });

    return json({
      ok: true,
      paid: checkout.payment_status === "paid",
      url: checkout.url,
    });
  } catch (error: any) {
    console.error("[payments/share]", error);

    const code = String(error?.message || "PAYMENT_SHARE_START_FAILED");
    const status =
      code === "PAYMENT_SHARE_TOKEN_INVALID" ||
      code === "PAYMENT_SHARE_TOKEN_REVOKED"
        ? 403
        : code === "PAYMENT_SESSION_NOT_FOUND" ||
            code === "PAYMENT_SHARE_NOT_FOUND"
          ? 404
          : code === "STRIPE_SECRET_KEY_MISSING"
            ? 503
            : 500;

    return json(
      {
        ok: false,
        error: code,
        message:
          code === "STRIPE_SECRET_KEY_MISSING"
            ? "Stripe ist auf dem Server noch nicht eingerichtet."
            : status === 403
              ? "Dieser Zahlungslink ist ungültig oder abgelaufen."
              : "Die Zahlung konnte nicht gestartet werden.",
      },
      status,
    );
  }
}
