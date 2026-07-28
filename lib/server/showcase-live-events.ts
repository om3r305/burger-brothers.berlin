import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma, getTenantId } from "@/lib/db";
import type { SchnellRewardProgram } from "@/lib/rewards/config";

const SHOWCASE_SCREENS_KEY = "showcase:screens";
const DEFAULT_ACTIVE_SCREEN_SLUGS = ["main", "brand", "menu", "announcement"];

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

function cleanSlug(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 80);
}

async function activeShowcaseScreenSlugs(tenantId: string) {
  const setting = await prisma.setting.findUnique({
    where: { tenantId_key: { tenantId, key: SHOWCASE_SCREENS_KEY } },
    select: { value: true },
  });

  const rows = Array.isArray(setting?.value) ? setting.value : [];
  const slugs = rows
    .filter((row) => row && typeof row === "object" && !Array.isArray(row))
    .filter((row) => (row as Record<string, unknown>).active !== false)
    .map((row) => cleanSlug((row as Record<string, unknown>).slug))
    .filter(Boolean);

  return [...new Set(slugs.length ? slugs : DEFAULT_ACTIVE_SCREEN_SLUGS)];
}

async function targetScreenSlugs(tenantId: string, program: SchnellRewardProgram) {
  if (program.targetAllActiveScreens) {
    return activeShowcaseScreenSlugs(tenantId);
  }

  const selected = program.targetScreenSlugs.map(cleanSlug).filter(Boolean);
  return [...new Set(selected.length ? selected : ["main"])] as string[];
}

export async function queueWinnerShowcaseEvents(params: {
  submissionId: string;
  displayName: string;
  rewardLabel: string;
  customerNumber: number;
  photoApproved: boolean;
  program: SchnellRewardProgram;
  force?: boolean;
}) {
  if (!params.program.showcaseEnabled) return [];

  const tenantId = await getTenantId();
  const queuedAt = new Date();
  // Bütün ekranlar event'i polling ile önceden alır ve aynı scheduledAt anında
  // başlatır. Böylece farklı polling tick'leri 20-25 saniyelik kayma yaratmaz.
  const scheduledAt = new Date(queuedAt.getTime() + 6_000);
  const lifetimeMs = Math.max(
    3 * 60_000,
    (params.program.showcaseDurationSeconds + 120) * 1_000,
  );
  const expiresAt = new Date(scheduledAt.getTime() + lifetimeMs);
  const photoToken = params.photoApproved
    ? createWinnerPhotoAccessToken(params.submissionId, expiresAt)
    : null;
  const photoUrl = photoToken
    ? `/api/rewards/photos/${encodeURIComponent(params.submissionId)}?token=${encodeURIComponent(photoToken)}`
    : null;
  const slugs = await targetScreenSlugs(tenantId, params.program);
  const displayName = String(params.displayName || "Glückspilz").trim().slice(0, 40);
  const rewardLabel = String(params.rewardLabel || "Glücksgewinn").trim().slice(0, 180);

  const payload = {
    displayName,
    rewardLabel,
    customerNumber: params.customerNumber,
    photoUrl,
    durationSeconds: params.program.showcaseDurationSeconds,
    soundEnabled: params.program.celebrationSoundEnabled,
    headline: `${displayName} hat gewonnen!`,
    message: "Viel Glück & guten Appetit!",
  };

  let existingSlugs = new Set<string>();
  if (!params.force) {
    const existing = await prisma.showcaseLiveEvent.findMany({
      where: {
        tenantId,
        screenSlug: { in: slugs },
        eventType: "winner_celebration",
        sourceType: "winner_submission",
        sourceId: params.submissionId,
        status: { in: ["pending", "played"] },
      },
      select: { screenSlug: true },
    });
    existingSlugs = new Set(existing.map((row) => row.screenSlug));
  }

  const rows = slugs
    .filter((screenSlug) => params.force || !existingSlugs.has(screenSlug))
    .map((screenSlug) => ({
      tenantId,
      screenSlug,
      eventType: "winner_celebration",
      sourceType: "winner_submission",
      sourceId: params.submissionId,
      payload,
      status: "pending",
      scheduledAt,
      expiresAt,
    }));

  if (rows.length > 0) {
    await prisma.showcaseLiveEvent.createMany({ data: rows });
  }

  // Çağıran kod yalnız event sayısını kullanır. Daha önce kuyruklanmış sluglar
  // da başarı sayılır; idempotent tekrar isteği yanlışlıkla "0 event" dönmez.
  return slugs.map((screenSlug) => ({
    tenantId,
    screenSlug,
    eventType: "winner_celebration",
    sourceType: "winner_submission",
    sourceId: params.submissionId,
    payload,
    status: "pending",
    scheduledAt,
    expiresAt,
    reused: !params.force && existingSlugs.has(screenSlug),
  }));
}
