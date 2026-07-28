import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  getSchnellSettings,
  saveSchnellSettings,
} from "@/lib/server/schnellbestellung";
import { normalizeRewardProgram } from "@/lib/rewards/config";
import {
  berlinParts,
  generateRewardSlots,
} from "@/lib/server/schnell-rewards";
import {
  requireMutationRole,
  requireSessionRole,
} from "@/lib/server/request-security";
import { queueWinnerShowcaseEvents } from "@/lib/server/showcase-live-events";
import { resolveAdminInboxNotification } from "@/lib/server/admin-inbox";
import { deleteTemporaryWinnerPhoto } from "@/lib/server/reward-photo-storage";
import { cleanupExpiredRewardPhotos } from "@/lib/server/reward-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "private, no-store" };

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, { status, headers: HEADERS });
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

async function loadPayload() {
  await cleanupExpiredRewardPhotos().catch((error) => {
    console.error("[admin/rewards] cleanup failed", error);
  });
  const tenantId = await getTenantId();
  const settings = await getSchnellSettings({ includeTvPause: false });
  const clock = berlinParts(new Date(), settings.rewardProgram.timezone);
  const schedule = settings.rewardProgram.weekly.find(
    (item) => item.weekday === clock.weekday,
  );
  const plannedSlots = schedule
    ? generateRewardSlots({
        tenantId,
        businessDate: clock.businessDate,
        schedule,
        scheduleVersion: settings.rewardProgram.scheduleVersion,
      })
    : [];
  const [wins, submissions, pendingCount] = await Promise.all([
    prisma.schnellRewardWin.findMany({
      where: { tenantId, businessDate: clock.businessDate },
      orderBy: { createdAt: "asc" },
      select: { id: true, slotIndex: true, rewardLabel: true, createdAt: true },
    }),
    prisma.schnellWinnerSubmission.findMany({
      where: { tenantId },
      include: {
        rewardWin: {
          include: {
            order: { select: { meta: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 60,
    }),
    prisma.schnellWinnerSubmission.count({
      where: { tenantId, moderationStatus: "pending" },
    }),
  ]);

  return {
    settings: settings.rewardProgram,
    today: {
      businessDate: clock.businessDate,
      minuteOfDay: clock.minuteOfDay,
      plannedSlots,
      usedSlots: wins.map((win) => win.slotIndex),
      wins,
    },
    pendingCount,
    submissions: submissions.map((submission) => {
      const meta = objectValue(submission.rewardWin.order.meta);
      const reward = objectValue(meta.reward);
      return {
        id: submission.id,
        displayName: submission.displayName,
        moderationStatus: submission.moderationStatus,
        photoStatus: submission.photoStatus,
        hasPhoto: Boolean(submission.photoStoragePath && !submission.deletedAt),
        photoUrl:
          submission.photoStoragePath && !submission.deletedAt
            ? `/api/rewards/photos/${encodeURIComponent(submission.id)}`
            : null,
        expiresAt: submission.expiresAt,
        publishedAt: submission.publishedAt,
        deletedAt: submission.deletedAt,
        createdAt: submission.createdAt,
        rewardLabel: String(reward.customerLabel || submission.rewardWin.rewardLabel),
        customerNumber: Number(meta.customerNumber || 0),
        orderId: submission.rewardWin.orderId,
      };
    }),
  };
}

export async function GET(req: Request) {
  const auth = await requireSessionRole(req, "admin");
  if (auth) return auth;
  return json({ ok: true, ...(await loadPayload()) });
}

export async function PUT(req: Request) {
  const auth = await requireMutationRole(req, ["admin"]);
  if (auth) return auth;
  const body = await req.json().catch(() => ({}));
  const current = await getSchnellSettings({ includeTvPause: false });
  const incoming = normalizeRewardProgram(body?.settings || body?.rewardProgram || body);
  const scheduleChanged =
    JSON.stringify(current.rewardProgram.weekly) !== JSON.stringify(incoming.weekly);
  const rewardProgram = {
    ...incoming,
    scheduleVersion: scheduleChanged
      ? Math.min(999_999, current.rewardProgram.scheduleVersion + 1)
      : current.rewardProgram.scheduleVersion,
  };
  await saveSchnellSettings({ ...current, rewardProgram });
  return json({ ok: true, ...(await loadPayload()) });
}

export async function PATCH(req: Request) {
  const auth = await requireMutationRole(req, ["admin"]);
  if (auth) return auth;
  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "").trim();
  const id = String(body?.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  if (!id) return json({ ok: false, error: "submission_id_required" }, 400);

  const tenantId = await getTenantId();
  const settings = await getSchnellSettings({ includeTvPause: false });
  const submission = await prisma.schnellWinnerSubmission.findFirst({
    where: { id, tenantId },
    include: {
      rewardWin: { include: { order: { select: { meta: true } } } },
    },
  });
  if (!submission) return json({ ok: false, error: "submission_not_found" }, 404);

  const meta = objectValue(submission.rewardWin.order.meta);
  const reward = objectValue(meta.reward);
  const customerNumber = Number(meta.customerNumber || 0);
  const rewardLabel = String(reward.customerLabel || submission.rewardWin.rewardLabel);

  if (action === "reject") {
    if (submission.photoStoragePath) {
      await deleteTemporaryWinnerPhoto(submission.photoStoragePath).catch((error) => {
        console.error("[admin/rewards] reject delete failed", error);
      });
    }
    await prisma.schnellWinnerSubmission.update({
      where: { id },
      data: {
        moderationStatus: "rejected",
        photoStatus: submission.photoStoragePath ? "deleted" : submission.photoStatus,
        photoStoragePath: null,
        photoMimeType: null,
        photoSize: null,
        deletedAt: submission.photoStoragePath ? new Date() : submission.deletedAt,
        deleteAfter: new Date(),
      },
    });
    await resolveAdminInboxNotification({
      sourceType: "winner_submission",
      sourceId: id,
    });
    return json({ ok: true, ...(await loadPayload()) });
  }

  const usePhoto =
    action === "approve_photo" ||
    (action === "republish" &&
      submission.moderationStatus === "approved_photo" &&
      Boolean(submission.photoStoragePath));
  if (usePhoto && (!submission.photoStoragePath || submission.deletedAt)) {
    return json({ ok: false, error: "photo_not_available" }, 409);
  }
  if (submission.expiresAt.getTime() <= Date.now() && usePhoto) {
    return json({ ok: false, error: "photo_expired" }, 409);
  }
  if (!["approve_photo", "approve_name", "republish"].includes(action)) {
    return json({ ok: false, error: "unknown_action" }, 400);
  }

  let removedPhotoForName = false;
  if (action === "approve_name" && submission.photoStoragePath) {
    removedPhotoForName = await deleteTemporaryWinnerPhoto(
      submission.photoStoragePath,
    ).catch((error) => {
      console.error("[admin/rewards] name-only photo delete failed", error);
      return false;
    });
  }

  await queueWinnerShowcaseEvents({
    submissionId: submission.id,
    displayName: submission.displayName,
    rewardLabel,
    customerNumber,
    photoApproved: usePhoto,
    program: settings.rewardProgram,
  });
  await prisma.schnellWinnerSubmission.update({
    where: { id },
    data: {
      moderationStatus: usePhoto ? "approved_photo" : "approved_name",
      photoStatus: usePhoto
        ? "approved"
        : removedPhotoForName
          ? "deleted"
          : submission.photoStatus,
      photoStoragePath: removedPhotoForName ? null : submission.photoStoragePath,
      photoMimeType: removedPhotoForName ? null : submission.photoMimeType,
      photoSize: removedPhotoForName ? null : submission.photoSize,
      deletedAt: removedPhotoForName ? new Date() : submission.deletedAt,
      deleteAfter: removedPhotoForName ? new Date() : submission.deleteAfter,
      publishedAt: new Date(),
    },
  });
  await resolveAdminInboxNotification({
    sourceType: "winner_submission",
    sourceId: id,
  });
  return json({ ok: true, ...(await loadPayload()) });
}
