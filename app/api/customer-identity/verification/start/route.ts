import { NextResponse } from "next/server";
import {
  CHALLENGE_COOKIE_MAX_AGE,
  PHONE_CHALLENGE_COOKIE,
  challengeFromInput,
  customerIdentityConfigured,
  encodeChallenge,
  identityCookieOptions,
  lookupGermanLineStatus,
  makeOtp,
  normalizeGermanPhone,
  sanitizeAddress,
  sendSevenOtp,
} from "@/lib/server/customer-identity";
import {
  enforceRateLimit,
  hasTrustedMutationOrigin,
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
  if (!customerIdentityConfigured()) return json({ ok: false, error: "phone_verification_not_configured" }, 503);

  const body: any = await req.json().catch(() => ({}));
  const localPhone = normalizeGermanPhone(String(body?.phone || ""));
  if (!localPhone) {
    return json({ ok: false, error: "invalid_phone", message: "Bitte gib eine gültige deutsche Telefonnummer ein." }, 400);
  }

  const ipLimit = await enforceRateLimit(req, "customer-phone-start-ip", 8, 15 * 60_000);
  if (ipLimit) return ipLimit;
  const phoneLimit = await enforceRateLimit(req, "customer-phone-start-number", 4, 30 * 60_000, localPhone);
  if (phoneLimit) return phoneLimit;

  let lookup: { valid: boolean; phoneE164: string; status: string };
  try {
    lookup = await lookupGermanLineStatus(localPhone);
  } catch (error) {
    console.error("[customer-phone] Twilio lookup failed", error);
    return json({ ok: false, error: "phone_lookup_unavailable", message: "Die Telefonnummer kann gerade nicht geprüft werden. Bitte versuche es gleich noch einmal." }, 503);
  }

  if (!lookup.valid || lookup.status === "Inactive") {
    return json({ ok: false, error: "inactive_phone", message: "Diese Telefonnummer scheint nicht aktiv zu sein. Bitte überprüfe sie." }, 400);
  }

  const otp = makeOtp();
  const address = sanitizeAddress(body?.address);
  const challenge = challengeFromInput({
    phoneE164: lookup.phoneE164,
    name: String(body?.name || "").trim(),
    otp,
    lineStatus: lookup.status || "Unknown",
    ...(address ? { pendingAddress: address } : {}),
  });

  try {
    await sendSevenOtp(lookup.phoneE164, otp);
  } catch (error) {
    console.error("[customer-phone] seven SMS failed", error);
    return json({ ok: false, error: "sms_unavailable", message: "Die SMS konnte gerade nicht gesendet werden. Bitte versuche es gleich noch einmal." }, 503);
  }

  const response = json({
    ok: true,
    phoneE164: lookup.phoneE164,
    lineStatus: lookup.status,
    expiresInSeconds: CHALLENGE_COOKIE_MAX_AGE,
  });
  response.cookies.set(PHONE_CHALLENGE_COOKIE, encodeChallenge(challenge), {
    ...identityCookieOptions,
    maxAge: CHALLENGE_COOKIE_MAX_AGE,
  });
  return response;
}
