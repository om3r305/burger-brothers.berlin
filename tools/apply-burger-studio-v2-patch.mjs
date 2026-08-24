import fs from "node:fs";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function write(path, content) {
  fs.writeFileSync(path, content);
}

function replaceOnce(content, from, to, label) {
  const first = content.indexOf(from);
  if (first < 0) throw new Error(`Patch target not found: ${label}`);
  if (content.indexOf(from, first + from.length) >= 0) {
    throw new Error(`Patch target not unique: ${label}`);
  }
  return content.slice(0, first) + to + content.slice(first + from.length);
}

{
  const path = "app/api/catalog/route.ts";
  let source = read(path);

  source = replaceOnce(
    source,
    'import { requireMutationRole } from "@/lib/server/request-security";\n',
    'import { requireMutationRole } from "@/lib/server/request-security";\nimport { BURGER_STUDIO_SCRATCH_SKU } from "@/lib/burger-studio-v2";\n',
    "catalog scratch import",
  );

  source = replaceOnce(
    source,
    `      await db.product.deleteMany({\n        where: {\n          tenantId,\n          sku: {\n            notIn: Array.from(seenSkus),\n          },\n        },\n      });`,
    `      await db.product.deleteMany({\n        where: {\n          tenantId,\n          sku: {\n            notIn: Array.from(seenSkus),\n          },\n          NOT: {\n            sku: BURGER_STUDIO_SCRATCH_SKU,\n          },\n        },\n      });`,
    "catalog preserve scratch on replace",
  );

  source = replaceOnce(
    source,
    `  return {\n    products: products.map(serializeProduct),\n    campaigns: campaigns.map(serializeCampaign),\n  };`,
    `  return {\n    products: products\n      .filter(\n        (row: any) =>\n          String(row?.sku ?? \"\").trim() !== BURGER_STUDIO_SCRATCH_SKU,\n      )\n      .map(serializeProduct),\n    campaigns: campaigns.map(serializeCampaign),\n  };`,
    "catalog hide scratch product",
  );

  write(path, source);
}

{
  const path = "lib/server/order-pricing.ts";
  let source = read(path);

  source = replaceOnce(
    source,
    'import { findEligibleRouteDealForCustomer } from "@/lib/server/route-deal-eligibility";\n',
    'import { findEligibleRouteDealForCustomer } from "@/lib/server/route-deal-eligibility";\nimport { BURGER_STUDIO_SCRATCH_SKU } from "@/lib/burger-studio-v2";\nimport { validateBurgerStudioCanonicalSelection } from "@/lib/server/burger-studio-order-guard";\n',
    "pricing Burger Studio imports",
  );

  source = replaceOnce(
    source,
    `    const extras = resolveSelectedExtras(rawItem, catalogItem);\n    const campaignResult = campaignPriceCents(`,
    `    const extras = resolveSelectedExtras(rawItem, catalogItem);\n    const studioGuard = validateBurgerStudioCanonicalSelection({\n      rawItem,\n      catalogSku: catalogItem.sku,\n      resolvedExtras: extras,\n      settings: params.settings,\n      mode: params.mode,\n    });\n    if (!studioGuard.ok) {\n      throw new OrderPricingError(\n        studioGuard.code,\n        studioGuard.message,\n        409,\n      );\n    }\n\n    const campaignResult = campaignPriceCents(`,
    "pricing Studio guard",
  );

  source = replaceOnce(
    source,
    `      name: catalogItem.name,\n      description: rawItem?.description`,
    `      name:\n        catalogItem.sku === BURGER_STUDIO_SCRATCH_SKU && rawItem?.name\n          ? String(rawItem.name).slice(0, 120)\n          : catalogItem.name,\n      description: rawItem?.description`,
    "pricing preserve scratch creation name",
  );

  write(path, source);
}

console.log("Burger Studio V2 core patches applied.");
