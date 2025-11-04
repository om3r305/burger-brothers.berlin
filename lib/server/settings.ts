// lib/server/settings.ts
import fs from "fs";
import { DBA } from "@/lib/server/db";
import path from "path";

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

export async function getServerSettings(): ServerSettings {
  const candidates = [
    path.join(process.cwd(), ".data", "settings.json"),
    path.join(process.cwd(), "data", "settings.json"),
    "/tmp/settings.json",
  ];

  for (const p of candidates) {
    const obj = safeJSON(p);
    if (obj) return obj as ServerSettings;
  }

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
