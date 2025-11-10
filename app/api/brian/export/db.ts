// app/api/brian/export/db.ts
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

type Pair = {
  a: string;
  b: string;
  support: number;
  lift: number;
  confidence_lb: number;
  negative?: boolean;
};

type Cluster = {
  id: string;
  color?: string;
  streets: string[];
};

export async function writeBrianModelToDB(payload: {
  meta: any;
  pairs: Pair[];
  clusters: Cluster[];
}): Promise<void> {
  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // temiz başlangıç
      await tx.brianPair.deleteMany({});
      await tx.brianCluster.deleteMany({});

      // eşleşmeler
      for (const p of payload.pairs) {
        await tx.brianPair.create({
          data: {
            a: p.a,
            b: p.b,
            support: p.support,
            lift: p.lift,
            confidenceLB: p.confidence_lb,
            negative: !!p.negative,
          },
        });
      }

      // kümeler
      for (const c of payload.clusters) {
        await tx.brianCluster.create({
          data: {
            id: c.id,
            color: c.color || null,
            streets: c.streets as any, // şema JSON[] ise aynen kalsın
          },
        });
      }

      // meta
      await tx.brianMeta.upsert({
        where: { id: "singleton" },
        update: {
          updatedAt: new Date(payload.meta?.updatedAt || new Date()),
          thresholds: payload.meta?.thresholds || {},
          windowDays: payload.meta?.windowDays || 60,
        },
        create: {
          id: "singleton",
          firstLearnAt: payload.meta?.firstLearnAt
            ? new Date(payload.meta.firstLearnAt)
            : null,
          updatedAt: new Date(payload.meta?.updatedAt || new Date()),
          thresholds: payload.meta?.thresholds || {},
          windowDays: payload.meta?.windowDays || 60,
        },
      });
    });
  } catch (e) {
    console.error("writeBrianModelToDB failed", e);
  }
}
