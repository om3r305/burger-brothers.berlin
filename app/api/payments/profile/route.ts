import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { getStripeClient } from "@/lib/server/stripe-client";
import {
  clearPaymentProfileCookie,
  resolvePaymentProfileCustomerId,
  setPaymentProfileCookie,
} from "@/lib/server/payment-profile";
import {
  enforceRateLimit,
  forbiddenResponse,
  hasTrustedMutationOrigin,
} from "@/lib/server/request-security";
import {
  hashPaymentShareToken,
  verifyPaymentShareToken,
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

function normalizePhone(value: any) {
  return String(value || "").replace(/\D/g, "");
}

function stripeCustomerIdFromSession(session: any) {
  if (typeof session?.customer === "string") return session.customer;
  if (session?.customer && typeof session.customer === "object") {
    return String(session.customer.id || "");
  }

  return "";
}

function stripePaymentMethodIdFromSession(session: any) {
  const paymentIntent = session?.payment_intent;

  if (paymentIntent && typeof paymentIntent === "object") {
    const paymentMethod = paymentIntent.payment_method;

    if (typeof paymentMethod === "string") return paymentMethod;
    if (paymentMethod && typeof paymentMethod === "object") {
      return String(paymentMethod.id || "");
    }
  }

  return "";
}

async function ensureReusablePaymentMethod(params: {
  stripe: ReturnType<typeof getStripeClient>;
  checkout: any;
}) {
  let customerId = stripeCustomerIdFromSession(params.checkout);
  const paymentMethodId = stripePaymentMethodIdFromSession(params.checkout);

  if (!paymentMethodId) {
    throw new Error("STRIPE_PAYMENT_METHOD_MISSING");
  }

  if (!customerId) {
    const details = ensureObj(params.checkout?.customer_details);
    const customer = await params.stripe.customers.create({
      ...(String(details?.email || "").trim()
        ? { email: String(details.email).trim() }
        : {}),
      ...(String(details?.name || "").trim()
        ? { name: String(details.name).trim() }
        : {}),
      metadata: {
        burger_payment_session: String(
          params.checkout?.metadata?.burger_payment_session || "",
        ),
      },
    });

    customerId = customer.id;
  }

  const paymentMethod = await params.stripe.paymentMethods.retrieve(
    paymentMethodId,
  );
  const attachedCustomer =
    typeof paymentMethod.customer === "string"
      ? paymentMethod.customer
      : paymentMethod.customer?.id || "";

  if (!attachedCustomer) {
    await params.stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
  } else if (attachedCustomer !== customerId) {
    throw new Error("STRIPE_PAYMENT_METHOD_CUSTOMER_MISMATCH");
  }

  /*
   * Kartlarda varsayılan yöntemi açıkça ayarlamak, sonraki Checkout
   * oturumunda Stripe'ın kayıtlı kartı öne çıkarmasını sağlar. PayPal/Link
   * için Stripe destekliyorsa bağlı yöntem yine Customer altında kalır.
   */
  if (String(paymentMethod.type || "") === "card") {
    await params.stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  return {
    stripeCustomerId: customerId,
    paymentMethodId,
  };
}


function maskEmail(value: any) {
  const email = String(value || "").trim();
  const at = email.indexOf("@");

  if (at <= 0) return "";

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const domainDot = domain.lastIndexOf(".");
  const domainName = domainDot > 0 ? domain.slice(0, domainDot) : domain;
  const suffix = domainDot > 0 ? domain.slice(domainDot) : "";

  const maskedLocal =
    local.length <= 2
      ? `${local.slice(0, 1)}***`
      : `${local.slice(0, 2)}***`;
  const maskedDomain =
    domainName.length <= 2
      ? `${domainName.slice(0, 1)}***`
      : `${domainName.slice(0, 2)}***`;

  return `${maskedLocal}@${maskedDomain}${suffix}`;
}

function savedMethodLabel(paymentMethod: any) {
  const type = String(paymentMethod?.type || "").toLowerCase();

  if (type === "card") {
    const brand = String(paymentMethod?.card?.brand || "Karte");
    const last4 = String(paymentMethod?.card?.last4 || "");
    return {
      type: "card",
      label: `${brand.charAt(0).toUpperCase()}${brand.slice(1)}${
        last4 ? ` •••• ${last4}` : ""
      }`,
    };
  }

  if (type === "paypal") {
    const email = maskEmail(
      paymentMethod?.paypal?.payer_email ||
        paymentMethod?.billing_details?.email,
    );

    return {
      type: "paypal",
      label: email ? `PayPal • ${email}` : "PayPal",
    };
  }

  if (type === "link") {
    const email = maskEmail(
      paymentMethod?.link?.email ||
        paymentMethod?.billing_details?.email,
    );

    return {
      type: "link",
      label: email ? `Link • ${email}` : "Link",
    };
  }

  return {
    type: type || "payment_method",
    label: "Gespeicherte Zahlungsart",
  };
}

async function listSavedPaymentMethods(params: {
  stripe: ReturnType<typeof getStripeClient>;
  customerId: string;
}) {
  const supportedTypes = ["card", "paypal", "link"] as const;
  const methods: Array<{ id: string; type: string; label: string }> = [];

  for (const type of supportedTypes) {
    try {
      const list = await params.stripe.paymentMethods.list({
        customer: params.customerId,
        type: type as any,
        limit: 5,
      });

      for (const paymentMethod of list.data || []) {
        const presentation = savedMethodLabel(paymentMethod);

        methods.push({
          id: String(paymentMethod.id || ""),
          type: presentation.type,
          label: presentation.label,
        });
      }
    } catch {
      /* Some Stripe accounts/API versions may not expose every wallet type. */
    }
  }

  return methods
    .filter((item) => item.id && item.label)
    .slice(0, 6);
}

async function paymentPhone(params: {
  paymentSessionId: string;
  shareToken?: string;
}) {
  const tenantId = await getTenantId();
  const pending = await prisma.order.findFirst({
    where: {
      tenantId,
      id: params.paymentSessionId,
    },
    select: {
      customer: true,
      meta: true,
    },
  });

  if (!pending) return "";

  const shareToken = String(params.shareToken || "").trim();

  /* Split katılımcısına siparişi veren kişinin telefonu bağlanmaz. */
  if (shareToken) {
    const payload = verifyPaymentShareToken(shareToken);
    if (!payload) return "";

    const paymentSession = ensureObj(ensureObj(pending.meta).paymentSession);
    const shares = Array.isArray(paymentSession.shares)
      ? paymentSession.shares
      : [];
    const share = shares.find(
      (item: any) => Number(item?.index) === payload.shareIndex,
    );

    if (
      !share ||
      String(share?.shareTokenHash || "") !==
        hashPaymentShareToken(shareToken)
    ) {
      return "";
    }

    return "";
  }

  return normalizePhone(ensureObj(pending.customer)?.phone);
}

export async function GET(req: Request) {
  try {
    const stripe = getStripeClient();
    const customerId = await resolvePaymentProfileCustomerId({
      req,
      stripe,
    });
    const methods = customerId
      ? await listSavedPaymentMethods({
          stripe,
          customerId,
        })
      : [];

    return NextResponse.json(
      {
        ok: true,
        remembered: Boolean(customerId),
        methods,
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  } catch {
    return NextResponse.json(
      {
        ok: true,
        remembered: false,
        methods: [],
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  }
}

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

  const rateError = await enforceRateLimit(
    req,
    "payments:profile:save",
    20,
    10 * 60_000,
  );
  if (rateError) return rateError;

  const body = await req.json().catch(() => ({} as any));
  const checkoutSessionId = String(body?.checkoutSessionId || "").trim();
  const paymentSessionId = String(body?.paymentSessionId || "").trim();
  const shareToken = String(body?.shareToken || "").trim();

  if (!checkoutSessionId || !paymentSessionId) {
    return NextResponse.json(
      {
        ok: false,
        error: "PAYMENT_PROFILE_DATA_MISSING",
      },
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      },
    );
  }

  try {
    const stripe = getStripeClient();
    const checkout = await stripe.checkout.sessions.retrieve(
      checkoutSessionId,
      {
        expand: ["payment_intent.payment_method"],
      },
    );
    const metadataPaymentSessionId = String(
      checkout?.metadata?.burger_payment_session || "",
    ).trim();

    if (
      metadataPaymentSessionId !== paymentSessionId ||
      checkout.payment_status !== "paid"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "PAYMENT_PROFILE_SESSION_INVALID",
        },
        {
          status: 403,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    if (String(checkout?.metadata?.remember_payment || "") !== "1") {
      return NextResponse.json(
        {
          ok: true,
          remembered: false,
          skipped: "CONSENT_NOT_GIVEN",
        },
        {
          headers: NO_STORE_HEADERS,
        },
      );
    }

    if (shareToken) {
      const payload = verifyPaymentShareToken(shareToken);

      if (
        !payload ||
        payload.paymentSessionId !== paymentSessionId ||
        Number(checkout?.metadata?.share_index) !== payload.shareIndex
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: "PAYMENT_SHARE_TOKEN_INVALID",
          },
          {
            status: 403,
            headers: NO_STORE_HEADERS,
          },
        );
      }

      const tenantId = await getTenantId();
      const pending = await prisma.order.findFirst({
        where: {
          tenantId,
          id: paymentSessionId,
        },
        select: {
          meta: true,
        },
      });
      const paymentSession = ensureObj(
        ensureObj(pending?.meta).paymentSession,
      );
      const shares = Array.isArray(paymentSession.shares)
        ? paymentSession.shares
        : [];
      const share = shares.find(
        (item: any) => Number(item?.index) === payload.shareIndex,
      );

      if (
        !share ||
        String(share?.shareTokenHash || "") !==
          hashPaymentShareToken(shareToken)
      ) {
        return NextResponse.json(
          {
            ok: false,
            error: "PAYMENT_SHARE_TOKEN_REVOKED",
          },
          {
            status: 403,
            headers: NO_STORE_HEADERS,
          },
        );
      }
    }

    const reusableMethod = await ensureReusablePaymentMethod({
      stripe,
      checkout,
    });
    const stripeCustomerId = reusableMethod.stripeCustomerId;

    const phone = await paymentPhone({
      paymentSessionId,
      shareToken,
    });

    const response = NextResponse.json(
      {
        ok: true,
        remembered: true,
        paymentMethodId: reusableMethod.paymentMethodId,
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );

    return setPaymentProfileCookie({
      response,
      stripeCustomerId,
      phone,
    });
  } catch (error: any) {
    console.error("[payments/profile]", error);

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "PAYMENT_PROFILE_SAVE_FAILED",
      },
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}

export async function DELETE(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return forbiddenResponse("origin_not_allowed");
  }

  const rateError = await enforceRateLimit(
    req,
    "payments:profile:delete",
    30,
    10 * 60_000,
  );
  if (rateError) return rateError;

  const response = NextResponse.json(
    {
      ok: true,
      remembered: false,
    },
    {
      headers: NO_STORE_HEADERS,
    },
  );

  return clearPaymentProfileCookie(response);
}
