const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = process.cwd();
const originalLoad = Module._load;
const originalResolveFilename = Module._resolveFilename;
const originalTsLoader = require.extensions[".ts"];

const state = {
  products: [],
  campaigns: [],
  coupons: [],
  issuedCoupons: [],
};

const prisma = {
  product: {
    findMany: async ({ where }) =>
      state.products.filter((row) => row.tenantId === where.tenantId),
  },
  campaign: {
    findMany: async ({ where }) =>
      state.campaigns.filter((row) => row.tenantId === where.tenantId),
  },
  coupon: {
    findMany: async ({ where }) =>
      state.coupons.filter((row) => row.tenantId === where.tenantId),
  },
  issuedCoupon: {
    findFirst: async ({ where }) =>
      state.issuedCoupons.find(
        (row) => row.tenantId === where.tenantId && row.code === where.code,
      ) || null,
    findMany: async ({ where }) =>
      state.issuedCoupons.filter(
        (row) =>
          row.tenantId === where.tenantId &&
          row.couponId === where.couponId &&
          (where.used === undefined || row.used === where.used),
      ),
  },
};

function resolveAlias(request) {
  if (request === "@/lib/freebies") return "virtual:freebies";
  if (!request.startsWith("@/")) return null;

  const base = path.join(root, request.slice(2));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
      strict: true,
    },
    fileName: filename,
    reportDiagnostics: true,
  });

  const errors = (output.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );

  if (errors.length) {
    throw new Error(
      errors
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
        .join("\n"),
    );
  }

  module._compile(output.outputText, filename);
};

Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  const alias = resolveAlias(request);
  if (alias) return alias;
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "virtual:freebies" || request === "@/lib/freebies") {
    return {
      evaluateFreebieRules: () => ({ totalFreeUnits: 0, grants: [] }),
      parseFreebieCategory: (value) => String(value || "sauces"),
    };
  }
  if (request === "@/lib/db") return { prisma };
  return originalLoad.call(this, request, parent, isMain);
};

function resetState() {
  state.products = [];
  state.campaigns = [];
  state.coupons = [];
  state.issuedCoupons = [];
}

function product(overrides = {}) {
  return {
    id: "product-1",
    tenantId: "tenant-1",
    sku: "BB-1",
    name: "Test Burger",
    category: "burger",
    price: 10,
    active: true,
    activeFrom: null,
    activeTo: null,
    extrasJson: [],
    ...overrides,
  };
}

async function expectPricingError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error && error.code, code);
    return true;
  });
}

async function main() {
  const {
    rebuildOrderPricingFromDatabase,
    rebuildOrderPricingFromVerifiedPayment,
  } = require(path.join(root, "lib/server/order-pricing.ts"));

  resetState();
  state.products.push(
    product({
      extrasJson: [
        {
          id: "cheese",
          sku: "cheese",
          name: "Käse",
          label: "Käse",
          price: 2,
        },
      ],
    }),
  );
  state.campaigns.push({
    id: "campaign-1",
    tenantId: "tenant-1",
    title: "10 Prozent",
    badgeText: "-10%",
    startsAt: null,
    endsAt: null,
    payload: {
      type: "percentOffProduct",
      percent: 10,
      productIds: ["product-1"],
      mode: "delivery",
      active: true,
    },
  });

  const deliverySettings = {
    lifa: { active: true, discountRate: 0.2 },
    delivery: { surcharges: { burger: 1 } },
    freebies: { enabled: false, rules: [] },
    routeDeals: { enabled: false, active: [] },
    pfand: { enabled: true },
  };

  const normal = await rebuildOrderPricingFromDatabase({
    tenantId: "tenant-1",
    settings: deliverySettings,
    now: new Date("2026-07-17T10:00:00.000Z"),
    order: {
      mode: "delivery",
      items: [
        {
          id: "product-1",
          sku: "BB-1",
          name: "Test Burger",
          category: "burger",
          price: 0.01,
          qty: 2,
          add: [{ id: "cheese", label: "Käse", price: 0.01 }],
        },
      ],
      merchandise: 22,
      discount: 4.4,
      surcharges: 2,
      couponDiscount: 0,
      total: 20.6,
      customer: { phone: "03012345678", zip: "13505" },
      meta: { payment: { tip: 1 } },
    },
  });

  assert.equal(normal.merchandiseCents, 2200);
  assert.equal(normal.discountCents, 440);
  assert.equal(normal.surchargesCents, 200);
  assert.equal(normal.tipCents, 100);
  assert.equal(normal.payableCents, 2060);
  assert.equal(normal.items[0].canonicalBasePrice, 9);
  assert.equal(normal.items[0].canonicalExtrasTotal, 2);
  assert.equal(normal.items[0].price, 11);
  assert.equal(normal.items[0].add[0].price, 2);

  assert.equal(normal.pricingAdjustment.changed, false);
  assert.equal(normal.pricingAdjustment.reason, "none");

  const breakdownOnly = await rebuildOrderPricingFromDatabase({
    tenantId: "tenant-1",
    settings: deliverySettings,
    now: new Date("2026-07-17T10:00:00.000Z"),
    order: {
      mode: "delivery",
      items: [
        {
          id: "product-1",
          sku: "BB-1",
          qty: 2,
          add: [{ id: "cheese", label: "Käse" }],
        },
      ],
      // Client muhasebesi kampanyayı indirim satırında gösterebilir.
      // Canonical server ise kampanyalı ürün fiyatını merchandise'a yazar.
      merchandise: 24,
      discount: 6.4,
      surcharges: 2,
      couponDiscount: 0,
      total: 20.6,
      customer: { phone: "03012345678", zip: "13505" },
      meta: { payment: { tip: 1 } },
    },
  });

  assert.equal(breakdownOnly.payableCents, 2060);
  assert.equal(breakdownOnly.pricingAdjustment.changed, true);
  assert.equal(breakdownOnly.pricingAdjustment.payableChanged, false);
  assert.equal(breakdownOnly.pricingAdjustment.breakdownChanged, true);
  assert.equal(breakdownOnly.pricingAdjustment.reason, "breakdown_only");

  await expectPricingError(
    rebuildOrderPricingFromDatabase({
      tenantId: "tenant-1",
      settings: deliverySettings,
      order: {
        mode: "delivery",
        items: [
          {
            sku: "BB-1",
            qty: 1,
            add: [{ id: "not-allowed", label: "Fake Extra", price: 0.01 }],
          },
        ],
        merchandise: 9,
        discount: 1.8,
        surcharges: 1,
        total: 8.2,
      },
    }),
    "CATALOG_EXTRA_NOT_FOUND",
  );

  const inactiveDiscount = await rebuildOrderPricingFromDatabase({
    tenantId: "tenant-1",
    settings: {
      ...deliverySettings,
      lifa: { active: false, discountRate: 0.9 },
    },
    order: {
      mode: "delivery",
      items: [{ id: "product-1", sku: "BB-1", qty: 1 }],
      merchandise: 9,
      discount: 0,
      surcharges: 1,
      total: 10,
      customer: { zip: "13505" },
    },
  });
  assert.equal(inactiveDiscount.discountCents, 0);
  assert.equal(inactiveDiscount.payableCents, 1000);

  const modernPickupRateWins = await rebuildOrderPricingFromDatabase({
    tenantId: "tenant-1",
    settings: {
      pickup: { discountRate: 0 },
      apollon: { active: true, discountRate: 0.1 },
      freebies: { enabled: false, rules: [] },
      routeDeals: { enabled: false, active: [] },
      pfand: { enabled: true },
    },
    order: {
      mode: "pickup",
      items: [{ id: "product-1", sku: "BB-1", qty: 1 }],
      merchandise: 10,
      discount: 0,
      surcharges: 0,
      total: 12,
      customer: { phone: "03012345678" },
      meta: { payment: { tip: 2 } },
    },
  });

  assert.equal(modernPickupRateWins.discountCents, 0);
  assert.equal(modernPickupRateWins.tipCents, 200);
  assert.equal(modernPickupRateWins.payableCents, 1200);

  resetState();
  state.products.push(product({ price: 20 }));
  state.coupons.push({
    id: "coupon-1",
    tenantId: "tenant-1",
    code: "SAVE10",
    definition: {
      id: "coupon-1",
      code: "SAVE10",
      type: "percent",
      value: 10,
      minCartTotal: 0,
      createdAt: Date.parse("2026-01-01T00:00:00.000Z"),
      validFrom: Date.parse("2026-01-01T00:00:00.000Z"),
    },
  });

  const couponPricing = await rebuildOrderPricingFromDatabase({
    tenantId: "tenant-1",
    settings: {
      apollon: { discountRate: 0 },
      pickup: { discountRate: 0 },
      freebies: { enabled: false, rules: [] },
      routeDeals: { enabled: false, active: [] },
      pfand: { enabled: true },
    },
    now: new Date("2026-07-17T10:00:00.000Z"),
    order: {
      mode: "pickup",
      items: [{ id: "product-1", sku: "BB-1", qty: 1 }],
      merchandise: 20,
      discount: 0,
      surcharges: 0,
      coupon: "SAVE10",
      couponDiscount: 2,
      total: 18,
      customer: { phone: "03012345678" },
    },
  });

  assert.equal(couponPricing.couponCode, "SAVE10");
  assert.equal(couponPricing.couponDiscountCents, 200);
  assert.equal(couponPricing.payableCents, 1800);

  resetState();
  const drinkSettings = {
    bb_drink_groups_v1: [
      {
        id: "cola-group",
        sku: "COLA",
        name: "Coca-Cola",
        variants: [
          {
            id: "033",
            name: "0,33 l",
            price: 2.5,
            active: true,
            pfandType: "einweg",
            pfandAmount: 0.25,
          },
        ],
      },
    ],
    apollon: { discountRate: 0 },
    pickup: { discountRate: 0 },
    freebies: { enabled: false, rules: [] },
    routeDeals: { enabled: false, active: [] },
    pfand: { enabled: true },
  };

  const drink = await rebuildOrderPricingFromDatabase({
    tenantId: "tenant-1",
    settings: drinkSettings,
    order: {
      mode: "pickup",
      items: [{ sku: "COLA-033", name: "Coca-Cola – 0,33 l", qty: 1 }],
      merchandise: 2.5,
      discount: 0,
      surcharges: 0.25,
      couponDiscount: 0,
      total: 2.8,
      customer: { phone: "03012345678" },
    },
  });

  assert.equal(drink.merchandiseCents, 250);
  assert.equal(drink.surchargesCents, 25);
  assert.equal(drink.payableCents, 280);
  assert.equal(drink.items[0].pfandAmount, 0.25);

  const manipulatedSubmittedPrice = await rebuildOrderPricingFromDatabase({
    tenantId: "tenant-1",
    settings: drinkSettings,
    order: {
      mode: "pickup",
      items: [{ sku: "COLA-033", qty: 1 }],
      merchandise: 0.01,
      discount: 0,
      surcharges: 0,
      total: 0.1,
    },
  });

  // Client fiyatı hiçbir zaman ödeme yetkisi değildir. Düşük gönderilen
  // fiyat reddedilmek yerine DB canonical toplamıyla güvenli şekilde ezilir.
  assert.equal(manipulatedSubmittedPrice.payableCents, 280);
  assert.equal(manipulatedSubmittedPrice.pricingAdjustment.changed, true);
  assert.equal(
    manipulatedSubmittedPrice.pricingAdjustment.payableChanged,
    true,
  );
  assert.equal(
    manipulatedSubmittedPrice.pricingAdjustment.reason,
    "canonical_reprice",
  );
  assert.equal(
    manipulatedSubmittedPrice.pricingAdjustment.canonical.total,
    2.8,
  );

  const paymentLocked = rebuildOrderPricingFromVerifiedPayment({
    mode: "delivery",
    items: manipulatedSubmittedPrice.items,
    merchandise: 2.5,
    discount: 0,
    surcharges: 0.25,
    couponDiscount: 0,
    total: 2.8,
    meta: {
      payment: {
        status: "paid",
        orderTotal: 2.8,
        tip: 0,
        pricing: manipulatedSubmittedPrice.pricingMeta,
        pricingAdjustment: manipulatedSubmittedPrice.pricingAdjustment,
      },
    },
  });

  assert.equal(paymentLocked.payableCents, 280);
  assert.equal(paymentLocked.pricingMeta.source, "payment_locked");
  assert.equal(paymentLocked.pricingMeta.pricingLocked, true);

  assert.throws(
    () =>
      rebuildOrderPricingFromVerifiedPayment({
        mode: "pickup",
        items: [{ id: "product-1", qty: 1 }],
        merchandise: 2.5,
        surcharges: 0.25,
        total: 2.8,
        meta: { payment: { orderTotal: 2.7 } },
      }),
    (error) => error && error.code === "PAYMENT_TOTAL_MISMATCH",
  );

  console.log("Order pricing tests passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
    Module._resolveFilename = originalResolveFilename;
    if (originalTsLoader) require.extensions[".ts"] = originalTsLoader;
    else delete require.extensions[".ts"];
  });
