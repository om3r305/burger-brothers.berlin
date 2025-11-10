// lib/server/settings.ts
import fs from "fs";
import path from "path";
import { DBA } from "@/lib/server/db";

export type ServerSettings = {
  telegram?: {
    botToken?: string;
    chatId?: string;
  };
  hours?: {
    avgPickupMinutes?: number;
    avgDeliveryMinutes?: number;
  };
  orders?: {
    idLength?: number;
  };
};

function safeJSON(p: string): any {
  try {
    const txt = fs.readFileSync(p, "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

/**
 * Sunucu ayarlarını getirir.
 * Önce KV (DBA) → sonra dosya (.data/data/tmp) → en son ENV fallback.
 */
export async function getServerSettings(): Promise<ServerSettings> {
  // 1) KV (Prisma/SQLite/JSON) üzerinden dene
  try {
    const kv = await DBA.read("server_settings", null);
    if (kv && typeof kv === "object") return kv as ServerSettings;
  } catch {}

  // 2) Dosyalardan dene
  const candidates = [
    path.join(process.cwd(), ".data", "settings.json"),
    path.join(process.cwd(), "data", "settings.json"),
    "/tmp/settings.json",
  ];
  for (const p of candidates) {
    const obj = safeJSON(p);
    if (obj) return obj as ServerSettings;
  }

  // 3) ENV fallback
  return {
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
    },
    hours: {
      avgPickupMinutes: Number(process.env.AVG_PICKUP_MINUTES || "15"),
      avgDeliveryMinutes: Number(process.env.AVG_DELIVERY_MINUTES || "35"),
    },
    orders: {
      idLength: Number(process.env.ORDER_ID_LENGTH || "6"),
    },
  };
}

/** İsteğe bağlı: Ayarları KV’ye kaydet (admin için kullanışlı). */
export async function saveServerSettings(s: ServerSettings): Promise<void> {
  try {
    await DBA.write("server_settings", s);
  } catch {}
}
