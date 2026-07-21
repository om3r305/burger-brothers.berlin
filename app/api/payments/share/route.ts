import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { getServerSettings } from "@/lib/server/settings";
import {
  getStripeClient,
  getStripePublishableKey,
  resolveBaseUrl,
} from "@/lib/server/stripe-client";
import { createBurgerCheckoutSession } from "@/lib/server/payment-checkout";
import {
  cancelPaymentIntentIfOpen,
  createAndConfirmSavedPayment,
  retrieveAuthorizedPaymentAction,
} from "@/lib/server/payment-intent";
import { resolvePaymentProfileCustomerId } from "@/lib/server/payment-profile";
import { withPaymentMutationClaim } from "@/lib/server/payment-mutation-lock";
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
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(sanitizeJson);
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, item] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) continue;
      if (item !== undefined) out[key] = sanitizeJson(item);
    }
    return out;
  }
  return value;
}

function json(payload: any, status = 200) {
  return NextResponse.json(payload, { status, headers: NO_STORE_HEADERS });
}

function readPaymentEnabled(settings: any, key: "online" | "split") {
  const direct = settings?.payments?.[key]?.enabled;
  if (typeof direct === "boolean") return direct;
  const legacy =
    key === "online"
      ? (settings?.features?.payments?.onlinePayment ??
        settings?.features?.onlinePayment?.enabled)
      : (settings?.features?.payments?.splitPayment ??
        settings?.features?.splitPayment?.enabled);
  return Boolean(legacy);
}

async function loadShare(tokenRaw: string) {
  const token = String(tokenRaw || "").trim();
  const payload = verifyPaymentShareToken(token);
  if (!payload) throw new Error("PAYMENT_SHARE_TOKEN_INVALID");

  const tenantId = await getTenantId();
  const pending = await prisma.order.findFirst({
    where: { tenantId, id: payload.paymentSessionId },
  });
  if (!pending) throw new Error("PAYMENT_SESSION_NOT_FOUND");

  const meta = ensureObj(pending.meta);
  const paymentSession = ensureObj(meta.paymentSession);
  const shares = Array.isArray(paymentSession.shares)
    ? paymentSession.shares
    : [];
  const sharePosition = shares.findIndex(
    (item: any) => Number(item?.index) === payload.shareIndex,
  );
  const share = sharePosition >= 0 ? shares[sharePosition] : null;
  if (!share) throw new Error("PAYMENT_SHARE_NOT_FOUND");
  if (String(share.shareTokenHash || "") !== hashPaymentShareToken(token)) {
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

function publicShare(share: any, own = false) {
  return {
    index: Number(share?.index || 0),
    label: String(share?.label || "Person"),
    amount: Number(share?.amount || 0),
    baseAmount: Number(share?.baseAmount || 0),
    serviceFee: Number(share?.serviceFee || 0),
    status: String(share?.status || "open"),
    paymentMethodType: String(share?.paymentMethodType || "") || null,
    items: Array.isArray(share?.items) ? share.items : [],
    shareUrl: own ? String(share?.shareUrl || "") : "",
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
      String(
        order?.planned ?? orderMeta?.planned ?? orderMeta?.plannedTime ?? "",
      ).trim() || null,
    etaMin: numberOrNull(
      order?.etaMin ?? orderMeta?.etaMin ?? orderMeta?.suggestedEtaMin,
    ),
    etaAdjustMin:
      numberOrNull(order?.etaAdjustMin ?? orderMeta?.etaAdjustMin) ?? 0,
  };
}

function shareActionUrl(baseUrl: string, token: string) {
  const url = new URL("/payment/action", baseUrl);
  url.searchParams.set("token", token);
  url.searchParams.set("returnTo", "share");
  return url.toString();
}

function isTerminalFinalizeFailure(result: any) {
  return (
    result?.status === "failed" &&
    [
      "PAYMENT_INTEGRITY_INVALID",
      "PAYMENT_SHARES_MISSING",
      "FINAL_ORDER_PAYLOAD_MISSING",
      "INVALID_PAYMENT_SESSION",
    ].includes(String(result?.error || ""))
  );
}

async function updateShare(params: {
  loaded: Awaited<ReturnType<typeof loadShare>>;
  nextShare: Record<string, any>;
}) {
  const nextShares = params.loaded.shares.map((item: any, index: number) =>
    index === params.loaded.sharePosition ? params.nextShare : item,
  );
  await prisma.order.update({
    where: { id: params.loaded.pending.id },
    data: {
      status: "payment_pending",
      meta: sanitizeJson({
        ...params.loaded.meta,
        paymentSession: {
          ...params.loaded.paymentSession,
          state: "waiting_payment",
          shares: nextShares,
          lastShareStartedAt: new Date().toISOString(),
        },
      }),
    },
  });
}

async function createCheckoutAttempt(params: {
  req: Request;
  loaded: Awaited<ReturnType<typeof loadShare>>;
  rememberPayment: boolean;
}) {
  const stripe = getStripeClient();
  const profileCustomerId = await resolvePaymentProfileCustomerId({
    req: params.req,
    stripe,
  });
  const baseUrl = resolveBaseUrl(params.req.url);
  const successUrl = new URL(
    `/pay/${encodeURIComponent(params.loaded.token)}`,
    baseUrl,
  );
  successUrl.searchParams.set("payment", "success");
  const successUrlWithCheckoutSession = `${successUrl.toString()}&checkout_session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = new URL(
    `/pay/${encodeURIComponent(params.loaded.token)}`,
    baseUrl,
  );
  cancelUrl.searchParams.set("payment", "cancelled");
  const attempt = Math.max(
    1,
    Math.round(Number(params.loaded.share?.attempt || 0)) + 1,
  );

  const checkout = await createBurgerCheckoutSession({
    stripe,
    paymentSessionId: params.loaded.payload.paymentSessionId,
    finalOrderId: String(params.loaded.paymentSession.finalOrderId || ""),
    paymentKind: "split_contactless",
    share: {
      index: Number(params.loaded.share?.index || 0),
      label: String(params.loaded.share?.label || "Person"),
      amountCents: Math.round(Number(params.loaded.share?.amount || 0) * 100),
    },
    shareCount: params.loaded.shares.length,
    successUrl: successUrlWithCheckoutSession,
    cancelUrl: cancelUrl.toString(),
    rememberPayment: params.rememberPayment,
    customerId: profileCustomerId || undefined,
    idempotencyKey: `bb-share-checkout-${params.loaded.payload.paymentSessionId}-${params.loaded.payload.shareIndex}-${attempt}`,
    expiresAt: Number(params.loaded.payload.expiresAt || 0),
  });

  const nextShare = {
    ...params.loaded.share,
    attempt,
    flow: "checkout",
    checkoutSessionId: checkout.id,
    paymentIntentId:
      typeof checkout.payment_intent === "string"
        ? checkout.payment_intent
        : checkout.payment_intent?.id || "",
    paymentMethodId: "",
    paymentMethodType: "",
    stripeCustomerId: profileCustomerId || "",
    status: checkout.payment_status === "paid" ? "paid" : "open",
    checkoutUrl: checkout.url || null,
    actionUrl: null,
    errorCode: null,
    errorMessage: null,
    rememberPayment: params.rememberPayment,
    startedAt: new Date().toISOString(),
  };
  await updateShare({ loaded: params.loaded, nextShare });
  return { nextShare, url: checkout.url };
}

async function createSavedAttempt(params: {
  req: Request;
  loaded: Awaited<ReturnType<typeof loadShare>>;
  paymentMethodId: string;
}) {
  const stripe = getStripeClient();
  const customerId = await resolvePaymentProfileCustomerId({
    req: params.req,
    stripe,
  });
  if (!customerId || !params.paymentMethodId) {
    throw new Error("SAVED_PAYMENT_METHOD_MISSING");
  }
  const attempt = Math.max(
    1,
    Math.round(Number(params.loaded.share?.attempt || 0)) + 1,
  );
  const actionUrl = shareActionUrl(
    resolveBaseUrl(params.req.url),
    params.loaded.token,
  );
  const direct = await createAndConfirmSavedPayment({
    stripe,
    paymentSessionId: params.loaded.payload.paymentSessionId,
    finalOrderId: String(params.loaded.paymentSession.finalOrderId || ""),
    paymentKind: "split_contactless",
    shareIndex: Number(params.loaded.share?.index || 0),
    shareCount: params.loaded.shares.length,
    amountCents: Math.round(Number(params.loaded.share?.amount || 0) * 100),
    customerId,
    paymentMethodId: params.paymentMethodId,
    returnUrl: actionUrl,
    idempotencyKey: `bb-share-saved-${params.loaded.payload.paymentSessionId}-${params.loaded.payload.shareIndex}-${attempt}`,
  });
  const nextShare = {
    ...params.loaded.share,
    attempt,
    flow: "saved_payment",
    checkoutSessionId: "",
    paymentIntentId: direct.paymentIntentId,
    paymentMethodId: direct.paymentMethodId,
    paymentMethodType: direct.paymentMethodType,
    stripeCustomerId: direct.stripeCustomerId,
    status: direct.status,
    stripeStatus: direct.stripeStatus,
    actionUrl: direct.status === "requires_action" ? actionUrl : null,
    checkoutUrl: null,
    errorCode: direct.errorCode || null,
    errorMessage: direct.errorMessage || null,
    startedAt: new Date().toISOString(),
  };
  await updateShare({ loaded: params.loaded, nextShare });
  return {
    nextShare,
    url:
      direct.status === "requires_action"
        ? actionUrl
        : `/pay/${encodeURIComponent(params.loaded.token)}`,
  };
}

async function runClaimed<T>(
  loaded: Awaited<ReturnType<typeof loadShare>>,
  run: () => Promise<T>,
) {
  return withPaymentMutationClaim({
    tenantId: loaded.tenantId,
    paymentSessionId: loaded.payload.paymentSessionId,
    run,
  });
}

export async function GET(req: Request) {
  const rateError = await enforceRateLimit(req, "payments:share", 40, 60_000);
  if (rateError) return rateError;
  const url = new URL(req.url);
  const token = url.searchParams.get("token") || "";

  try {
    const loaded = await loadShare(token);
    const result = await finalizePaymentSession(
      loaded.payload.paymentSessionId,
      req.url,
    );
    const resultShares = Array.isArray(result.shares) ? result.shares : [];
    const ownShare = resultShares.find(
      (item: any) => Number(item?.index) === loaded.payload.shareIndex,
    );

    return json({
      ok: result.ok,
      paymentSessionId: loaded.payload.paymentSessionId,
      finalOrderId: result.finalOrderId || null,
      finalized: result.finalized,
      sessionStatus: result.status,
      paidCount: result.paidCount,
      totalCount: result.totalCount,
      recoveryExpiresAt: loaded.paymentSession.recoveryExpiresAt || null,
      whatsappShareEnabled:
        loaded.paymentSession.whatsappShareEnabled !== false,
      ...publicFinalOrderSummary(result),
      share: publicShare(
        {
          ...loaded.share,
          ...ensureObj(ownShare),
          shareUrl: loaded.share.shareUrl,
        },
        true,
      ),
      shares: resultShares.map((share: any) =>
        publicShare(share, Number(share?.index) === loaded.payload.shareIndex),
      ),
      actionRequired: ownShare?.status === "requires_action",
      actionUrl:
        ownShare?.status === "requires_action"
          ? shareActionUrl(resolveBaseUrl(req.url), loaded.token)
          : null,
      message: result.message || ownShare?.errorMessage || null,
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
  if (!hasTrustedMutationOrigin(req))
    return forbiddenResponse("origin_not_allowed");
  const rateError = await enforceRateLimit(
    req,
    "payments:share:mutation",
    24,
    10 * 60_000,
  );
  if (rateError) return rateError;

  const body = await req.json().catch(() => ({}) as any);
  const token = String(body?.token || "").trim();
  const action = String(body?.action || "start").toLowerCase();

  try {
    const settings = await getServerSettings().catch(() => ({}) as any);
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

    let loaded = await loadShare(token);
    const checked = await finalizePaymentSession(
      loaded.payload.paymentSessionId,
      req.url,
    );
    const checkedShare = (
      Array.isArray(checked.shares) ? checked.shares : []
    ).find((item: any) => Number(item?.index) === loaded.payload.shareIndex);

    if (isTerminalFinalizeFailure(checked)) {
      return json(
        {
          ok: false,
          error: checked.error || "PAYMENT_TERMINAL_FAILURE",
          message:
            checked.message ||
            "Diese Zahlung kann aus Sicherheitsgründen nicht fortgesetzt werden.",
        },
        409,
      );
    }

    if (action === "action_details") {
      loaded = await loadShare(token);
      const details = await retrieveAuthorizedPaymentAction({
        stripe: getStripeClient(),
        paymentIntentId: String(loaded.share.paymentIntentId || ""),
        paymentSessionId: loaded.payload.paymentSessionId,
        shareIndex: loaded.payload.shareIndex,
      });
      return json({
        ok: true,
        ...details,
        publishableKey: details.completed ? null : getStripePublishableKey(),
        returnUrl: `/pay/${encodeURIComponent(token)}`,
      });
    }

    if (checked.finalized || checkedShare?.status === "paid") {
      return json({
        ok: true,
        paid: true,
        finalized: checked.finalized,
        finalOrderId: checked.finalOrderId || null,
      });
    }
    if (["refunded", "expired"].includes(checked.status)) {
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

    loaded = await loadShare(token);
    const stripe = getStripeClient();

    if (action === "checkout" || action === "other_method") {
      await cancelPaymentIntentIfOpen(
        stripe,
        String(loaded.share.paymentIntentId || ""),
      );
      const rememberAllowed =
        settings?.payments?.online?.rememberPaymentMethods !== false;
      const created = await runClaimed(loaded, () =>
        createCheckoutAttempt({
          req,
          loaded,
          rememberPayment: rememberAllowed && body?.rememberPayment === true,
        }),
      );
      return json({
        ok: true,
        paid: created.nextShare.status === "paid",
        url: created.url,
      });
    }

    const storedIntentId = String(loaded.share.paymentIntentId || "").trim();
    if (storedIntentId) {
      try {
        const intent = await stripe.paymentIntents.retrieve(storedIntentId);
        if (intent.status === "succeeded") {
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
        if (intent.status === "requires_action") {
          return json({
            ok: true,
            paid: false,
            status: "requires_action",
            url: shareActionUrl(resolveBaseUrl(req.url), token),
          });
        }
        if (intent.status === "processing") {
          return json(
            {
              ok: false,
              error: "PAYMENT_PROCESSING",
              message: "Die Zahlung wird noch bestätigt.",
            },
            409,
          );
        }
      } catch {}
    }

    const storedCheckoutSessionId = String(
      loaded.share.checkoutSessionId || "",
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
          return json({ ok: true, paid: false, url: existing.url });
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
      } catch {}
    }

    const selectedPaymentMethodId = String(
      body?.savedPaymentMethodId || loaded.share.paymentMethodId || "",
    ).trim();
    if (selectedPaymentMethodId) {
      const direct = await runClaimed(loaded, () =>
        createSavedAttempt({
          req,
          loaded,
          paymentMethodId: selectedPaymentMethodId,
        }),
      );
      if (direct.nextShare.status === "paid") {
        const finalized = await finalizePaymentSession(
          loaded.payload.paymentSessionId,
          req.url,
        );
        return json({
          ok: true,
          paid: true,
          finalized: finalized.finalized,
          finalOrderId: finalized.finalOrderId || null,
          url: direct.url,
        });
      }
      return json(
        {
          ok: direct.nextShare.status !== "failed",
          paid: false,
          status: direct.nextShare.status,
          url: direct.url,
          message: direct.nextShare.errorMessage || null,
        },
        direct.nextShare.status === "failed" ? 402 : 200,
      );
    }

    const rememberAllowed =
      settings?.payments?.online?.rememberPaymentMethods !== false;
    const created = await runClaimed(loaded, () =>
      createCheckoutAttempt({
        req,
        loaded,
        rememberPayment: rememberAllowed && body?.rememberPayment === true,
      }),
    );
    return json({
      ok: true,
      paid: created.nextShare.status === "paid",
      url: created.url,
    });
  } catch (error: any) {
    console.error(
      "[payments/share]",
      String(error?.code || error?.type || "PAYMENT_SHARE_START_FAILED").slice(
        0,
        80,
      ),
    );
    const code = String(error?.message || "PAYMENT_SHARE_START_FAILED");
    const status =
      code === "PAYMENT_SHARE_TOKEN_INVALID" ||
      code === "PAYMENT_SHARE_TOKEN_REVOKED" ||
      code.includes("ACCESS")
        ? 403
        : code === "STRIPE_PAYMENT_METHOD_CUSTOMER_MISMATCH"
          ? 403
          : code === "PAYMENT_SESSION_NOT_FOUND" ||
              code === "PAYMENT_SHARE_NOT_FOUND"
            ? 404
            : code === "PAYMENT_AMOUNT_TOO_LOW" ||
                code === "SAVED_PAYMENT_METHOD_MISSING"
              ? 409
              : code === "PAYMENT_ACTION_NOT_REQUIRED" ||
                  code === "PAYMENT_MUTATION_IN_PROGRESS"
                ? 409
                : code === "STRIPE_SECRET_KEY_MISSING" ||
                    code === "STRIPE_PUBLISHABLE_KEY_MISSING"
                  ? 503
                  : 500;
    return json(
      {
        ok: false,
        error: code,
        message:
          status === 403
            ? "Dieser Zahlungslink ist ungültig oder abgelaufen."
            : status === 503
              ? "Stripe ist auf dem Server noch nicht vollständig eingerichtet."
              : code === "PAYMENT_MUTATION_IN_PROGRESS"
                ? "Eine Zahlungsaktion läuft bereits. Bitte kurz erneut versuchen."
                : code === "PAYMENT_AMOUNT_TOO_LOW"
                  ? "Dieser Zahlbetrag ist zu niedrig und wurde nicht belastet."
                  : code === "SAVED_PAYMENT_METHOD_MISSING"
                    ? "Die gespeicherte Zahlungsart ist nicht mehr verfügbar. Bitte eine andere Zahlungsart wählen."
                    : "Die Zahlung konnte nicht gestartet werden.",
      },
      status,
    );
  }
}
