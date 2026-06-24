
import { prisma } from "@/lib/db";
export async function saveLearnToDB(entry: { occurredAt: string; mode: "pickup"|"delivery"; host?: string; ip?: string; ua?: string; streets: string[]; }) {
  try {
    await prisma.brianLearnLog.create({ data: { occurredAt: new Date(entry.occurredAt), mode: entry.mode, host: entry.host || null, ip: entry.ip || null, ua: entry.ua || null, streets: entry.streets as any } });
    const meta = await prisma.brianMeta.findFirst({ where: { id: "singleton" } });
    if (!meta?.firstLearnAt) {
      await prisma.brianMeta.upsert({ where: { id: "singleton" }, update: { firstLearnAt: new Date(entry.occurredAt) }, create: { id: "singleton", firstLearnAt: new Date(entry.occurredAt) } });
    }
  } catch(e){ console.error("saveLearnToDB failed", e);}
}
