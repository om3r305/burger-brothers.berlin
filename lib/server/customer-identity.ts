import {
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { prisma, getTenantId } from "@/lib/db";
import { readRequestCookie } from "@/lib/server/request-security";

export const CUSTOMER_DEVICE_COOKIE = "bb_customer_device_v1";
export const PHONE_CHALLENGE_COOKIE = "bb_phone_challenge_v1";
export const CUSTOMER_IDENTITY_VERSION = 1;

const DEVICE_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

export type SavedCustomerAddress = {
  id: string;
  label: string;
  street: string;
  house: string;
  zip: string;
  city: string;
  deliveryHint?: string;
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
};

type TrustedDevice = {
  hash: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

type IdentityStats = {
  version: number;
  phoneVerifiedAt?: string;
  trustedDevices: TrustedDevice[];
  savedAddresses: SavedCustomerAddress[];
};

type ChallengePayload = {
  phoneE164: string;
  name: string;
  otpHash: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  lineStatus: string;
  pendingAddress?: Omit<SavedCustomerAddress, "id" | "createdAt" | "updatedAt">;
};

function secret() {
  return String(
    process.env.CUSTOMER_IDENTITY_SECRET || process.env.ADMIN_SESSION_SECRET || "",
  ).trim();
}

export function customerIdentityConfigured() {
  return Boolean(
    secret() &&
      process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.SEVEN_API_KEY,
  );
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function signPayload(payload: string) {
  const key = secret();
  if (!key) return "";
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function encodeChallenge(payload: ChallengePayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signPayload(body);
  return signature ? `${body}.${signature}` : "";
}

export function decodeChallenge(raw: string): ChallengePayload | null {
  const [body, signature] = String(raw || "").split(".");
  if (!body || !signature) return null;
  const expected = signPayload(body);
  if (!expected || !safeEqual(signature, expected)) return null;

  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!value || typeof value !== "object") return null;
    if (!value.phoneE164 || !value.otpHash || !Number(value.expiresAt)) return null;
    return value as ChallengePayload;
  } catch {
    return null;
  }
}

export function makeOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function hashOtp(phoneE164: string, otp: string) {
  return createHmac("sha256", secret())
    .update(`${phoneE164}:${otp}`)
    .digest("hex");
}

export function verifyOtpHash(phoneE164: string, otp: string, expected: string) {
  return safeEqual(hashOtp(phoneE164, otp), expected);
}

export function challengeFromInput(input: {
  phoneE164: string;
  name?: string;
  otp: string;
  lineStatus: string;
  pendingAddress?: ChallengePayload["pendingAddress"];
}): ChallengePayload {
  const now = Date.now();
  return {
    phoneE164: input.phoneE164,
    name: String(input.name || "").trim().slice(0, 120),
    otpHash: hashOtp(input.phoneE164, input.otp),
    createdAt: now,
    expiresAt: now + OTP_TTL_MS,
    attempts: 0,
    lineStatus: input.lineStatus,
    ...(input.pendingAddress ? { pendingAddress: input.pendingAddress } : {}),
  };
}

export function nextFailedChallenge(challenge: ChallengePayload) {
  return {
    ...challenge,
    attempts: Math.min(OTP_MAX_ATTEMPTS, challenge.attempts + 1),
  };
}

export function challengeUsable(challenge: ChallengePayload) {
  return challenge.expiresAt > Date.now() && challenge.attempts < OTP_MAX_ATTEMPTS;
}

function normalizeGermanNationalDigits(raw: string) {
  const compact = String(raw || "").replace(/[^\d+]/g, "");
  if (compact.startsWith("+49")) {
    return `0${compact.slice(3).replace(/\D/g, "")}`;
  }
  if (compact.startsWith("0049")) {
    return `0${compact.slice(4).replace(/\D/g, "")}`;
  }
  const digits = compact.replace(/\D/g, "");
  if (digits.startsWith("49") && !digits.startsWith("049")) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

/**
 * Zero-cost German pre-filter and E.164 normalizer. Twilio Lookup performs the
 * provider-side numbering-plan / line-status validation before an SMS is sent.
 */
export function normalizeGermanPhone(raw: string) {
  const national = normalizeGermanNationalDigits(raw);
  if (!/^0\d+$/.test(national)) return null;
  if (national.length < 8 || national.length > 13) return null;
  if (/^0(?:0|1{5,}|2{6,}|9{6,})/.test(national)) return null;
  if (!/^0(?:1[5-7]|2\d|3\d|4\d|5\d|6\d|7\d|8\d|9\d)/.test(national)) {
    return null;
  }
  return `+49${national.slice(1)}`;
}

export function germanPhoneForCheckout(raw: string) {
  const e164 = normalizeGermanPhone(raw);
  return e164 ? `0${e164.slice(3)}` : String(raw || "").replace(/\D/g, "");
}

function phoneStorageCandidates(raw: string) {
  const e164 = normalizeGermanPhone(raw);
  if (!e164) return [];
  const national = `0${e164.slice(3)}`;
  const internationalDigits = e164.replace(/\D/g, "");
  return [national, internationalDigits, e164];
}

function canonicalLineStatus(raw: unknown) {
  const value = String(raw || "Unknown").trim().toLowerCase();
  if (value === "active") return "Active";
  if (value === "reachable") return "Reachable";
  if (value === "unreachable") return "Unreachable";
  if (value === "inactive") return "Inactive";
  return "Unknown";
}

export async function lookupGermanLineStatus(phoneE164: string) {
  const sid = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
  const token = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
  if (!sid || !token) throw new Error("TWILIO_NOT_CONFIGURED");

  const url = new URL(
    `https://lookups.twilio.com/v2/PhoneNumbers/${encodeURIComponent(phoneE164)}`,
  );
  url.searchParams.set("Fields", "line_status");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    if (response.status === 404 || response.status === 400) {
      return { valid: false, phoneE164, status: "Inactive" };
    }
    throw new Error(`TWILIO_LOOKUP_${response.status}`);
  }

  const data: any = await response.json().catch(() => ({}));
  const canonical = String(
    data?.phone_number || data?.phoneNumber || phoneE164,
  ).trim();
  const status = canonicalLineStatus(
    data?.line_status?.status || data?.lineStatus?.status || "Unknown",
  );
  const valid = Boolean(normalizeGermanPhone(canonical));

  return {
    valid,
    phoneE164: normalizeGermanPhone(canonical) || phoneE164,
    status,
  };
}

export async function sendSevenOtp(phoneE164: string, otp: string) {
  const apiKey = String(process.env.SEVEN_API_KEY || "").trim();
  if (!apiKey) throw new Error("SEVEN_NOT_CONFIGURED");

  const body = new URLSearchParams({
    to: phoneE164.replace(/^\+/, ""),
    from: String(process.env.SEVEN_SENDER || "BurgerBros").slice(0, 11),
    text: `Burger Brothers: Dein Bestätigungscode ist ${otp}. Gültig 5 Min.`,
  });

  const response = await fetch("https://gateway.seven.io/api/sms", {
    method: "POST",
    headers: {
      "X-Api-Key": apiKey,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
    cache: "no-store",
  });

  const data: any = await response.json().catch(() => null);
  const success =
    response.ok &&
    (String(data?.success || "") === "100" ||
      (Array.isArray(data?.messages) &&
        data.messages.some((item: any) => item?.success === true)));

  if (!success) throw new Error(`SEVEN_SEND_${response.status}`);
  return data;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function readIdentity(stats: unknown): IdentityStats {
  const root = asRecord(stats);
  const current = asRecord(root.identityV1);
  const devices = Array.isArray(current.trustedDevices)
    ? current.trustedDevices
    : [];
  const addresses = Array.isArray(current.savedAddresses)
    ? current.savedAddresses
    : [];
  return {
    version: CUSTOMER_IDENTITY_VERSION,
    phoneVerifiedAt: String(current.phoneVerifiedAt || "") || undefined,
    trustedDevices: devices.filter(
      (item) => item && typeof item.hash === "string",
    ),
    savedAddresses: addresses.filter(
      (item) => item && typeof item.id === "string",
    ),
  };
}

function mergedStats(stats: unknown, identity: IdentityStats) {
  return { ...asRecord(stats), identityV1: identity };
}

export function sanitizeAddress(input: any) {
  const street = String(input?.street || "").trim().slice(0, 120);
  const house = String(input?.house || "").trim().slice(0, 30);
  const zip = String(input?.zip || input?.plz || "")
    .replace(/\D/g, "")
    .slice(0, 5);
  const city = String(input?.city || "Berlin").trim().slice(0, 80) || "Berlin";
  if (!street || !house || !/^\d{5}$/.test(zip)) return null;
  return {
    label:
      String(input?.label || "Zuhause").trim().slice(0, 40) || "Zuhause",
    street,
    house,
    zip,
    city,
    deliveryHint: String(input?.deliveryHint || input?.note || "")
      .trim()
      .slice(0, 240),
    isDefault: Boolean(input?.isDefault),
  };
}

export async function establishTrustedCustomer(input: {
  phoneE164: string;
  name?: string;
  pendingAddress?: ChallengePayload["pendingAddress"];
}) {
  const tenantId = await getTenantId();
  const candidates = phoneStorageCandidates(input.phoneE164);
  if (!candidates.length) throw new Error("CUSTOMER_PHONE_INVALID");

  const existing = await prisma.customer.findFirst({
    where: {
      tenantId,
      phone: { in: candidates },
    },
  });
  const dbPhone = String(existing?.phone || candidates[0]);
  const now = new Date().toISOString();
  const rawDeviceToken = randomBytes(32).toString("base64url");
  const deviceHash = sha256(rawDeviceToken);
  const identity = readIdentity(existing?.stats);
  const devices = identity.trustedDevices
    .filter((item) => Date.parse(item.expiresAt) > Date.now())
    .slice(-7);
  devices.push({
    hash: deviceHash,
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(Date.now() + DEVICE_TTL_MS).toISOString(),
  });

  let addresses = identity.savedAddresses;
  if (input.pendingAddress && addresses.length === 0) {
    addresses = [
      {
        id: randomBytes(12).toString("base64url"),
        ...input.pendingAddress,
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  const nextIdentity: IdentityStats = {
    version: CUSTOMER_IDENTITY_VERSION,
    phoneVerifiedAt: now,
    trustedDevices: devices,
    savedAddresses: addresses,
  };
  const stats = mergedStats(existing?.stats, nextIdentity);

  const customer = existing
    ? await prisma.customer.update({
        where: { id: existing.id },
        data: {
          ...(input.name ? { name: input.name } : {}),
          stats,
        },
      })
    : await prisma.customer.create({
        data: {
          tenantId,
          phone: dbPhone,
          name: input.name || "Gast",
          stats,
        },
      });

  return { customer, rawDeviceToken, identity: nextIdentity };
}

export async function readTrustedCustomer(req: Request) {
  const cookie = readRequestCookie(req, CUSTOMER_DEVICE_COOKIE);
  const separator = cookie.indexOf(".");
  if (separator <= 0) return null;

  const customerId = cookie.slice(0, separator).trim();
  const rawToken = cookie.slice(separator + 1).trim();
  if (!customerId || rawToken.length < 24) return null;

  const tenantId = await getTenantId();
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, tenantId },
    select: { id: true, name: true, phone: true, stats: true },
  });
  if (!customer) return null;

  const tokenHash = sha256(rawToken);
  const identity = readIdentity(customer.stats);
  const device = identity.trustedDevices.find(
    (item) =>
      safeEqual(item.hash, tokenHash) && Date.parse(item.expiresAt) > Date.now(),
  );
  if (!device) return null;

  return { customer, identity };
}

export async function replaceSavedAddresses(
  customerId: string,
  stats: unknown,
  addresses: SavedCustomerAddress[],
) {
  const identity = readIdentity(stats);
  const nextIdentity = {
    ...identity,
    savedAddresses: addresses.slice(0, 10),
  };
  await prisma.customer.update({
    where: { id: customerId },
    data: { stats: mergedStats(stats, nextIdentity) },
  });
  return nextIdentity;
}

export function newSavedAddress(
  input: any,
  existingCount: number,
): SavedCustomerAddress | null {
  const address = sanitizeAddress(input);
  if (!address) return null;
  const now = new Date().toISOString();
  return {
    id: randomBytes(12).toString("base64url"),
    ...address,
    isDefault: address.isDefault || existingCount === 0,
    createdAt: now,
    updatedAt: now,
  };
}

export const identityCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};

export const DEVICE_COOKIE_MAX_AGE = Math.floor(DEVICE_TTL_MS / 1000);
export const CHALLENGE_COOKIE_MAX_AGE = Math.floor(OTP_TTL_MS / 1000);
