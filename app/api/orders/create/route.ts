// app/api/orders/create/route.ts
import { NextResponse } from "next/server";
import { upsert, StoredOrder } from "@/lib/server/db";
import { generateOrderId } from "@/lib/order-id";
import { getServerSettings } from "@/lib/server/settings";
import { sendTelegramNewOrder } from "@/lib/telegram";

export async function POST(req: Request) {
  try {
    const { order, notify } = await req.json();

    const settings = getServerSettings();
    const id = generateOrderId(settings.orders?.idLength || 6);
    const avgPickup = settings.hours?.avgPickupMinutes ?? 15;
    const avgDelivery = settings.hours?.avgDeliveryMinutes ?? 35;
    const etaMin = order?.mode === "pickup" ? avgPickup : avgDelivery;

    const source: "lieferando" | "apollo" | "web" =
      (order?.source === "lieferando" || order?.source === "apollo") ? order.source : "web";

    const stored: StoredOrder = {
      id,
      status: "received",
      createdAt: Date.now(),
      etaMin,
      mode: order?.mode === "pickup" ? "pickup" : "delivery",
      channel: source as any,
      order,
    };

    upsert(stored);

    if (notify) {
      await sendTelegramNewOrder({
        id,
        mode: stored.mode,
        items: (order?.items || []).map((ci: any) => ({
          name: ci?.name || "Artikel",
          qty: ci?.qty || 1,
          price: ci?.price,
          category: ci?.category,
          add: Array.isArray(ci?.add) ? ci.add : undefined,
          rm: Array.isArray(ci?.rm) ? ci.rm : undefined,
          note: ci?.note,
        })),
        totals: {
          merchandise: Number(order?.merchandise || 0),
          discount: Number(order?.discount || 0),
          coupon: order?.coupon || null,
          couponDiscount: Number(order?.couponDiscount || 0),
          surcharges: Number(order?.surcharges || 0),
          total: Number(order?.total || 0),
        },
        customer: {
          name: order?.customer?.name,
          phone: order?.customer?.phone,
          address: order?.customer?.address,
        },
        planned: order?.planned,
      });
    }

    return NextResponse.json({ id, etaMin });
  } catch (e) {
    console.error("create order error", e);
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
}
