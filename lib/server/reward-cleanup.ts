import { prisma, getTenantId } from "@/lib/db";
import { deleteTemporaryWinnerPhoto } from "@/lib/server/reward-photo-storage";

export async function cleanupExpiredRewardPhotos() {
  const tenantId = await getTenantId();
  const now = new Date();
  const rows = await prisma.schnellWinnerSubmission.findMany({
    where: {
      tenantId,
      photoStoragePath: { not: null },
      deletedAt: null,
      OR: [{ expiresAt: { lte: now } }, { deleteAfter: { lte: now } }],
    },
    select: { id: true, photoStoragePath: true },
    take: 100,
  });

  let deleted = 0;
  for (const row of rows) {
    const path = String(row.photoStoragePath || "");
    if (!path) continue;
    const removed = await deleteTemporaryWinnerPhoto(path).catch((error) => {
      console.error("[reward-cleanup] storage delete failed", row.id, error);
      return false;
    });
    if (!removed) continue;
    await prisma.schnellWinnerSubmission.update({
      where: { id: row.id },
      data: {
        photoStoragePath: null,
        photoMimeType: null,
        photoSize: null,
        photoStatus: "deleted",
        deletedAt: new Date(),
      },
    });
    deleted += 1;
  }

  await prisma.showcaseLiveEvent.updateMany({
    where: { tenantId, status: "pending", expiresAt: { lte: now } },
    data: { status: "expired" },
  });

  return { scanned: rows.length, deleted };
}
