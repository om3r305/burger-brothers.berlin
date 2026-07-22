import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  requireMutationRole,
  requireSessionRole,
} from "@/lib/server/request-security";
import {
  createCloudinaryPublicId,
  createCloudinaryUploadSignature,
  deleteCloudinaryAsset,
  isAllowedCloudinaryPublicId,
  isCloudinaryDeliveryUrl,
  readCloudinaryConfig,
  verifyCloudinaryUploadResponse,
  type CloudinaryResourceType,
} from "@/lib/server/cloudinary";
import {
  readShowcaseAdminState,
  requestOrigin,
  saveShowcaseSetting,
  SHOWCASE_MEDIA_KEY,
} from "@/lib/showcase/server";
import { normalizeShowcaseMediaList } from "@/lib/showcase/config";
import type { ShowcaseMediaItem } from "@/lib/showcase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };
const ALLOWED_TYPES = new Set([
  "video/mp4",
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
]);

function json(payload: Record<string, any>, status = 200) {
  return NextResponse.json(payload, { status, headers: HEADERS });
}

async function body(req: Request) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function text(value: any, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function isUsed(document: any, media: ShowcaseMediaItem) {
  const scenes = Array.isArray(document?.scenes) ? document.scenes : [];
  return scenes.some(
    (scene: any) => scene?.mediaUrl === media.url || scene?.posterUrl === media.url,
  );
}

function resourceType(value: any, mimeType = ""): CloudinaryResourceType | null {
  const normalized = text(value, 30).toLowerCase();
  if (normalized === "image" || normalized === "video") return normalized;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return null;
}

function storagePayload() {
  const config = readCloudinaryConfig();
  return {
    configured: Boolean(config),
    provider: "cloudinary" as const,
    cloudName: config?.cloudName || "",
    maxUploadBytes: config?.maxUploadBytes || 0,
  };
}

export async function GET(req: Request) {
  const authError = await requireSessionRole(req, "admin");
  if (authError) return authError;

  try {
    const state = await readShowcaseAdminState(requestOrigin(req));
    return json({ ok: true, media: state.media, storage: storagePayload() });
  } catch (error: any) {
    return json({ ok: false, error: error?.message || "SHOWCASE_MEDIA_GET_FAILED" }, 500);
  }
}

export async function POST(req: Request) {
  const authError = await requireMutationRole(req, ["admin"]);
  if (authError) return authError;
  const rateError = await enforceRateLimit(req, "showcase:media", 60, 60_000);
  if (rateError) return rateError;

  try {
    const payload = await body(req);
    const action = text(payload?.action, 40);
    const config = readCloudinaryConfig();

    if (!config) {
      return json({ ok: false, error: "CLOUDINARY_NOT_CONFIGURED" }, 503);
    }

    if (action === "sign") {
      const name = text(payload?.name, 220);
      const mimeType = text(payload?.mimeType, 120).toLowerCase();
      const size = Number(payload?.size || 0);

      if (!name || !ALLOWED_TYPES.has(mimeType)) {
        return json({ ok: false, error: "UNSUPPORTED_MEDIA_TYPE" }, 400);
      }
      if (!Number.isFinite(size) || size <= 0 || size > config.maxUploadBytes) {
        return json({ ok: false, error: "MEDIA_SIZE_NOT_ALLOWED" }, 400);
      }

      const publicId = createCloudinaryPublicId(config, name);
      const signed = createCloudinaryUploadSignature(config, publicId);
      return json({
        ok: true,
        provider: "cloudinary",
        ...signed,
        maxUploadBytes: config.maxUploadBytes,
      });
    }

    if (action === "register") {
      const state = await readShowcaseAdminState(requestOrigin(req));
      const upload = payload?.upload && typeof payload.upload === "object"
        ? payload.upload
        : payload;
      const publicId = text(upload?.public_id ?? upload?.publicId, 500);
      const secureUrl = text(upload?.secure_url ?? upload?.secureUrl, 2_000);
      const mimeType = text(payload?.mimeType, 120).toLowerCase();
      const cloudResourceType = resourceType(upload?.resource_type, mimeType);
      const size = Number(upload?.bytes ?? payload?.size ?? 0);
      const version = Number(upload?.version || 0);
      const responseSignature = text(upload?.signature, 200);

      if (
        !publicId ||
        !secureUrl ||
        !cloudResourceType ||
        !ALLOWED_TYPES.has(mimeType) ||
        !isAllowedCloudinaryPublicId(config, publicId) ||
        !isCloudinaryDeliveryUrl(config, secureUrl)
      ) {
        return json({ ok: false, error: "INVALID_MEDIA_RECORD" }, 400);
      }
      if (!Number.isFinite(size) || size <= 0 || size > config.maxUploadBytes) {
        return json({ ok: false, error: "MEDIA_SIZE_NOT_ALLOWED" }, 400);
      }
      if (
        !Number.isFinite(version) ||
        version <= 0 ||
        !verifyCloudinaryUploadResponse(config, {
          publicId,
          version,
          signature: responseSignature,
        })
      ) {
        return json({ ok: false, error: "CLOUDINARY_RESPONSE_SIGNATURE_INVALID" }, 400);
      }

      const item: ShowcaseMediaItem = {
        id: text(upload?.asset_id, 160) || `media-${Date.now().toString(36)}`,
        key: publicId,
        provider: "cloudinary",
        publicId,
        resourceType: cloudResourceType,
        assetId: text(upload?.asset_id, 160) || undefined,
        version,
        format: text(upload?.format, 30) || undefined,
        name: text(payload?.name, 220) || publicId.split("/").pop() || "Dosya",
        url: secureUrl,
        mimeType,
        size,
        createdAt: new Date().toISOString(),
        width: Number(upload?.width ?? payload?.width) || undefined,
        height: Number(upload?.height ?? payload?.height) || undefined,
        durationSeconds: Number(upload?.duration ?? payload?.durationSeconds) || undefined,
      };
      const media = normalizeShowcaseMediaList([
        item,
        ...state.media.filter(
          (entry) => entry.publicId !== publicId && entry.key !== publicId,
        ),
      ]);
      await saveShowcaseSetting(state.tenantId, SHOWCASE_MEDIA_KEY, media);
      return json({ ok: true, item, media });
    }

    return json({ ok: false, error: "UNKNOWN_MEDIA_ACTION" }, 400);
  } catch (error: any) {
    console.error("[admin:showcase:media:POST]", error);
    return json({ ok: false, error: error?.message || "SHOWCASE_MEDIA_POST_FAILED" }, 500);
  }
}

export async function DELETE(req: Request) {
  const authError = await requireMutationRole(req, ["admin"]);
  if (authError) return authError;
  const rateError = await enforceRateLimit(req, "showcase:media-delete", 30, 60_000);
  if (rateError) return rateError;

  try {
    const payload = await body(req);
    const config = readCloudinaryConfig();
    if (!config) {
      return json({ ok: false, error: "CLOUDINARY_NOT_CONFIGURED" }, 503);
    }

    const state = await readShowcaseAdminState(requestOrigin(req));
    const id = text(payload?.id, 160);
    const media = state.media.find((entry) => entry.id === id);
    if (!media) return json({ ok: false, error: "MEDIA_NOT_FOUND" }, 404);

    const usage = [
      isUsed(state.draft, media) ? "draft" : "",
      isUsed(state.published, media) ? "published" : "",
    ].filter(Boolean);

    if (usage.length) {
      return json({ ok: false, error: "MEDIA_IS_IN_USE", usage }, 409);
    }

    const publicId = media.publicId || media.key;
    const cloudResourceType = resourceType(media.resourceType, media.mimeType);
    if (
      media.provider !== "cloudinary" ||
      !publicId ||
      !cloudResourceType ||
      !isCloudinaryDeliveryUrl(config, media.url)
    ) {
      return json({ ok: false, error: "LEGACY_MEDIA_DELETE_UNAVAILABLE" }, 409);
    }

    await deleteCloudinaryAsset(config, publicId, cloudResourceType);
    const next = state.media.filter((entry) => entry.id !== media.id);
    await saveShowcaseSetting(state.tenantId, SHOWCASE_MEDIA_KEY, next);
    return json({ ok: true, media: next });
  } catch (error: any) {
    console.error("[admin:showcase:media:DELETE]", error);
    return json({ ok: false, error: error?.message || "SHOWCASE_MEDIA_DELETE_FAILED" }, 500);
  }
}
