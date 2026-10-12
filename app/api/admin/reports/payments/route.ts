import { NextResponse } from "next/server";
import { requireSessionRole } from "@/lib/server/request-security";
import { getStripeClient, stripeModeLabel } from "@/lib/server/stripe-client";
import { berlinDateKey, reportRange } from "@/lib/reporting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const headers = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const authError = await requireSessionRole(req, "admin");
  if (authError) return authError;
  const query = new URL(req.url).searchParams;
  let range;
  try {
    range = reportRange(query.get("period") || "day", query.get("date") || berlinDateKey());
  } catch {
    return NextResponse.json({ ok: false, error: "Geçerli bir tarih ve dönem seçin." }, { status: 400, headers });
  }
  const cursor = query.get("cursor") || "";
  if (cursor && !/^txn_[a-zA-Z0-9]{1,100}$/.test(cursor)) {
    return NextResponse.json({ ok: false, error: "Geçersiz sayfa." }, { status: 400, headers });
  }
  try {
    const stripe = getStripeClient();
    const page = await stripe.balanceTransactions.list({
      created: { gte: Math.floor(range.from.getTime() / 1000), lt: Math.floor(range.to.getTime() / 1000) },
      currency: "eur", limit: 100, ...(cursor ? { starting_after: cursor } : {}),
      expand: ["data.source"],
    });
    const rows = page.data.map((item) => {
      const source = item.source && typeof item.source === "object" ? item.source : null;
      const charge = source?.object === "charge" ? source : null;
      const details = charge?.payment_method_details;
      const wallet = details?.card?.wallet?.type;
      return { id: item.id, created: item.created, type: item.type, amount: item.amount,
        fee: item.fee, net: item.net, status: item.status,
        sourceId: typeof item.source === "string" ? item.source : source?.id || "",
        method: wallet || details?.type || "—" };
    });
    return NextResponse.json({ ok: true, mode: stripeModeLabel(), currency: "eur", rows,
      nextCursor: page.has_more ? page.data[page.data.length - 1]?.id : null,
      generatedAt: new Date().toISOString() }, { headers });
  } catch (error) {
    console.error("[reports/payments]", error instanceof Error ? error.message : "stripe_failed");
    return NextResponse.json({ ok: false, error: "Stripe kesinti kayıtları alınamadı. Yeniden deneyin." }, { status: 502, headers });
  }
}
