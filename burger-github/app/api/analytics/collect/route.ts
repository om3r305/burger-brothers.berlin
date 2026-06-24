// app/api/analytics/collect/route.ts
import { NextResponse } from "next/server";

/**
 * Basit telemetry kolektörü.
 * PII içermeyen event’leri kabul eder ve no-op döner.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    // Burada bir veri gölüne/queue'ya yazabilirsiniz. Demo: konsola bas.
    console.log("[analytics]", {
      ts: Date.now(),
      ua: (req.headers.get("user-agent") || "").slice(0, 120),
      event: body?.event || "unknown",
      props: body?.props || {},
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Unhandled error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  // Basit healthcheck
  return NextResponse.json({ ok: true, message: "analytics ok" });
}
