import { NextResponse } from "next/server";
import {
  enforceRateLimit,
  requireMutationRole,
  requireSessionRole,
} from "@/lib/server/request-security";
import {
  buildShowcaseSnapshot,
  readShowcaseAdminState,
  requestOrigin,
  saveShowcaseSetting,
  SHOWCASE_DRAFT_KEY,
  SHOWCASE_PUBLISHED_KEY,
} from "@/lib/showcase/server";
import {
  createDefaultShowcaseDocument,
  normalizeShowcaseDocument,
} from "@/lib/showcase/config";
import { readCloudinaryConfig } from "@/lib/server/cloudinary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };

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

export async function GET(req: Request) {
  const authError = await requireSessionRole(req, "admin");
  if (authError) return authError;

  try {
    const siteUrl = requestOrigin(req);
    const [state, snapshot] = await Promise.all([
      readShowcaseAdminState(siteUrl),
      buildShowcaseSnapshot(req),
    ]);
    const cloudinary = readCloudinaryConfig();

    return json({
      ok: true,
      source: "db",
      draft: state.draft,
      published: state.published,
      media: state.media,
      products: snapshot.products,
      campaigns: snapshot.campaigns,
      branding: snapshot.branding,
      storage: {
        configured: Boolean(cloudinary),
        provider: "cloudinary",
        cloudName: cloudinary?.cloudName || "",
        maxUploadBytes: cloudinary?.maxUploadBytes || 0,
      },
    });
  } catch (error: any) {
    console.error("[admin:showcase:GET]", error);
    return json({ ok: false, error: error?.message || "SHOWCASE_ADMIN_GET_FAILED" }, 500);
  }
}

export async function PUT(req: Request) {
  const authError = await requireMutationRole(req, ["admin"]);
  if (authError) return authError;
  const rateError = await enforceRateLimit(req, "showcase:draft", 60, 60_000);
  if (rateError) return rateError;

  try {
    const siteUrl = requestOrigin(req);
    const state = await readShowcaseAdminState(siteUrl);
    const payload = await body(req);
    const document = normalizeShowcaseDocument(payload?.document ?? payload, siteUrl);
    const saved = {
      ...document,
      version: document.version.startsWith("draft-")
        ? document.version
        : `draft-${Date.now().toString(36)}`,
      updatedAt: new Date().toISOString(),
      publishedAt: state.published.publishedAt,
    };

    await saveShowcaseSetting(state.tenantId, SHOWCASE_DRAFT_KEY, saved);
    return json({ ok: true, source: "db", draft: saved });
  } catch (error: any) {
    console.error("[admin:showcase:PUT]", error);
    return json({ ok: false, error: error?.message || "SHOWCASE_DRAFT_SAVE_FAILED" }, 500);
  }
}

export async function POST(req: Request) {
  const authError = await requireMutationRole(req, ["admin"]);
  if (authError) return authError;
  const rateError = await enforceRateLimit(req, "showcase:publish", 20, 60_000);
  if (rateError) return rateError;

  try {
    const siteUrl = requestOrigin(req);
    const state = await readShowcaseAdminState(siteUrl);
    const payload = await body(req);
    const action = String(payload?.action || "publish");

    if (action === "restorePublished") {
      const restored = {
        ...state.published,
        version: `draft-${Date.now().toString(36)}`,
        updatedAt: new Date().toISOString(),
      };
      await saveShowcaseSetting(state.tenantId, SHOWCASE_DRAFT_KEY, restored);
      return json({ ok: true, source: "db", draft: restored, published: state.published });
    }

    if (action === "resetDraft") {
      const reset = createDefaultShowcaseDocument(siteUrl);
      await saveShowcaseSetting(state.tenantId, SHOWCASE_DRAFT_KEY, reset);
      return json({ ok: true, source: "db", draft: reset, published: state.published });
    }

    const normalized = normalizeShowcaseDocument(
      payload?.document ?? state.draft,
      siteUrl,
    );
    const now = new Date().toISOString();
    const published = {
      ...normalized,
      version: `pub-${Date.now().toString(36)}`,
      updatedAt: now,
      publishedAt: now,
    };

    await Promise.all([
      saveShowcaseSetting(state.tenantId, SHOWCASE_DRAFT_KEY, published),
      saveShowcaseSetting(state.tenantId, SHOWCASE_PUBLISHED_KEY, published),
    ]);

    return json({ ok: true, source: "db", draft: published, published });
  } catch (error: any) {
    console.error("[admin:showcase:POST]", error);
    return json({ ok: false, error: error?.message || "SHOWCASE_PUBLISH_FAILED" }, 500);
  }
}
