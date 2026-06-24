// app/api/orders/list/route.ts
import { NextResponse } from "next/server";
import { readToday, updateStatus, StoredOrder } from "@/lib/server/db";

function effectiveStatus(o: StoredOrder, nowMs: number): StoredOrder["status"] {
  const totalMs = (o.etaMin || 0) * 60_000;
  const elapsed = Math.max(0, nowMs - (o.createdAt || nowMs));
  const remainMin = Math.max(0, Math.ceil((totalMs - elapsed) / 60_000));
  const progress = totalMs > 0 ? elapsed / totalMs : 0;

  if (o.mode === "pickup") {
    if (elapsed <= 60_000) return "received";
    if (progress < 0.6) return "preparing";
    if (progress < 1.0) return "ready";
    return "completed";
  } else {
    if (elapsed <= 60_000) return "received";
    if (progress < 0.5) return "preparing";
    if (remainMin <= 5 && remainMin > 0) return "delivered";
    if (progress < 1.0) return "on_the_way";
    return "completed";
  }
}

export async function GET() {
  const today = readToday();
  const now = Date.now();

  const withEff = today.map((o) => {
    const eff = effectiveStatus(o as StoredOrder, now);
    if (eff === "completed" && o.status !== "completed") {
      updateStatus(o.id, "completed");
    }
    return { ...o, statusEff: eff };
  });

  const active = withEff.filter((o: any) => o.statusEff !== "completed");
  const done = withEff.filter((o: any) => o.statusEff === "completed");

  return NextResponse.json({
    tz: "Europe/Berlin",
    now,
    counts: {
      lieferando: withEff.filter((o: any) => o.channel === "liferando" || o.channel === "lieferando").length,
      apollo: withEff.filter((o: any) => o.channel === "apollo").length,
      web: withEff.filter((o: any) => o.channel === "web").length,
      active: active.length,
      done: done.length,
    },
    orders: active,
  });
}
