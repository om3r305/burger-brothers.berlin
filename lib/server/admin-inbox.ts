import { prisma, getTenantId } from "@/lib/db";

export async function createAdminInboxNotification(params: {
  type: string;
  title: string;
  body: string;
  url: string;
  sourceType: string;
  sourceId: string;
}) {
  const tenantId = await getTenantId();
  const dedupeKey = `${params.sourceType}:${params.sourceId}:${params.type}`.slice(0, 220);

  return prisma.adminInboxNotification.upsert({
    where: {
      tenantId_dedupeKey: {
        tenantId,
        dedupeKey,
      },
    },
    update: {
      title: params.title.slice(0, 180),
      body: params.body.slice(0, 600),
      url: params.url.slice(0, 500),
      status: "unread",
      readAt: null,
      resolvedAt: null,
    },
    create: {
      tenantId,
      type: params.type.slice(0, 80),
      title: params.title.slice(0, 180),
      body: params.body.slice(0, 600),
      url: params.url.slice(0, 500),
      sourceType: params.sourceType.slice(0, 80),
      sourceId: params.sourceId.slice(0, 180),
      dedupeKey,
      status: "unread",
    },
  });
}

export async function resolveAdminInboxNotification(params: {
  sourceType: string;
  sourceId: string;
  type?: string;
}) {
  const tenantId = await getTenantId();
  return prisma.adminInboxNotification.updateMany({
    where: {
      tenantId,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      ...(params.type ? { type: params.type } : {}),
      status: { not: "resolved" },
    },
    data: {
      status: "resolved",
      readAt: new Date(),
      resolvedAt: new Date(),
    },
  });
}
