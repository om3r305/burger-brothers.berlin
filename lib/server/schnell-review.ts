import { timingSafeEqual } from "node:crypto";

/*
  App Store review access for the Schnellbestellung app.

  Apple's reviewers cannot scan the in-restaurant QR code or pass the location
  check, so a secret review code (env SCHNELL_REVIEW_CODE, at least 16 chars)
  can stand in for the QR token as `t=review:<code>`. Such a session skips the
  location check and its orders are simulated: nothing is written to the
  database, so no ticket reaches the kitchen, TV, printer or cash report.
  Without the env variable the feature is off.
*/

export const REVIEW_TOKEN_PREFIX = "review:";
export const REVIEW_ORDER_PREFIX = "review-";
export const REVIEW_CUSTOMER_NUMBER = 99;

function configuredCode() {
  const code = String(process.env.SCHNELL_REVIEW_CODE || "").trim();
  return code.length >= 16 ? code : "";
}

export function reviewCodeFromToken(token: unknown) {
  const value = String(token || "").trim();
  return value.startsWith(REVIEW_TOKEN_PREFIX)
    ? value.slice(REVIEW_TOKEN_PREFIX.length)
    : null;
}

export function isValidReviewCode(code: string) {
  const expected = configuredCode();
  if (!expected) return false;
  const a = Buffer.from(code);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isReviewSession(session: unknown) {
  return Boolean(
    session &&
      typeof session === "object" &&
      (session as Record<string, unknown>).review === true,
  );
}

export function createReviewOrderId(now = Date.now()) {
  return `${REVIEW_ORDER_PREFIX}${now}`;
}

export function isReviewOrderId(orderId: string) {
  return orderId.startsWith(REVIEW_ORDER_PREFIX);
}

/** A simulated order walks new → preparing → ready over about a minute. */
export function reviewOrderStatus(orderId: string, now = Date.now()) {
  const createdAt = Number(orderId.slice(REVIEW_ORDER_PREFIX.length));
  const elapsed = Number.isFinite(createdAt) ? now - createdAt : Infinity;
  if (elapsed < 15_000) return "new";
  if (elapsed < 45_000) return "preparing";
  return "ready";
}
