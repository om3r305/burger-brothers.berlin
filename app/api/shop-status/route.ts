import { NextResponse } from "next/server";
import { getShopStatusFresh } from "@/lib/server/shop-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export async function GET() {
  try {
    const status = await getShopStatusFresh();
    return NextResponse.json(
      {
        ok: true,
        ...status,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error: any) {
    console.error("[shop-status:GET]", error);

    // Fail closed. Admin routes never depend on this endpoint, so a temporary
    // DB/status failure cannot accidentally reopen the customer/operation UI.
    return NextResponse.json(
      {
        ok: false,
        closed: true,
        message: "Der Online-Shop ist vorübergehend nicht verfügbar.",
        maintenanceStart: "",
        maintenanceEnd: "",
      },
      {
        status: 503,
        headers: NO_STORE_HEADERS,
      },
    );
  }
}
