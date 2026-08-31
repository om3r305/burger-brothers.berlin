import { NextResponse } from "next/server";
import {
  CHALLENGE_COOKIE_MAX_AGE,
  CUSTOMER_DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE,
  PHONE_CHALLENGE_COOKIE,
  challengeUsable,
  decodeChallenge,
  encodeChallenge,
  establishTrustedCustomer,
  identityCookieOptions,
  nextFailedChallenge,
  verifyOtpHash,
} from "@/lib/server/customer-identity";
import {
  enforceRateLimit,
  hasTrustedMutationOrigin,
  readRequestCookie,
} from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) return json({ ok: false, error: "origin_not_allowed" }, 403);
  const challenge = decodeChallenge(readRequestCookie(req, PHONE_CHALLENGE_COOKIE));
  if (!challenge || !challengeUsable(challenge)) {
    const response = json({ ok: false, error: "challenge_expired", message: "Der Code ist abgelaufen. Bitte fordere eine neue SMS an." }, 400);
    response.cookies.set(PHONE_CHALLENGE_COOKIE, "", { ...identityCookieOptions, maxAge: 0 });
    return response;
  }

  const limit = await enforceRateLimit(req, "customer-phone-confirm", 10, 15 * 60_000, challenge.phoneE164);
  if (limit) return limit;

  const body: any = await req.json().catch(() => ({}));
  const otp = String(body?.code || "").replace(/\D/g, "").slice(0, 6);
  if (otp.length !== 6 || !verifyOtpHash(challenge.phoneE164, otp, challenge.otpHash)) {
    const failed = nextFailedChallenge(challenge);
    const response = json({
      ok: false,
      error: "invalid_code",
      message: failed.attempts >= 5 ? "Zu viele falsche Versuche. Bitte fordere einen neuen Code an." : "Der Bestätigungscode ist nicht korrekt.",
      attemptsRemaining: Math.max(0, 5 - failed.attempts),
    }, 400);
    response.cookies.set(PHONE_CHALLENGE_COOKIE, encodeChallenge(failed), {
      ...identityCookieOptions,
      maxAge: Math.max(1, Math.ceil((failed.expiresAt - Date.now()) / 1000)),
    });
    return response;
  }

  const established = await establishTrustedCustomer({
    phoneE164: challenge.phoneE164,
    name: challenge.name,
    pendingAddress: challenge.pendingAddress,
  });

  const response = json({
    ok: true,
    phoneE164: established.customer.phone,
    name: established.customer.name,
    addresses: established.identity.savedAddresses,
  });
  response.cookies.set(CUSTOMER_DEVICE_COOKIE, established.rawDeviceToken, {
    ...identityCookieOptions,
    maxAge: DEVICE_COOKIE_MAX_AGE,
  });
  response.cookies.set(PHONE_CHALLENGE_COOKIE, "", {
    ...identityCookieOptions,
    maxAge: 0,
  });
  return response;
}
