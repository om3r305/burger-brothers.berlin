import { NextResponse } from "next/server";
import { finalizePaymentSession } from "@/lib/server/payment-finalize";
import { prisma, getTenantId } from "@/lib/db";
import { createBurgerCheckoutSession } from "@/lib/server/payment-checkout";
import { resolvePaymentProfileCustomerId } from "@/lib/server/payment-profile";
import {
  paymentRecoveryValueMatches,
  normalizePaymentRecoveryToken,
  buildPaymentManageUrl,
} from "@/lib/server/payment-recovery-token";
import { getStripeClient, resolveBaseUrl } from "@/lib/server/stripe-client";
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
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

async function loadRecoveryAccess(paymentSessionId: string, recoveryTokenRaw: string) {
  const tenantId = await getTenantId();
  const pending = await prisma.order.findFirst({
    where: { tenantId, id: paymentSessionId },
  });
  if (!pending) throw new Error("PAYMENT_SESSION_NOT_FOUND");

  const meta = ensureObj(pending.meta);
  const paymentSession = ensureObj(meta.paymentSession);
  const expectedHash = String(paymentSession.recoveryTokenHash || "");
  const recoveryToken = normalizePaymentRecoveryToken(recoveryTokenRaw);

  // Legacy sessions created before recovery tokens remain readable, but cannot
  // be mutated/resumed without a token.
  const protectedSession = Boolean(expectedHash);
  const validToken =
    protectedSession && recoveryToken
      ? paymentRecoveryValueMatches(recoveryToken, expectedHash)
      : !protectedSession;

  if (!validToken) throw new Error("PAYMENT_RECOVERY_TOKEN_INVALID");

  const expiresAtMs = Date.parse(String(paymentSession.recoveryExpiresAt || ""));
  const expired = Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();

  return { tenantId, pending, meta, paymentSession, recoveryToken, protectedSession, expired };
}

function publicResult(result: any, paymentSession: Record<string, any>) {
  return {
    ...result,
    order: undefined,
    whatsappShareEnabled: paymentSession?.whatsappShareEnabled !== false,
    recoveryExpiresAt: paymentSession?.recoveryExpiresAt || null,
    shares: (Array.isArray(result.shares) ? result.shares : []).map((share: any) => ({
      index: share.index,
      label: share.label,
      amount: share.amount,
      baseAmount: share.baseAmount,
      serviceFee: share.serviceFee,
      status: share.status,
      shareUrl: share.shareUrl || share.url || null,
      items: Array.isArray(share.items) ? share.items : [],
    })),
  };
}

async function expireOpenCheckoutSessions(paymentSession: Record<string, any>) {
  const shares = Array.isArray(paymentSession?.shares)
    ? paymentSession.shares
    : [];
  const ids = Array.from(
    new Set(
      shares
        .map((share: any) => String(share?.checkoutSessionId || "").trim())
        .filter(Boolean),
    ),
  );

  if (!ids.length) return;

  const stripe = getStripeClient();

  for (const checkoutSessionId of ids) {
    try {
      const checkout = await stripe.checkout.sessions.retrieve(checkoutSessionId);
      if (checkout.payment_status !== "paid" && checkout.status === "open") {
        await stripe.checkout.sessions.expire(checkoutSessionId);
      }
    } catch {
      // Missing/already terminal Stripe sessions do not block cancellation.
    }
  }
}

export async function GET(req: Request) {
  const rateError = await enforceRateLimit(req, "payments:session", 30, 60_000);
  if (rateError) return rateError;

  const url = new URL(req.url);
  const paymentSessionId = url.searchParams.get("id") || url.searchParams.get("paymentSession") || "";
  const recoveryToken = url.searchParams.get("recovery") || "";

  try {
    const loaded = await loadRecoveryAccess(paymentSessionId, recoveryToken);
    const result = await finalizePaymentSession(paymentSessionId, req.url);
    return json(publicResult(result, loaded.paymentSession), result.ok ? 200 : 400);
  } catch (error: any) {
    const code = String(error?.message || "PAYMENT_SESSION_FAILED");
    const status = code === "PAYMENT_RECOVERY_TOKEN_INVALID" ? 403 : code === "PAYMENT_SESSION_NOT_FOUND" ? 404 : 500;
    return json({
      ok: false,
      paymentSessionId,
      status: "failed",
      finalized: false,
      error: code,
      message: status === 403 ? "Dieser Zahlungszugriff ist ungültig oder abgelaufen." : "Zahlungssitzung konnte nicht geladen werden.",
    }, status);
  }
}

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) return forbiddenResponse("origin_not_allowed");
  const rateError = await enforceRateLimit(req, "payments:session:resume", 12, 5 * 60_000);
  if (rateError) return rateError;

  const body = await req.json().catch(() => ({} as any));
  const paymentSessionId = String(body?.paymentSessionId || body?.id || "").trim();
  const recoveryToken = String(body?.recoveryToken || body?.recovery || "").trim();
  const action = String(body?.action || "resume").toLowerCase();

  try {
    const loaded = await loadRecoveryAccess(paymentSessionId, recoveryToken);
    if (!loaded.protectedSession) throw new Error("PAYMENT_RECOVERY_TOKEN_REQUIRED");

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

      await expireOpenCheckoutSessions(loaded.paymentSession);

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
        ...publicResult(result, {
          ...loaded.paymentSession,
          state: "cancelled",
          cancelledAt,
        }),
        ok: true,
        cancelled: true,
        status: result.status === "refunded" ? "refunded" : "cancelled",
      });
    }

    const checked = await finalizePaymentSession(paymentSessionId, req.url);
    if (checked.finalized || ["failed", "refunded"].includes(checked.status)) {
      return json(publicResult(checked, loaded.paymentSession), checked.ok ? 200 : 409);
    }
    if (loaded.expired) {
      await expireOpenCheckoutSessions(loaded.paymentSession);
      const expired = await finalizePaymentSession(paymentSessionId, req.url);
      return json(
        {
          ...publicResult(expired, loaded.paymentSession),
          ok: false,
          status: expired.status === "refunded" ? "refunded" : "expired",
          error: "PAYMENT_RECOVERY_EXPIRED",
          message:
            expired.message ||
            "Die Frist zum Fortsetzen dieser Zahlung ist abgelaufen.",
        },
        410,
      );
    }

    if (String(loaded.paymentSession.kind || "online") === "split_contactless") {
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

    const shares = Array.isArray(loaded.paymentSession.shares) ? loaded.paymentSession.shares : [];
    const share = ensureObj(shares[0]);
    const stripe = getStripeClient();
    const storedCheckoutSessionId = String(share.checkoutSessionId || "").trim();

    if (storedCheckoutSessionId) {
      try {
        const existing = await stripe.checkout.sessions.retrieve(storedCheckoutSessionId);
        if (existing.payment_status === "paid") {
          const finalized = await finalizePaymentSession(paymentSessionId, req.url);
          return json(publicResult(finalized, loaded.paymentSession));
        }
        if (existing.status === "open" && existing.url) {
          return json({ ok: true, resumed: true, url: existing.url });
        }
        if (existing.status === "complete") {
          return json({ ok: false, status: "processing", message: "Die Zahlung wird noch bestätigt." }, 409);
        }
      } catch {
        // Missing/expired Stripe session: safely create another attempt for the same pending order.
      }
    }

    const pendingOrder = ensureObj(loaded.meta.pendingOrder);
    const customer = ensureObj(pendingOrder.customer);
    const rememberPayment = loaded.paymentSession.rememberPayment === true;
    const profileCustomerId = rememberPayment
      ? await resolvePaymentProfileCustomerId({ req, stripe, phone: String(customer.phone || "").replace(/\D/g, ""), requirePhoneMatch: Boolean(customer.phone) })
      : "";
    const baseUrl = resolveBaseUrl(req.url);
    const successUrl = new URL("/payment/return", baseUrl);
    successUrl.searchParams.set("paymentSession", paymentSessionId);
    successUrl.searchParams.set("recovery", recoveryToken);
    successUrl.searchParams.set("checkout_session_id", "{CHECKOUT_SESSION_ID}");
    const cancelUrl = new URL("/payment/return", baseUrl);
    cancelUrl.searchParams.set("payment", "cancelled");
    cancelUrl.searchParams.set("paymentSession", paymentSessionId);
    cancelUrl.searchParams.set("recovery", recoveryToken);

    const attempt = Math.max(1, Math.round(Number(share.attempt || 0)) + 1);
    const checkout = await createBurgerCheckoutSession({
      stripe,
      paymentSessionId,
      finalOrderId: String(loaded.paymentSession.finalOrderId || ""),
      paymentKind: "online",
      share: {
        index: Number(share.index || 0),
        label: String(share.label || "Online-Zahlung"),
        amountCents: Math.max(50, Math.round(Number(share.amount || loaded.paymentSession.total || 0) * 100)),
      },
      shareCount: 1,
      successUrl: successUrl.toString(),
      cancelUrl: cancelUrl.toString(),
      rememberPayment,
      customerId: profileCustomerId || undefined,
      customerEmail: profileCustomerId ? undefined : String(customer.email || ""),
      idempotencyKey: `bb-checkout-resume-${paymentSessionId}-${attempt}`,
      expiresAt: Math.floor(Date.parse(String(loaded.paymentSession.recoveryExpiresAt || "")) / 1000),
    });

    const nextShares = [{
      ...share,
      attempt,
      checkoutSessionId: checkout.id,
      paymentIntentId: typeof checkout.payment_intent === "string" ? checkout.payment_intent : checkout.payment_intent?.id || "",
      status: checkout.payment_status === "paid" ? "paid" : "open",
      url: checkout.url,
      checkoutUrl: checkout.url,
      startedAt: new Date().toISOString(),
    }];

    await prisma.order.update({
      where: { id: loaded.pending.id },
      data: {
        status: "payment_pending",
        meta: sanitizeJson({
          ...loaded.meta,
          paymentSession: {
            ...loaded.paymentSession,
            state: "waiting_payment",
            shares: nextShares,
            lastResumedAt: new Date().toISOString(),
          },
        }),
      },
    });

    return json({ ok: true, resumed: true, url: checkout.url });
  } catch (error: any) {
    const code = String(error?.message || "PAYMENT_RESUME_FAILED");
    const status = code.includes("TOKEN") ? 403 : code === "PAYMENT_SESSION_NOT_FOUND" ? 404 : 500;
    return json({ ok: false, error: code, message: status === 403 ? "Dieser Zahlungszugriff ist ungültig." : "Die Zahlung konnte nicht fortgesetzt werden." }, status);
  }
}
