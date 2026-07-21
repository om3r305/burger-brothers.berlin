import { NextResponse } from "next/server";
import { finalizePaymentSession } from "@/lib/server/payment-finalize";
import { prisma, getTenantId } from "@/lib/db";
import { createBurgerCheckoutSession } from "@/lib/server/payment-checkout";
import {
  cancelPaymentIntentIfOpen,
  createAndConfirmSavedPayment,
  retrieveAuthorizedPaymentAction,
} from "@/lib/server/payment-intent";
import { resolvePaymentProfileCustomerId } from "@/lib/server/payment-profile";
import { withPaymentMutationClaim } from "@/lib/server/payment-mutation-lock";
import {
  paymentRecoveryValueMatches,
  normalizePaymentRecoveryToken,
  buildPaymentManageUrl,
} from "@/lib/server/payment-recovery-token";
import {
  getStripeClient,
  getStripePublishableKey,
  resolveBaseUrl,
} from "@/lib/server/stripe-client";
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

async function loadRecoveryAccess(
  paymentSessionId: string,
  recoveryTokenRaw: string,
) {
  const tenantId = await getTenantId();
  const pending = await prisma.order.findFirst({
    where: { tenantId, id: paymentSessionId },
  });
  if (!pending) throw new Error("PAYMENT_SESSION_NOT_FOUND");

  const meta = ensureObj(pending.meta);
  const paymentSession = ensureObj(meta.paymentSession);
  const expectedHash = String(paymentSession.recoveryTokenHash || "");
  const recoveryToken = normalizePaymentRecoveryToken(recoveryTokenRaw);
  const protectedSession = Boolean(expectedHash);
  const validToken =
    protectedSession && recoveryToken
      ? paymentRecoveryValueMatches(recoveryToken, expectedHash)
      : !protectedSession;

  if (!validToken) throw new Error("PAYMENT_RECOVERY_TOKEN_INVALID");

  const expiresAtMs = Date.parse(
    String(paymentSession.recoveryExpiresAt || ""),
  );
  const expired = Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();

  return {
    tenantId,
    pending,
    meta,
    paymentSession,
    recoveryToken,
    protectedSession,
    expired,
  };
}

function numberOrNull(value: any) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function publicResult(result: any, paymentSession: Record<string, any>) {
  const order = ensureObj(result?.order);
  const orderMeta = ensureObj(order?.meta);
  const trackingToken =
    String(result?.trackingToken || "").trim() ||
    readOrderTrackingToken(order) ||
    "";
  const planned =
    String(
      order?.planned ?? orderMeta?.planned ?? orderMeta?.plannedTime ?? "",
    ).trim() || null;
  const etaMin = numberOrNull(
    order?.etaMin ?? orderMeta?.etaMin ?? orderMeta?.suggestedEtaMin,
  );
  const etaAdjustMin =
    numberOrNull(order?.etaAdjustMin ?? orderMeta?.etaAdjustMin) ?? 0;
  const shares = Array.isArray(result?.shares) ? result.shares : [];
  const firstShare = ensureObj(shares[0]);

  return {
    ...result,
    trackingToken: trackingToken || null,
    mode: String(order?.mode || "").trim() || null,
    planned,
    etaMin,
    etaAdjustMin,
    order: undefined,
    recoveryExpiresAt: paymentSession?.recoveryExpiresAt || null,
    whatsappShareEnabled: paymentSession?.whatsappShareEnabled !== false,
    actionRequired: firstShare.status === "requires_action",
    actionUrl:
      firstShare.status === "requires_action" ? firstShare.url || null : null,
    paymentMethodType: firstShare.paymentMethodType || null,
    paymentError:
      firstShare.errorMessage || paymentSession?.errorMessage || null,
    shares: shares.map((share: any) => ({
      index: share.index,
      label: share.label,
      amount: share.amount,
      baseAmount: share.baseAmount,
      serviceFee: share.serviceFee,
      status: share.status,
      paymentMethodType: share.paymentMethodType || null,
      shareUrl: share.shareUrl || null,
      items: Array.isArray(share.items) ? share.items : [],
    })),
  };
}

function actionUrl(params: {
  baseUrl: string;
  paymentSessionId: string;
  recoveryToken: string;
  shareIndex: number;
}) {
  const url = new URL("/payment/action", params.baseUrl);
  url.searchParams.set("paymentSession", params.paymentSessionId);
  url.searchParams.set("recovery", params.recoveryToken);
  url.searchParams.set("share", String(params.shareIndex));
  url.searchParams.set("returnTo", "center");
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

async function expireOpenStripeResources(paymentSession: Record<string, any>) {
  const shares = Array.isArray(paymentSession?.shares)
    ? paymentSession.shares
    : [];
  if (!shares.length) return { allClosed: true };
  const stripe = getStripeClient();
  let allClosed = true;

  for (const raw of shares) {
    const share = ensureObj(raw);
    const checkoutSessionId = String(share.checkoutSessionId || "").trim();
    if (checkoutSessionId) {
      try {
        let checkout =
          await stripe.checkout.sessions.retrieve(checkoutSessionId);
        if (checkout.payment_status !== "paid" && checkout.status === "open") {
          try {
            checkout = await stripe.checkout.sessions.expire(checkoutSessionId);
          } catch {
            checkout =
              await stripe.checkout.sessions.retrieve(checkoutSessionId);
          }
        }
        if (checkout.payment_status !== "paid" && checkout.status === "open") {
          allClosed = false;
        }
        if (
          checkout.payment_status !== "paid" &&
          checkout.status === "complete"
        ) {
          allClosed = false;
        }
      } catch {
        allClosed = false;
      }
    }

    const paymentIntentId = String(share.paymentIntentId || "").trim();
    if (paymentIntentId) {
      await cancelPaymentIntentIfOpen(stripe, paymentIntentId);
      try {
        const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
        if (
          !["succeeded", "canceled"].includes(intent.status)
        ) {
          allClosed = false;
        }
      } catch {
        allClosed = false;
      }
    }
  }

  return { allClosed };
}

async function updateSingleShare(params: {
  loaded: Awaited<ReturnType<typeof loadRecoveryAccess>>;
  share: Record<string, any>;
  nextShare: Record<string, any>;
  state?: string;
}) {
  const shares = Array.isArray(params.loaded.paymentSession.shares)
    ? params.loaded.paymentSession.shares
    : [];
  const index = Number(params.share.index || 0);
  const nextShares = shares.map((item: any) =>
    Number(item?.index || 0) === index ? params.nextShare : item,
  );

  await prisma.order.update({
    where: { id: params.loaded.pending.id },
    data: {
      status: "payment_pending",
      meta: sanitizeJson({
        ...params.loaded.meta,
        paymentSession: {
          ...params.loaded.paymentSession,
          state: params.state || "waiting_payment",
          shares: nextShares,
          lastResumedAt: new Date().toISOString(),
        },
      }),
    },
  });
}

async function createCheckoutAttempt(params: {
  req: Request;
  loaded: Awaited<ReturnType<typeof loadRecoveryAccess>>;
  paymentSessionId: string;
  recoveryToken: string;
  share: Record<string, any>;
}) {
  const stripe = getStripeClient();
  const pendingOrder = ensureObj(params.loaded.meta.pendingOrder);
  const customer = ensureObj(pendingOrder.customer);
  const profileCustomerId = await resolvePaymentProfileCustomerId({
    req: params.req,
    stripe,
    phone: String(customer.phone || "").replace(/\D/g, ""),
    requirePhoneMatch: false,
  });
  const baseUrl = resolveBaseUrl(params.req.url);
  const successUrl = new URL("/payment/center", baseUrl);
  successUrl.searchParams.set("paymentSession", params.paymentSessionId);
  successUrl.searchParams.set("recovery", params.recoveryToken);
  const successUrlWithCheckoutSession = `${successUrl.toString()}&checkout_session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = new URL("/payment/center", baseUrl);
  cancelUrl.searchParams.set("payment", "cancelled");
  cancelUrl.searchParams.set("paymentSession", params.paymentSessionId);
  cancelUrl.searchParams.set("recovery", params.recoveryToken);
  const attempt = Math.max(
    1,
    Math.round(Number(params.share.attempt || 0)) + 1,
  );

  const checkout = await createBurgerCheckoutSession({
    stripe,
    paymentSessionId: params.paymentSessionId,
    finalOrderId: String(params.loaded.paymentSession.finalOrderId || ""),
    paymentKind: "online",
    share: {
      index: Number(params.share.index || 0),
      label: String(params.share.label || "Online-Zahlung"),
      amountCents: Math.round(
        Number(params.share.amount || params.loaded.paymentSession.total || 0) *
          100,
      ),
    },
    shareCount: 1,
    successUrl: successUrlWithCheckoutSession,
    cancelUrl: cancelUrl.toString(),
    rememberPayment: params.loaded.paymentSession.rememberPayment === true,
    customerId: profileCustomerId || undefined,
    customerEmail: profileCustomerId ? undefined : String(customer.email || ""),
    idempotencyKey: `bb-checkout-resume-${params.paymentSessionId}-${attempt}`,
    expiresAt: Math.floor(
      Date.parse(String(params.loaded.paymentSession.recoveryExpiresAt || "")) /
        1000,
    ),
  });

  const nextShare = {
    ...params.share,
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
    url: checkout.url,
    checkoutUrl: checkout.url,
    actionUrl: null,
    errorCode: null,
    errorMessage: null,
    startedAt: new Date().toISOString(),
  };
  await updateSingleShare({
    loaded: params.loaded,
    share: params.share,
    nextShare,
  });
  return { url: checkout.url, nextShare };
}

async function createSavedAttempt(params: {
  req: Request;
  loaded: Awaited<ReturnType<typeof loadRecoveryAccess>>;
  paymentSessionId: string;
  recoveryToken: string;
  share: Record<string, any>;
}) {
  const stripe = getStripeClient();
  const pendingOrder = ensureObj(params.loaded.meta.pendingOrder);
  const customer = ensureObj(pendingOrder.customer);
  const profileCustomerId = await resolvePaymentProfileCustomerId({
    req: params.req,
    stripe,
    phone: String(customer.phone || "").replace(/\D/g, ""),
    requirePhoneMatch: false,
  });
  const paymentMethodId = String(params.share.paymentMethodId || "").trim();
  if (!profileCustomerId || !paymentMethodId) {
    throw new Error("SAVED_PAYMENT_METHOD_MISSING");
  }

  const attempt = Math.max(
    1,
    Math.round(Number(params.share.attempt || 0)) + 1,
  );
  const nextActionUrl = actionUrl({
    baseUrl: resolveBaseUrl(params.req.url),
    paymentSessionId: params.paymentSessionId,
    recoveryToken: params.recoveryToken,
    shareIndex: Number(params.share.index || 0),
  });
  const direct = await createAndConfirmSavedPayment({
    stripe,
    paymentSessionId: params.paymentSessionId,
    finalOrderId: String(params.loaded.paymentSession.finalOrderId || ""),
    paymentKind: "online",
    shareIndex: Number(params.share.index || 0),
    shareCount: 1,
    amountCents: Math.round(Number(params.share.amount || 0) * 100),
    customerId: profileCustomerId,
    paymentMethodId,
    returnUrl: nextActionUrl,
    idempotencyKey: `bb-saved-payment-${params.paymentSessionId}-${Number(params.share.index || 0)}-${attempt}`,
  });
  const manageUrl = buildPaymentManageUrl({
    baseUrl: resolveBaseUrl(params.req.url),
    paymentSessionId: params.paymentSessionId,
    recoveryToken: params.recoveryToken,
  });
  const nextShare = {
    ...params.share,
    attempt,
    flow: "saved_payment",
    checkoutSessionId: "",
    paymentIntentId: direct.paymentIntentId,
    paymentMethodId: direct.paymentMethodId,
    paymentMethodType: direct.paymentMethodType,
    stripeCustomerId: direct.stripeCustomerId,
    status: direct.status,
    stripeStatus: direct.stripeStatus,
    url: direct.status === "requires_action" ? nextActionUrl : manageUrl,
    actionUrl: direct.status === "requires_action" ? nextActionUrl : null,
    checkoutUrl: null,
    errorCode: direct.errorCode || null,
    errorMessage: direct.errorMessage || null,
    startedAt: new Date().toISOString(),
  };
  await updateSingleShare({
    loaded: params.loaded,
    share: params.share,
    nextShare,
  });
  return { url: nextShare.url, nextShare };
}

async function runClaimed<T>(
  loaded: Awaited<ReturnType<typeof loadRecoveryAccess>>,
  paymentSessionId: string,
  run: () => Promise<T>,
) {
  return withPaymentMutationClaim({
    tenantId: loaded.tenantId,
    paymentSessionId,
    run,
  });
}

export async function GET(req: Request) {
  const rateError = await enforceRateLimit(req, "payments:session", 30, 60_000);
  if (rateError) return rateError;

  const url = new URL(req.url);
  const paymentSessionId =
    url.searchParams.get("id") || url.searchParams.get("paymentSession") || "";
  const recoveryToken = url.searchParams.get("recovery") || "";

  try {
    const loaded = await loadRecoveryAccess(paymentSessionId, recoveryToken);
    const result = await finalizePaymentSession(paymentSessionId, req.url);
    return json(
      publicResult(result, loaded.paymentSession),
      result.ok ? 200 : 400,
    );
  } catch (error: any) {
    const code = String(error?.message || "PAYMENT_SESSION_FAILED");
    const status =
      code === "PAYMENT_RECOVERY_TOKEN_INVALID"
        ? 403
        : code === "PAYMENT_SESSION_NOT_FOUND"
          ? 404
          : 500;
    return json(
      {
        ok: false,
        paymentSessionId,
        status: "failed",
        finalized: false,
        error: code,
        message:
          status === 403
            ? "Dieser Zahlungszugriff ist ungültig oder abgelaufen."
            : "Zahlungssitzung konnte nicht geladen werden.",
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
    "payments:session:mutation",
    16,
    5 * 60_000,
  );
  if (rateError) return rateError;

  const body = await req.json().catch(() => ({}) as any);
  const paymentSessionId = String(
    body?.paymentSessionId || body?.id || "",
  ).trim();
  const recoveryToken = String(
    body?.recoveryToken || body?.recovery || "",
  ).trim();
  const action = String(body?.action || "resume").toLowerCase();

  try {
    let loaded = await loadRecoveryAccess(paymentSessionId, recoveryToken);
    if (!loaded.protectedSession)
      throw new Error("PAYMENT_RECOVERY_TOKEN_REQUIRED");

    if (action === "cancel") {
      const checkedBeforeCancel = await finalizePaymentSession(
        paymentSessionId,
        req.url,
      );
      if (checkedBeforeCancel.finalized) {
        return json(
          publicResult(checkedBeforeCancel, loaded.paymentSession),
          409,
        );
      }
      const closed = await expireOpenStripeResources(loaded.paymentSession);
      const checkedAfterClose = await finalizePaymentSession(
        paymentSessionId,
        req.url,
      );
      if (checkedAfterClose.finalized) {
        return json(
          publicResult(checkedAfterClose, loaded.paymentSession),
          409,
        );
      }
      if (!closed.allClosed) {
        return json(
          {
            ...publicResult(checkedAfterClose, loaded.paymentSession),
            ok: false,
            cancelled: false,
            error: "PAYMENT_TERMINATION_PENDING",
            message:
              "Die Zahlung wird noch sicher beendet. Der Checkout bleibt bis zur Stripe-Bestätigung gesperrt.",
          },
          409,
        );
      }
      const cancelledAt = new Date().toISOString();
      await prisma.order.update({
        where: { id: loaded.pending.id },
        data: {
          status: "payment_cancelled",
          meta: sanitizeJson({
            ...loaded.meta,
            paymentSession: {
              ...loaded.paymentSession,
              state: "cancelled",
              cancelledAt,
            },
          }),
        },
      });
      const result = await finalizePaymentSession(paymentSessionId, req.url);
      return json({
        ...publicResult(result, { ...loaded.paymentSession, cancelledAt }),
        ok: true,
        cancelled: true,
        status: result.status === "refunded" ? "refunded" : "cancelled",
      });
    }

    const checked = await finalizePaymentSession(paymentSessionId, req.url);
    if (isTerminalFinalizeFailure(checked)) {
      return json(publicResult(checked, loaded.paymentSession), 409);
    }
    if (action === "action_details") {
      loaded = await loadRecoveryAccess(paymentSessionId, recoveryToken);
      if (String(loaded.paymentSession.kind || "online") !== "online") {
        throw new Error("PAYMENT_ACTION_ACCESS_MISMATCH");
      }
      const actionShares = Array.isArray(loaded.paymentSession.shares)
        ? loaded.paymentSession.shares
        : [];
      const actionShare = ensureObj(actionShares[0]);
      const details = await retrieveAuthorizedPaymentAction({
        stripe: getStripeClient(),
        paymentIntentId: String(actionShare.paymentIntentId || ""),
        paymentSessionId,
        shareIndex: Number(actionShare.index || 0),
      });
      return json({
        ok: true,
        ...details,
        publishableKey: details.completed ? null : getStripePublishableKey(),
        returnUrl: buildPaymentManageUrl({
          baseUrl: resolveBaseUrl(req.url),
          paymentSessionId,
          recoveryToken,
        }),
      });
    }
    if (checked.finalized || checked.status === "refunded") {
      return json(
        publicResult(checked, loaded.paymentSession),
        checked.ok ? 200 : 409,
      );
    }
    if (loaded.expired) {
      await expireOpenStripeResources(loaded.paymentSession);
      const expired = await finalizePaymentSession(paymentSessionId, req.url);
      if (["pending", "processing", "paid"].includes(expired.status)) {
        return json(
          {
            ...publicResult(expired, loaded.paymentSession),
            ok: false,
            status: expired.status,
            error: "PAYMENT_TERMINATION_PENDING",
            message:
              expired.message ||
              "Die Zahlung wird noch sicher beendet. Bitte diese Seite geöffnet lassen.",
          },
          409,
        );
      }
      return json(
        {
          ...publicResult(expired, loaded.paymentSession),
          ok: false,
          status:
            expired.status === "refunded"
              ? "refunded"
              : expired.status === "failed"
                ? "failed"
                : "expired",
          error: "PAYMENT_RECOVERY_EXPIRED",
          message:
            expired.message ||
            "Die Frist zum Fortsetzen dieser Zahlung ist abgelaufen.",
        },
        410,
      );
    }

    if (
      String(loaded.paymentSession.kind || "online") === "split_contactless"
    ) {
      return json({
        ...publicResult(checked, loaded.paymentSession),
        manageUrl: buildPaymentManageUrl({
          baseUrl: resolveBaseUrl(req.url),
          paymentSessionId,
          recoveryToken,
          split: true,
        }),
      });
    }

    loaded = await loadRecoveryAccess(paymentSessionId, recoveryToken);
    const shares = Array.isArray(loaded.paymentSession.shares)
      ? loaded.paymentSession.shares
      : [];
    const share = ensureObj(shares[0]);
    const stripe = getStripeClient();

    if (action === "checkout" || action === "other_method") {
      await cancelPaymentIntentIfOpen(
        stripe,
        String(share.paymentIntentId || ""),
      );
      const created = await runClaimed(loaded, paymentSessionId, () =>
        createCheckoutAttempt({
          req,
          loaded,
          paymentSessionId,
          recoveryToken,
          share,
        }),
      );
      return json({ ok: true, resumed: true, url: created.url });
    }

    if (action === "retry_saved") {
      const created = await runClaimed(loaded, paymentSessionId, () =>
        createSavedAttempt({
          req,
          loaded,
          paymentSessionId,
          recoveryToken,
          share,
        }),
      );
      if (created.nextShare.status === "paid") {
        const finalized = await finalizePaymentSession(
          paymentSessionId,
          req.url,
        );
        return json({
          ...publicResult(finalized, loaded.paymentSession),
          url: created.url,
        });
      }
      return json(
        {
          ok: created.nextShare.status !== "failed",
          resumed: true,
          status: created.nextShare.status,
          url: created.url,
          message: created.nextShare.errorMessage || null,
        },
        created.nextShare.status === "failed" ? 402 : 200,
      );
    }

    const storedPaymentIntentId = String(share.paymentIntentId || "").trim();
    if (storedPaymentIntentId) {
      try {
        const intent = await stripe.paymentIntents.retrieve(
          storedPaymentIntentId,
        );
        if (intent.status === "succeeded") {
          const finalized = await finalizePaymentSession(
            paymentSessionId,
            req.url,
          );
          return json(publicResult(finalized, loaded.paymentSession));
        }
        if (intent.status === "requires_action") {
          return json({
            ok: true,
            resumed: true,
            status: "requires_action",
            url: actionUrl({
              baseUrl: resolveBaseUrl(req.url),
              paymentSessionId,
              recoveryToken,
              shareIndex: Number(share.index || 0),
            }),
          });
        }
        if (intent.status === "processing") {
          return json(
            {
              ok: false,
              status: "processing",
              message: "Die Zahlung wird noch bestätigt.",
            },
            409,
          );
        }
      } catch {}
    }

    const storedCheckoutSessionId = String(
      share.checkoutSessionId || "",
    ).trim();
    if (storedCheckoutSessionId) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(
          storedCheckoutSessionId,
        );
        if (existing.payment_status === "paid") {
          const finalized = await finalizePaymentSession(
            paymentSessionId,
            req.url,
          );
          return json(publicResult(finalized, loaded.paymentSession));
        }
        if (existing.status === "open" && existing.url) {
          return json({ ok: true, resumed: true, url: existing.url });
        }
        if (existing.status === "complete") {
          return json(
            {
              ok: false,
              status: "processing",
              message: "Die Zahlung wird noch bestätigt.",
            },
            409,
          );
        }
      } catch {}
    }

    if (share.flow === "saved_payment" && share.paymentMethodId) {
      return json(
        {
          ok: false,
          status: "failed",
          retrySavedAvailable: true,
          otherMethodAvailable: true,
          message:
            share.errorMessage ||
            "Die gespeicherte Zahlungsart konnte nicht belastet werden.",
        },
        402,
      );
    }

    const created = await runClaimed(loaded, paymentSessionId, () =>
      createCheckoutAttempt({
        req,
        loaded,
        paymentSessionId,
        recoveryToken,
        share,
      }),
    );
    return json({ ok: true, resumed: true, url: created.url });
  } catch (error: any) {
    const code = String(error?.message || "PAYMENT_RESUME_FAILED");
    const status =
      code.includes("TOKEN") || code.includes("ACCESS")
        ? 403
        : code === "PAYMENT_SESSION_NOT_FOUND"
          ? 404
          : code === "PAYMENT_AMOUNT_TOO_LOW" ||
              code === "SAVED_PAYMENT_METHOD_MISSING"
            ? 409
            : code === "STRIPE_PAYMENT_METHOD_CUSTOMER_MISMATCH"
              ? 403
              : code === "PAYMENT_ACTION_NOT_REQUIRED" ||
                  code === "PAYMENT_MUTATION_IN_PROGRESS"
                ? 409
                : 500;
    return json(
      {
        ok: false,
        error: code,
        message:
          status === 403
            ? "Dieser Zahlungszugriff ist ungültig."
            : code === "PAYMENT_MUTATION_IN_PROGRESS"
              ? "Eine Zahlungsaktion läuft bereits. Bitte kurz erneut versuchen."
              : code === "PAYMENT_AMOUNT_TOO_LOW"
                ? "Dieser Zahlbetrag ist zu niedrig und wurde nicht belastet."
                : code === "SAVED_PAYMENT_METHOD_MISSING"
                  ? "Die gespeicherte Zahlungsart ist nicht mehr verfügbar. Bitte eine andere Zahlungsart wählen."
                  : "Die Zahlung konnte nicht fortgesetzt werden.",
      },
      status,
    );
  }
}
