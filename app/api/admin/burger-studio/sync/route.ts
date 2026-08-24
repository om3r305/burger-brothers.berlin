import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import { normalizeBurgerStudioConfig } from "@/lib/burger-studio";
import { requireMutationRole } from "@/lib/server/request-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STUDIO_PREFIX = "bstudio:";

function key(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function money(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.round(number * 100) / 100)
    : 0;
}

function existingExtras(value: unknown) {
  if (!Array.isArray(value)) return [] as any[];
  return value.filter((entry) => {
    const id = String((entry as any)?.id ?? (entry as any)?.sku ?? "").trim();
    return !id.startsWith(STUDIO_PREFIX);
  });
}

function studioExtrasForTemplate(config: ReturnType<typeof normalizeBurgerStudioConfig>, template: any) {
  const ingredients = config.ingredients.filter((ingredient) => ingredient.active);
  const ingredientMap = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
  const extras: Array<Record<string, unknown>> = [
    {
      id: "bstudio:marker",
      sku: "bstudio:marker",
      name: "🔥 EIGENE KREATION",
      label: "🔥 EIGENE KREATION",
      price: 0,
    },
  ];

  for (const ingredient of ingredients) {
    if (ingredient.group === "bun" && ingredient.addPrice <= 0) continue;
    extras.push({
      id: `bstudio:add:${ingredient.id}`,
      sku: `bstudio:add:${ingredient.id}`,
      name: ingredient.name,
      label: ingredient.name,
      price: money(ingredient.addPrice),
    });
  }

  for (const [sourceId, rawQty] of Object.entries(template.recipe || {})) {
    const source = ingredientMap.get(sourceId);
    const sourceQty = Math.max(0, Math.round(Number(rawQty) || 0));
    if (!source || sourceQty <= 0 || source.removeCredit <= 0) continue;

    for (const target of ingredients) {
      if (target.id === source.id || target.group !== source.group) continue;
      extras.push({
        id: `bstudio:replace:${source.id}:${target.id}`,
        sku: `bstudio:replace:${source.id}:${target.id}`,
        name: target.name,
        label: `${target.name} statt ${source.name}`,
        price: money(Math.max(0, target.addPrice - source.removeCredit)),
      });
    }
  }

  return Array.from(
    new Map(extras.map((extra) => [String(extra.id), extra])).values(),
  );
}

export async function POST(req: Request) {
  const authError = await requireMutationRole(req, ["admin"]);
  if (authError) return authError;

  try {
    const body = await req.json().catch(() => ({}));
    const config = normalizeBurgerStudioConfig(body?.config ?? body);
    const tenantId = await getTenantId();
    const products = await prisma.product.findMany({
      where: { tenantId },
      select: {
        id: true,
        sku: true,
        name: true,
        extrasJson: true,
      },
    });

    const productByRef = new Map<string, (typeof products)[number]>();
    for (const product of products) {
      for (const alias of [product.id, product.sku, product.name]) {
        const normalized = key(alias);
        if (normalized && !productByRef.has(normalized)) {
          productByRef.set(normalized, product);
        }
      }
    }

    const extrasByProductId = new Map<string, Array<Record<string, unknown>>>();
    const missingTemplates: string[] = [];

    for (const template of config.templates.filter((item) => item.active)) {
      const product = productByRef.get(key(template.productRef));
      if (!product) {
        missingTemplates.push(template.name);
        continue;
      }
      const generated = studioExtrasForTemplate(config, template);
      const previous = extrasByProductId.get(product.id) || [];
      extrasByProductId.set(
        product.id,
        Array.from(
          new Map([...previous, ...generated].map((extra) => [String(extra.id), extra])).values(),
        ),
      );
    }

    if (missingTemplates.length) {
      return NextResponse.json(
        {
          ok: false,
          error: "BURGER_STUDIO_TEMPLATE_PRODUCT_NOT_FOUND",
          message: `Menü ürünü bulunamayan şablonlar: ${missingTemplates.join(", ")}`,
        },
        { status: 409 },
      );
    }

    let updated = 0;
    await prisma.$transaction(async (tx) => {
      for (const product of products) {
        const cleanExisting = existingExtras(product.extrasJson);
        const generated = extrasByProductId.get(product.id) || [];
        const nextExtras = [...cleanExisting, ...generated];
        const hadStudioExtras = Array.isArray(product.extrasJson)
          ? product.extrasJson.some((entry: any) =>
              String(entry?.id ?? entry?.sku ?? "").startsWith(STUDIO_PREFIX),
            )
          : false;

        if (!generated.length && !hadStudioExtras) continue;

        await tx.product.update({
          where: { id: product.id },
          data: {
            extrasJson: nextExtras.length
              ? (JSON.parse(JSON.stringify(nextExtras)) as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          },
        });
        updated += 1;
      }
    });

    return NextResponse.json({
      ok: true,
      updated,
      templateCount: config.templates.filter((item) => item.active).length,
    });
  } catch (error) {
    console.error("[burger-studio/sync]", error);
    return NextResponse.json(
      { ok: false, error: "BURGER_STUDIO_SYNC_FAILED" },
      { status: 500 },
    );
  }
}
