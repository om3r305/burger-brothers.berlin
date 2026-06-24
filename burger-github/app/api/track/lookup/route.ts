
import { NextResponse } from "next/server";
import { getOrder } from "@/lib/ordersStore";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const code = (body?.code || "").trim().toUpperCase();
    if (!code) return NextResponse.json({ ok: false, error: "code_required" }, { status: 400 });
    const order = getOrder(code);
    if (!order) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, order });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
}
