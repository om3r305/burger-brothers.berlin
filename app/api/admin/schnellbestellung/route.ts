import { NextResponse } from "next/server";
import {
  getSchnellSettings,
  invalidateSchnellSessions,
  loadSchnellCatalogProducts,
  rotateStaticSchnellQr,
  saveSchnellSettings,
  schnellCategoryLabel,
} from "@/lib/server/schnellbestellung";
import {
  requireMutationRole,
  requireSessionRole,
} from "@/lib/server/request-security";

export async function GET(req: Request) {
  const auth = await requireSessionRole(req, "admin");
  if (auth) return auth;

  const settings = await getSchnellSettings({ includeTvPause: false });
  const products = await loadSchnellCatalogProducts(settings);

  return NextResponse.json(
    {
      ok: true,
      settings,
      catalog: products.map((product) => ({
        id: product.id,
        name: product.name,
        category: product.category,
        categoryLabel: schnellCategoryLabel(product.category),
        price: Number(product.price),
        sourceKind: product.sourceKind,
      })),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export async function PUT(req: Request) {
  const auth = await requireMutationRole(req, ["admin"]);
  if (auth) return auth;

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action || "").trim();

  if (action === "rotate_static_qr") {
    return NextResponse.json({
      ok: true,
      settings: await rotateStaticSchnellQr(),
    });
  }

  if (action === "invalidate_sessions") {
    return NextResponse.json({
      ok: true,
      settings: await invalidateSchnellSessions(),
    });
  }

  return NextResponse.json({
    ok: true,
    settings: await saveSchnellSettings(body.settings || body),
  });
}
