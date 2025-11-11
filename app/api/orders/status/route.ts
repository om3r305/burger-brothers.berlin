// app/api/orders/status/route.ts
import { NextResponse } from "next/server";
import { getById, readAll, writeAll, updateStatus } from "@/lib/server/db";

export async function POST(req: Request) {
  try {
    const { id, status } = (await req.json()) as { id: string; status: string };
    if (!id) return NextResponse.json({ error: "bad_request" }, { status: 400 });

    const allowed = new Set(["received","preparing","ready","on_the_way","delivered","completed"]);
    const s = String(status || "").toLowerCase();
    if (!allowed.has(s)) return NextResponse.json({ error: "invalid_status" }, { status: 400 });

    const prev = getById(id);
    if (!prev) return NextResponse.json({ error: "not_found" }, { status: 404 });

    if (s === "completed") {
      updateStatus(id, "completed");
    } else {
      const list = readAll();
      const idx = list.findIndex((x) => x.id === id);
      if (idx >= 0) {
        (list[idx] as any).statusManual = s;
        (list[idx] as any).updatedAt = Date.now();
        writeAll(list);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
}
