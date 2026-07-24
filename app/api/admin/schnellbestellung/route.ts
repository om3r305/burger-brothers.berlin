import { NextResponse } from "next/server";
import { prisma, getTenantId } from "@/lib/db";
import {
  getSchnellSettings,
  invalidateSchnellSessions,
  normalizeSchnellCategory,
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

  const tenantId = await getTenantId();
  const products = await prisma.product.findMany({
    where: { tenantId, active: true },
    orderBy: [{ category: "asc" }, { order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      category: true,
      price: true,
    },
  });

  return NextResponse.json(
    {
      ok: true,
      settings: await getSchnellSettings({ includeTvPause: false }),
      catalog: products.map((product) => {
        const category = normalizeSchnellCategory(product.category);
        return {
          id: product.id,
          name: product.name,
          category,
          categoryLabel: schnellCategoryLabel(category),
          price: Number(product.price),
        };
      }),
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
