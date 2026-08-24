import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma, getTenantId } from "@/lib/db";
import {
  BURGER_STUDIO_SCRATCH_NAME,
  BURGER_STUDIO_SCRATCH_SKU,
  normalizeBurgerStudioV2Config,
} from "@/lib/burger-studio-v2";
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

function studioExtras(
  config: ReturnType<typeof normalizeBurgerStudioV2Config>,
) {
  const extras: Array<Record<string, unknown>> = [
    {
      id: "bstudio:marker",
      sku: "bstudio:marker",
      name: "🔥 EIGENE KREATION",
      label: "🔥 EIGENE KREATION",
      price: 0,
    },
  ];

  for (const ingredient of config.ingredients.filter((item) => item.active)) {
    extras.push({
      id: `bstudio:add:${ingredient.id}`,
      sku: `bstudio:add:${ingredient.id}`,
      name: ingredient.name,
      label: ingredient.name,
      price: money(ingredient.addPrice),
    });
  }

  return Array.from(
    new Map(extras.map((extra) => [String(extra.id), extra])).values(),
  );
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function POST(req: Request) {
  const authError = await requireMutationRole(req, ["admin"]);
  if (authError) return authError;

  try {
    const body = await req.json().catch(() => ({}));
    const config = normalizeBurgerStudioV2Config(body?.config ?? body);
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
      if (product.sku === BURGER_STUDIO_SCRATCH_SKU) continue;
      for (const alias of [product.id, product.sku, product.name]) {
        const normalized = key(alias);
        if (normalized && !productByRef.has(normalized)) {
          productByRef.set(normalized, product);
        }
      }
    }

    const generated = studioExtras(config);
    const extrasByProductId = new Map<string, Array<Record<string, unknown>>>();
    const missingTemplates: string[] = [];
    const activeTemplates = config.enabled
      ? config.templates.filter((item) => item.active)
      : [];

    for (const template of activeTemplates) {
      const product = productByRef.get(key(template.productRef));
      if (!product) {
        missingTemplates.push(template.name);
        continue;
      }
      const previous = extrasByProductId.get(product.id) || [];
      extrasByProductId.set(
        product.id,
        Array.from(
          new Map(
            [...previous, ...generated].map((extra) => [String(extra.id), extra]),
          ).values(),
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

    const scratchActive = config.enabled && config.scratchEnabled;
    let updated = 0;

    await prisma.$transaction(async (tx) => {
      const currentScratch = products.find(
        (product) => product.sku === BURGER_STUDIO_SCRATCH_SKU,
      );
      const scratchData = {
        name: BURGER_STUDIO_SCRATCH_NAME,
        description:
          "Internal canonical Burger Studio base. Nicht als normales Menüprodukt anzeigen.",
        category: "burger",
        price: new Prisma.Decimal(money(config.scratchBasePrice)),
        taxRate: 7,
        active: scratchActive,
        activeFrom: null,
        activeTo: null,
        extrasJson: scratchActive ? jsonValue(generated) : Prisma.JsonNull,
        order: 99999,
      };

      if (currentScratch) {
        await tx.product.update({
          where: { id: currentScratch.id },
          data: scratchData,
        });
      } else {
        await tx.product.create({
          data: {
            tenantId,
            sku: BURGER_STUDIO_SCRATCH_SKU,
            ...scratchData,
          },
        });
      }
      updated += 1;

      for (const product of products) {
        if (product.sku === BURGER_STUDIO_SCRATCH_SKU) continue;
        const cleanExisting = existingExtras(product.extrasJson);
        const productGenerated = extrasByProductId.get(product.id) || [];
        const nextExtras = [...cleanExisting, ...productGenerated];
        const hadStudioExtras = Array.isArray(product.extrasJson)
          ? product.extrasJson.some((entry: any) =>
              String(entry?.id ?? entry?.sku ?? "").startsWith(STUDIO_PREFIX),
            )
          : false;

        if (!productGenerated.length && !hadStudioExtras) continue;

        await tx.product.update({
          where: { id: product.id },
          data: {
            extrasJson: nextExtras.length
              ? jsonValue(nextExtras)
              : Prisma.JsonNull,
          },
        });
        updated += 1;
      }
    });

    return NextResponse.json({
      ok: true,
      updated,
      templateCount: activeTemplates.length,
      scratchReady: scratchActive,
      scratchSku: BURGER_STUDIO_SCRATCH_SKU,
    });
  } catch (error) {
    console.error("[burger-studio/sync]", error);
    return NextResponse.json(
      { ok: false, error: "BURGER_STUDIO_SYNC_FAILED" },
      { status: 500 },
    );
  }
}
