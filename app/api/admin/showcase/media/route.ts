import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  requireMutationRole,
  requireSessionRole,
} from "@/lib/server/request-security";
import {
  createR2ObjectKey,
  createR2PresignedPutUrl,
  deleteR2Object,
  publicR2Url,
  readR2Config,
} from "@/lib/server/r2";
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

export async function GET(req: Request) {
  const authError = await requireSessionRole(req, "admin");
  if (authError) return authError;

  try {
    const state = await readShowcaseAdminState(requestOrigin(req));
    const config = readR2Config();
    return json({
      ok: true,
      media: state.media,
      storage: {
        configured: Boolean(config),
        bucket: config?.bucket || "",
        publicBaseUrl: config?.publicBaseUrl || "",
        maxUploadBytes: config?.maxUploadBytes || 0,
      },
    });
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
    const config = readR2Config();

    if (!config) {
      return json({ ok: false, error: "R2_NOT_CONFIGURED" }, 503);
    }

    if (action === "presign") {
      const name = text(payload?.name, 220);
      const mimeType = text(payload?.mimeType, 120).toLowerCase();
      const size = Number(payload?.size || 0);

      if (!name || !ALLOWED_TYPES.has(mimeType)) {
        return json({ ok: false, error: "UNSUPPORTED_MEDIA_TYPE" }, 400);
      }
      if (!Number.isFinite(size) || size <= 0 || size > config.maxUploadBytes) {
        return json({ ok: false, error: "MEDIA_SIZE_NOT_ALLOWED" }, 400);
      }

      const key = createR2ObjectKey(name);
      return json({
        ok: true,
        key,
        uploadUrl: createR2PresignedPutUrl(config, key, 900),
        publicUrl: publicR2Url(config, key),
        expiresIn: 900,
      });
    }

    if (action === "register") {
      const state = await readShowcaseAdminState(requestOrigin(req));
      const key = text(payload?.key, 500);
      const expectedUrl = key ? publicR2Url(config, key) : "";
      const mimeType = text(payload?.mimeType, 120).toLowerCase();
      const size = Number(payload?.size || 0);

      if (!key.startsWith("showcase/") || !ALLOWED_TYPES.has(mimeType)) {
        return json({ ok: false, error: "INVALID_MEDIA_RECORD" }, 400);
      }
      if (!Number.isFinite(size) || size <= 0 || size > config.maxUploadBytes) {
        return json({ ok: false, error: "MEDIA_SIZE_NOT_ALLOWED" }, 400);
      }

      const item: ShowcaseMediaItem = {
        id: text(payload?.id, 120) || `media-${Date.now().toString(36)}`,
        key,
        name: text(payload?.name, 220) || key.split("/").pop() || "Datei",
        url: expectedUrl,
        mimeType,
        size,
        createdAt: new Date().toISOString(),
        width: Number(payload?.width) || undefined,
        height: Number(payload?.height) || undefined,
        durationSeconds: Number(payload?.durationSeconds) || undefined,
      };
      const media = normalizeShowcaseMediaList([
        item,
        ...state.media.filter((entry) => entry.key !== key),
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
    const config = readR2Config();
    if (!config) return json({ ok: false, error: "R2_NOT_CONFIGURED" }, 503);

    const state = await readShowcaseAdminState(requestOrigin(req));
    const id = text(payload?.id, 120);
    const media = state.media.find((entry) => entry.id === id);
    if (!media) return json({ ok: false, error: "MEDIA_NOT_FOUND" }, 404);

    const usage = [
      isUsed(state.draft, media) ? "draft" : "",
      isUsed(state.published, media) ? "published" : "",
    ].filter(Boolean);

    if (usage.length) {
      return json({ ok: false, error: "MEDIA_IS_IN_USE", usage }, 409);
    }

    await deleteR2Object(config, media.key);
    const next = state.media.filter((entry) => entry.id !== media.id);
    await saveShowcaseSetting(state.tenantId, SHOWCASE_MEDIA_KEY, next);
    return json({ ok: true, media: next });
  } catch (error: any) {
    console.error("[admin:showcase:media:DELETE]", error);
    return json({ ok: false, error: error?.message || "SHOWCASE_MEDIA_DELETE_FAILED" }, 500);
  }
}
