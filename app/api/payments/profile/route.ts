import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import { getStripeClient } from "@/lib/server/stripe-client";
import {
  clearPaymentProfileCookie,
  resolvePaymentProfileCustomerId,
  setPaymentProfileCookie,
} from "@/lib/server/payment-profile";
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

    return NextResponse.json(
      {
        ok: true,
        remembered: Boolean(customerId),
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
      },
      {
        headers: NO_STORE_HEADERS,
      },
    );
  }
}

export async function POST(req: Request) {
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

    const stripeCustomerId = stripeCustomerIdFromSession(checkout);

    if (!stripeCustomerId) {
      return NextResponse.json(
        {
          ok: false,
          error: "STRIPE_CUSTOMER_MISSING",
        },
        {
          status: 400,
          headers: NO_STORE_HEADERS,
        },
      );
    }

    const phone = await paymentPhone({
      paymentSessionId,
      shareToken,
    });

    const response = NextResponse.json(
      {
        ok: true,
        remembered: true,
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

export async function DELETE() {
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
