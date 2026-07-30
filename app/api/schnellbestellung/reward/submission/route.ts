import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  getSchnellSettings,
  SCHNELL_COOKIE,
  verifySessionToken,
} from "@/lib/server/schnellbestellung";
import {
  enforceRateLimit,
  hasTrustedMutationOrigin,
  readRequestCookie,
} from "@/lib/server/request-security";
import {
  deleteTemporaryWinnerPhoto,
  uploadTemporaryWinnerPhoto,
} from "@/lib/server/reward-photo-storage";
import { createAdminInboxNotification } from "@/lib/server/admin-inbox";
import { queueWinnerShowcaseEvents } from "@/lib/server/showcase-live-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function cleanName(value: unknown) {
  return String(value ?? "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

function objectValue(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

async function createModerationNotification(params: {
  photo: boolean;
  displayName: string;
  customerNumber: number;
  rewardLabel: string;
  submissionId: string;
}) {
  try {
    await createAdminInboxNotification({
      type: params.photo ? "winner_photo_approval" : "winner_name_approval",
      title: params.photo ? "📸 Yeni kazanan fotoğrafı" : "🎉 Yeni kazanan adı",
      body: `${params.displayName} · Nummer ${params.customerNumber} · ${params.rewardLabel}`,
      url: "/admin/schnellbestellung#reward-moderation",
      sourceType: "winner_submission",
      sourceId: params.submissionId,
    });
    return true;
  } catch (error) {
    console.error("[schnell/reward/submission] admin notification failed", error);
    return false;
  }
}

export async function POST(req: Request) {
  if (!hasTrustedMutationOrigin(req)) {
    return json({ ok: false, error: "origin_not_allowed" }, 403);
  }
  // Ortak restoran Wi-Fi/IP adresindeki farkli musterilerin birbirini
  // engellememesi icin kaba IP limiti yalnizca kotuye kullanima karsi yuksek
  // tutulur. Asil tekrar limiti session + orderId uzerinden asagida uygulanir.
  const coarseRate = await enforceRateLimit(
    req,
    "schnell:reward-submission-ip",
    80,
    10 * 60_000,
  );
  if (coarseRate) return coarseRate;

  const settings = await getSchnellSettings({ includeTvPause: false });
  const session = verifySessionToken(
    readRequestCookie(req, SCHNELL_COOKIE),
    settings,
  );
  if (!session) return json({ ok: false, error: "session_expired" }, 401);

  const form = await req.formData().catch(() => null);
  if (!form) return json({ ok: false, error: "invalid_form" }, 400);

  const orderId = String(form.get("orderId") || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 120);
  const displayName = cleanName(form.get("displayName"));
  const consent = String(form.get("consent") || "") === "true";
  const expectsPhoto = String(form.get("expectsPhoto") || "") === "true";
  const photoValue = form.get("photo");
  const photo = photoValue instanceof File && photoValue.size > 0 ? photoValue : null;

  // İstemci fotoğraf göndereceğini belirttiyse sessizce yalnız-ad kaydına
  // düşmek yasaktır. Böylece fotoğraf kaybolduğunda Showcase yanlışlıkla
  // fotoğrafsız yayın yapmaz.
  if (expectsPhoto && !photo) {
    return json({ ok: false, error: "photo_missing" }, 400);
  }

  if (!orderId || !displayName) {
    return json({ ok: false, error: "name_and_order_required" }, 400);
  }

  // Her siparis icin tekrar denemeye izin verilir; fakat ayni cihaz + siparis
  // kombinasyonunun asiri gonderimi sinirlanir. Bu sayede ortak Wi-Fi kullanan
  // baska musteriler etkilenmez ve gecici baglanti hatasinda tekrar denenebilir.
  const submissionRate = await enforceRateLimit(
    req,
    "schnell:reward-submission-order",
    6,
    10 * 60_000,
    `${String(session.deviceId || "unknown")}:${orderId}`,
  );
  if (submissionRate) return submissionRate;

  const tenantId = await getTenantId();
  const rewardWin = await prisma.schnellRewardWin.findFirst({
    where: { tenantId, orderId },
    include: { order: { select: { meta: true } }, submission: true },
  });
  if (!rewardWin) return json({ ok: false, error: "reward_not_found" }, 404);

  const orderMeta = objectValue(rewardWin.order.meta);
  if (String(orderMeta.deviceId || "") !== String(session.deviceId || "")) {
    return json({ ok: false, error: "reward_forbidden" }, 403);
  }

  const rewardMeta = objectValue(orderMeta.reward);
  const rewardLabel = String(rewardMeta.customerLabel || rewardWin.rewardLabel);
  const customerNumber = Number(orderMeta.customerNumber || 0);
  const photoMode =
    rewardMeta.photoMode === "name_photo"
      ? "name_photo"
      : rewardMeta.photoMode === "name"
        ? "name"
        : "off";

  if (rewardWin.submission) {
    if (
      expectsPhoto &&
      !["pending", "approved"].includes(String(rewardWin.submission.photoStatus || ""))
    ) {
      return json(
        { ok: false, error: "submission_already_name_only" },
        409,
      );
    }

    let showcaseQueued = Boolean(rewardWin.submission.publishedAt);
    let warning: string | null = null;

    // Önceki istekte kayıt oluşmuş fakat Showcase kuyruğu geçici olarak hata
    // vermiş olabilir. Aynı tıklama yeni kayıt açmadan güvenli biçimde tamamlanır.
    if (
      !showcaseQueued &&
      rewardWin.submission.moderationStatus === "approved_name" &&
      settings.rewardProgram.showcaseEnabled
    ) {
      try {
        const events = await queueWinnerShowcaseEvents({
          submissionId: rewardWin.submission.id,
          displayName: rewardWin.submission.displayName,
          rewardLabel,
          customerNumber,
          photoApproved: false,
          program: settings.rewardProgram,
        });
        showcaseQueued = events.length > 0;
        if (showcaseQueued) {
          await prisma.schnellWinnerSubmission.update({
            where: { id: rewardWin.submission.id },
            data: { publishedAt: new Date() },
          });
        }
      } catch (error) {
        showcaseQueued = false;
        warning = "showcase_queue_failed";
        console.error(
          "[schnell/reward/submission] reused showcase queue failed",
          error,
        );
      }
    }

    return json({
      ok: true,
      reused: true,
      submissionId: rewardWin.submission.id,
      moderationStatus: rewardWin.submission.moderationStatus,
      photoPending: rewardWin.submission.photoStatus === "pending",
      photoReceived: ["pending", "approved"].includes(
        String(rewardWin.submission.photoStatus || ""),
      ),
      showcaseQueued,
      warning,
    });
  }

  if (photoMode === "off") {
    return json({ ok: false, error: "sharing_disabled" }, 409);
  }
  if (photo && photoMode !== "name_photo") {
    return json({ ok: false, error: "photo_disabled" }, 409);
  }
  if (!consent) {
    return json({ ok: false, error: "display_consent_required" }, 400);
  }
  if (photo && !["image/webp", "image/jpeg", "image/png"].includes(photo.type)) {
    return json({ ok: false, error: "photo_type_not_allowed" }, 400);
  }
  if (photo && photo.size > 2 * 1024 * 1024) {
    return json({ ok: false, error: "photo_too_large" }, 400);
  }

  const submissionId = randomUUID();
  const retentionMinutes = Math.max(
    15,
    Math.min(180, Number(rewardMeta.photoRetentionMinutes) || 60),
  );
  const expiresAt = new Date(Date.now() + retentionMinutes * 60_000);
  const extension = photo?.type === "image/png" ? "png" : photo?.type === "image/jpeg" ? "jpg" : "webp";
  const storagePath = photo ? `${tenantId}/${submissionId}.${extension}` : null;

  try {
    if (photo && storagePath) {
      await uploadTemporaryWinnerPhoto({
        path: storagePath,
        bytes: await photo.arrayBuffer(),
        mimeType: photo.type,
      });
    }

    const autoPublishName = !photo && settings.rewardProgram.autoPublishName;
    const submission = await prisma.schnellWinnerSubmission.create({
      data: {
        id: submissionId,
        tenantId,
        rewardWinId: rewardWin.id,
        displayName,
        moderationStatus: photo ? "pending" : autoPublishName ? "approved_name" : "pending",
        photoStatus: photo ? "pending" : "none",
        photoStoragePath: storagePath,
        photoMimeType: photo?.type || null,
        photoSize: photo?.size || null,
        consentVersion: photo ? "winner-screen-photo-v1" : "winner-screen-name-v1",
        consentedAt: new Date(),
        expiresAt,
      },
    });

    // Kuyruk/bildirim bayrakları yalnız kalıcı DB yazımı gerçekten tamamlandıysa
    // true döner. Serverless response-sonrası callback kaybı başarı gibi
    // gösterilmez; submission kaydı idempotent tekrar için korunur.
    let showcaseQueued = false;
    let notificationQueued = false;
    let warning: string | null = null;

    if (autoPublishName && settings.rewardProgram.showcaseEnabled) {
      try {
        const events = await queueWinnerShowcaseEvents({
          submissionId: submission.id,
          displayName,
          rewardLabel,
          customerNumber,
          photoApproved: false,
          program: settings.rewardProgram,
        });
        showcaseQueued = events.length > 0;
        if (showcaseQueued) {
          await prisma.schnellWinnerSubmission.update({
            where: { id: submission.id },
            data: { publishedAt: new Date() },
          });
        }
      } catch (error) {
        warning = "showcase_queue_failed";
        console.error("[schnell/reward/submission] showcase queue failed", error);
      }
    }

    if (!showcaseQueued) {
      try {
        await createModerationNotification({
          photo: Boolean(photo),
          displayName,
          customerNumber,
          rewardLabel,
          submissionId: submission.id,
        });
        notificationQueued = true;
      } catch (error) {
        warning = warning || "moderation_notification_failed";
        console.error(
          "[schnell/reward/submission] moderation notification failed",
          error,
        );
      }
    }

    return json({
      ok: true,
      submissionId: submission.id,
      moderationStatus: submission.moderationStatus,
      photoPending: Boolean(photo),
      photoReceived: Boolean(photo),
      showcaseQueued,
      notificationQueued,
      warning,
    });
  } catch (error) {
    if (storagePath) {
      await deleteTemporaryWinnerPhoto(storagePath).catch((cleanupError) => {
        console.error("[schnell/reward/submission] orphan cleanup failed", cleanupError);
      });
    }
    console.error("[schnell/reward/submission] failed", error);
    return json(
      {
        ok: false,
        error: "reward_submission_failed",
      },
      500,
    );
  }
}
