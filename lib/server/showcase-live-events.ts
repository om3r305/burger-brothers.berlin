import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma, getTenantId } from "@/lib/db";
import type { SchnellRewardProgram } from "@/lib/rewards/config";

function secret() {
  const value = String(
    process.env.SESSION_SECRET ||
      process.env.NEXTAUTH_SECRET ||
      process.env.AUTH_SECRET ||
      "",
  ).trim();
  if (value) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("SHOWCASE_EVENT_SECRET_NOT_CONFIGURED");
  }
  return "burger-brothers-showcase-event-dev-only";
}

function sign(value: string) {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

export function createShowcaseEventAckToken(eventId: string, expiresAt: Date) {
  const expires = Math.floor(expiresAt.getTime() / 1_000);
  return `${expires}.${sign(`${eventId}:${expires}`)}`;
}

export function verifyShowcaseEventAckToken(eventId: string, token: string) {
  const [expiresText, signature] = String(token || "").split(".");
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires * 1_000 < Date.now()) return false;
  const expected = sign(`${eventId}:${expires}`);
  const a = Buffer.from(signature || "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createWinnerPhotoAccessToken(submissionId: string, expiresAt: Date) {
  const expires = Math.floor(expiresAt.getTime() / 1_000);
  return `${expires}.${sign(`photo:${submissionId}:${expires}`)}`;
}

export function verifyWinnerPhotoAccessToken(submissionId: string, token: string) {
  const [expiresText, signature] = String(token || "").split(".");
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires * 1_000 < Date.now()) return false;
  const expected = sign(`photo:${submissionId}:${expires}`);
  const a = Buffer.from(signature || "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cleanSlug(value: string) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

export async function queueWinnerShowcaseEvents(params: {
  submissionId: string;
  displayName: string;
  rewardLabel: string;
  customerNumber: number;
  photoApproved: boolean;
  program: SchnellRewardProgram;
}) {
  if (!params.program.showcaseEnabled) return [];
  const tenantId = await getTenantId();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60_000);
  const photoToken = params.photoApproved
    ? createWinnerPhotoAccessToken(params.submissionId, expiresAt)
    : null;
  const photoUrl = photoToken
    ? `/api/rewards/photos/${encodeURIComponent(params.submissionId)}?token=${encodeURIComponent(photoToken)}`
    : null;
  const slugs = [...new Set(params.program.targetScreenSlugs.map(cleanSlug).filter(Boolean))];
  const payload = {
    displayName: params.displayName,
    rewardLabel: params.rewardLabel,
    customerNumber: params.customerNumber,
    photoUrl,
    durationSeconds: params.program.showcaseDurationSeconds,
    soundEnabled: params.program.celebrationSoundEnabled,
    message: "Burger Brothers wünscht dir weiterhin viel Glück!",
  };

  const events = [];
  for (const screenSlug of slugs) {
    const event = await prisma.showcaseLiveEvent.create({
      data: {
        tenantId,
        screenSlug,
        eventType: "winner_celebration",
        sourceType: "winner_submission",
        sourceId: params.submissionId,
        payload,
        status: "pending",
        scheduledAt: now,
        expiresAt,
      },
    });
    events.push(event);
  }
  return events;
}
