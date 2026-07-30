import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  enforceRateLimit,
  requireSessionRole,
} from "@/lib/server/request-security";
import { readTemporaryWinnerPhoto } from "@/lib/server/reward-photo-storage";
import { verifyWinnerPhotoAccessToken } from "@/lib/server/showcase-live-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  const rateError = await enforceRateLimit(req, "rewards:photo:read", 120, 60_000);
  if (rateError) return rateError;

  const { id: rawId } = await context.params;
  const id = String(rawId || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
  if (!id) return new NextResponse(null, { status: 404 });

  const token = new URL(req.url).searchParams.get("token") || "";
  const publicAuthorized = token && verifyWinnerPhotoAccessToken(id, token);
  if (!publicAuthorized) {
    const auth = await requireSessionRole(req, "admin");
    if (auth) return auth;
  }

  const tenantId = await getTenantId();
  const submission = await prisma.schnellWinnerSubmission.findFirst({
    where: {
      id,
      tenantId,
      photoStoragePath: { not: null },
      deletedAt: null,
    },
    select: {
      photoStoragePath: true,
      photoMimeType: true,
      expiresAt: true,
      deleteAfter: true,
    },
  });
  if (!submission?.photoStoragePath) return new NextResponse(null, { status: 404 });
  const deadline = submission.deleteAfter || submission.expiresAt;
  if (deadline.getTime() <= Date.now()) return new NextResponse(null, { status: 410 });

  const file = await readTemporaryWinnerPhoto(submission.photoStoragePath);
  if (!file) return new NextResponse(null, { status: 404 });

  return new NextResponse(file.bytes, {
    status: 200,
    headers: {
      "Content-Type": submission.photoMimeType || file.contentType,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
