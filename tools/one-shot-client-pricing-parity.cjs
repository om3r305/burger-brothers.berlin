const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function write(relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf8");
}

function replaceExact(source, search, replacement, expectedCount, label) {
  const count = source.split(search).length - 1;
  assert.equal(
    count,
    expectedCount,
    `${label}: expected ${expectedCount} occurrence(s), found ${count}`,
  );
  return source.split(search).join(replacement);
}

function patchCartSummary() {
  const file = "components/CartSummary.tsx";
  let source = read(file);

  source = replaceExact(
    source,
    'import { evaluateConditionalCartCampaign } from "@/lib/conditional-campaign";\n',
    'import { evaluateConditionalCartCampaign } from "@/lib/conditional-campaign";\nimport { roundCurrencyCents, standardSurchargeDiscount } from "@/lib/pricing/client-order-pricing";\n',
    1,
    "CartSummary pricing helper import",
  );

  source = replaceExact(
    source,
    `function roundToNearest10Cents(value: any) {\n  const number = Number(value);\n  if (!Number.isFinite(number)) return 0;\n\n  return +(Math.round((number + Number.EPSILON) * 10) / 10).toFixed(2);\n}`,
    `function roundToNearest10Cents(value: any) {\n  // Legacy function name kept to minimize surface change; values now stay exact to cents.\n  return roundCurrencyCents(value);\n}`,
    1,
    "CartSummary ten-cent rounding",
  );

  source = replaceExact(
    source,
    `  const discount = +(\n    deliveryDiscount + freebie.discountedAmount\n  ).toFixed(2);\n\n`,
    ``,
    1,
    "CartSummary pre-surcharge discount",
  );

  source = replaceExact(
    source,
    `  surcharges = +surcharges.toFixed(2);\n\n  const afterDiscount = +Math.max(0, merchandise - discount).toFixed(2);\n  const pfandSummary = computePfand(items);\n  const pfand = pfandSummary.amount;\n  const totalPreCoupon = +(afterDiscount + surcharges + pfand).toFixed(2);`,
    `  surcharges = roundCurrencyCents(surcharges);\n\n  // Campaign eligibility remains merchandise-only. Once its effective rate is\n  // known, the same percentage also applies to the delivery category surcharge.\n  // Pfand and tips stay outside this discount base, matching canonical server pricing.\n  const surchargeDiscount = standardSurchargeDiscount(\n    surcharges,\n    conditionalCampaign.effectiveRate,\n  );\n  const discount = roundCurrencyCents(\n    deliveryDiscount + surchargeDiscount + freebie.discountedAmount,\n  );\n  const afterDiscount = roundCurrencyCents(\n    Math.max(0, merchandise - deliveryDiscount - freebie.discountedAmount),\n  );\n  const netSurcharges = roundCurrencyCents(\n    Math.max(0, surcharges - surchargeDiscount),\n  );\n  const pfandSummary = computePfand(items);\n  const pfand = pfandSummary.amount;\n  const totalPreCoupon = roundCurrencyCents(\n    afterDiscount + netSurcharges + pfand,\n  );`,
    1,
    "CartSummary surcharge discount calculation",
  );

  source = replaceExact(
    source,
    `    merchandise,\n    discount,\n    surcharges,\n    afterDiscount,\n    totalPreCoupon,`,
    `    merchandise,\n    discount,\n    surcharges,\n    netSurcharges,\n    surchargeDiscount,\n    afterDiscount,\n    totalPreCoupon,`,
    1,
    "CartSummary pricing return fields",
  );

  source = replaceExact(
    source,
    `  const { merchandise, discount, surcharges, afterDiscount, pfand, requiredMin, plzKnown, conditionalCampaign } = base;`,
    `  const { merchandise, discount, surcharges, netSurcharges, afterDiscount, pfand, requiredMin, plzKnown, conditionalCampaign } = base;`,
    2,
    "CartSummary pricing destructuring",
  );

  source = replaceExact(
    source,
    `  const routeDealBaseTotal = +((afterDiscount - couponAmount) + surcharges).toFixed(2);`,
    `  const routeDealBaseTotal = roundCurrencyCents((afterDiscount - couponAmount) + netSurcharges);`,
    2,
    "CartSummary route deal base",
  );

  source = replaceExact(
    source,
    `        deliverySurcharges: surcharges,`,
    `        deliverySurcharges: netSurcharges,`,
    2,
    "CartSummary route deal delivery surcharge",
  );

  write(file, source);
}

function patchCheckout() {
  const file = "app/checkout/page.tsx";
  let source = read(file);

  source = replaceExact(
    source,
    'import { evaluateConditionalCartCampaign } from "@/lib/conditional-campaign";\n',
    'import { evaluateConditionalCartCampaign } from "@/lib/conditional-campaign";\nimport { roundCurrencyCents, standardSurchargeDiscount } from "@/lib/pricing/client-order-pricing";\n',
    1,
    "Checkout pricing helper import",
  );

  source = replaceExact(
    source,
    `function roundToNearest10Cents(value: unknown) {\n  const n = Number(value);\n  if (!Number.isFinite(n)) return 0;\n\n  return +(Math.round((n + Number.EPSILON) * 10) / 10).toFixed(2);\n}`,
    `function roundToNearest10Cents(value: unknown) {\n  // Legacy function name kept to minimize surface change; values now stay exact to cents.\n  return roundCurrencyCents(value);\n}`,
    1,
    "Checkout ten-cent rounding",
  );

  source = replaceExact(
    source,
    `  const discount = +(\n    deliveryDiscount + freebie.discountedAmount\n  ).toFixed(2);\n\n  const afterDiscount = +Math.max(0, merchandise - discount).toFixed(2);\n  const pfandSummary = computePfand(items);\n  const pfand = pfandSummary.amount;\n\n`,
    ``,
    1,
    "Checkout pre-surcharge discount",
  );

  source = replaceExact(
    source,
    `  surcharges = +surcharges.toFixed(2);\n\n  const totalPreCoupon = +(afterDiscount + surcharges + pfand).toFixed(2);`,
    `  surcharges = roundCurrencyCents(surcharges);\n\n  // Keep cart-offer thresholds merchandise-only, but apply the resolved\n  // percentage to the delivery category surcharge as the POS does.\n  const surchargeDiscount = standardSurchargeDiscount(\n    surcharges,\n    conditionalCampaign.effectiveRate,\n  );\n  const discount = roundCurrencyCents(\n    deliveryDiscount + surchargeDiscount + freebie.discountedAmount,\n  );\n  const afterDiscount = roundCurrencyCents(\n    Math.max(0, merchandise - deliveryDiscount - freebie.discountedAmount),\n  );\n  const netSurcharges = roundCurrencyCents(\n    Math.max(0, surcharges - surchargeDiscount),\n  );\n  const pfandSummary = computePfand(items);\n  const pfand = pfandSummary.amount;\n  const totalPreCoupon = roundCurrencyCents(\n    afterDiscount + netSurcharges + pfand,\n  );`,
    1,
    "Checkout surcharge discount calculation",
  );

  source = replaceExact(
    source,
    `  return {\n    merchandise,\n    discount,\n    afterDiscount,\n    surcharges,\n    pfand,\n    pfandLines: pfandSummary.lines,`,
    `  return {\n    merchandise,\n    discount,\n    afterDiscount,\n    surcharges,\n    netSurcharges,\n    surchargeDiscount,\n    pfand,\n    pfandLines: pfandSummary.lines,`,
    1,
    "Checkout pricing return fields",
  );

  source = replaceExact(
    source,
    `  const {\n    merchandise,\n    discount,\n    afterDiscount,\n    surcharges,\n    pfand,\n    requiredMin,\n    plzKnown,\n  } = base;`,
    `  const {\n    merchandise,\n    discount,\n    afterDiscount,\n    surcharges,\n    netSurcharges,\n    pfand,\n    requiredMin,\n    plzKnown,\n  } = base;`,
    1,
    "Checkout pricing destructuring",
  );

  source = replaceExact(
    source,
    `  const routeDealBaseTotal = +((afterDiscount - couponAmount) + surcharges).toFixed(2);`,
    `  const routeDealBaseTotal = roundCurrencyCents((afterDiscount - couponAmount) + netSurcharges);`,
    1,
    "Checkout route deal base",
  );

  source = replaceExact(
    source,
    `    const latestRouteDealBaseTotal = +((afterDiscount - latestCouponAmount) + surcharges).toFixed(2);`,
    `    const latestRouteDealBaseTotal = roundCurrencyCents((afterDiscount - latestCouponAmount) + netSurcharges);`,
    1,
    "Checkout latest route deal base",
  );

  source = replaceExact(
    source,
    `        deliverySurcharges: surcharges,`,
    `        deliverySurcharges: netSurcharges,`,
    1,
    "Checkout live route deal delivery surcharge",
  );

  source = replaceExact(
    source,
    `      deliverySurcharges: surcharges,`,
    `      deliverySurcharges: netSurcharges,`,
    1,
    "Checkout submit route deal delivery surcharge",
  );

  write(file, source);
}

function writeSharedHelper() {
  write(
    "lib/pricing/client-order-pricing.ts",
    `function finiteNumber(value: unknown, fallback = 0) {\n  const number = Number(value);\n  return Number.isFinite(number) ? number : fallback;\n}\n\n/** Round only to the currency cent. Never normalize order totals to 0.10 EUR. */\nexport function roundCurrencyCents(value: unknown) {\n  const number = finiteNumber(value, 0);\n  return +(Math.round((number + Number.EPSILON) * 100) / 100).toFixed(2);\n}\n\n/**\n * Standard/cart-offer eligibility is resolved from merchandise elsewhere.\n * This applies that already-resolved rate to the gross delivery category\n * surcharge, excluding Pfand and tip.\n */\nexport function standardSurchargeDiscount(\n  grossSurcharge: unknown,\n  effectiveRate: unknown,\n) {\n  const gross = roundCurrencyCents(Math.max(0, finiteNumber(grossSurcharge, 0)));\n  const rate = Math.max(0, Math.min(0.9999, finiteNumber(effectiveRate, 0)));\n  return Math.min(gross, roundCurrencyCents(gross * rate));\n}\n`,
  );
}

function writeRegressionTest() {
  write(
    "tools/client-pricing-parity-tests.cjs",
    `const assert = require("node:assert/strict");\nconst fs = require("node:fs");\nconst path = require("node:path");\nconst ts = require("typescript");\n\nconst root = process.cwd();\nconst helperFile = path.join(root, "lib/pricing/client-order-pricing.ts");\nconst source = fs.readFileSync(helperFile, "utf8");\nconst output = ts.transpileModule(source, {\n  compilerOptions: {\n    target: ts.ScriptTarget.ES2022,\n    module: ts.ModuleKind.CommonJS,\n    strict: true,\n  },\n  fileName: helperFile,\n  reportDiagnostics: true,\n});\nconst errors = (output.diagnostics || []).filter(\n  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,\n);\nassert.equal(errors.length, 0, errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\\n")).join("\\n"));\n\nconst moduleShim = { exports: {} };\nnew Function("module", "exports", output.outputText)(moduleShim, moduleShim.exports);\nconst { roundCurrencyCents, standardSurchargeDiscount } = moduleShim.exports;\n\nassert.equal(roundCurrencyCents(20.25), 20.25);\nassert.equal(roundCurrencyCents(20.45), 20.45);\nassert.equal(standardSurchargeDiscount(2, 0.1), 0.2);\n\nconst merchandise = 20.5;\nconst merchandiseDiscount = roundCurrencyCents(merchandise * 0.1);\nconst grossSurcharge = 2;\nconst surchargeDiscount = standardSurchargeDiscount(grossSurcharge, 0.1);\nconst netSurcharge = roundCurrencyCents(grossSurcharge - surchargeDiscount);\nconst payable = roundCurrencyCents(merchandise - merchandiseDiscount + netSurcharge);\nassert.equal(merchandiseDiscount + surchargeDiscount, 2.25);\nassert.equal(payable, 20.25);\n\nfor (const relativePath of ["components/CartSummary.tsx", "app/checkout/page.tsx"]) {\n  const clientSource = fs.readFileSync(path.join(root, relativePath), "utf8");\n  assert.match(clientSource, /standardSurchargeDiscount/);\n  assert.match(clientSource, /netSurcharges/);\n  assert.doesNotMatch(clientSource, /Math\\.round\\(\\([^\\n]+\\) \\* 10\\) \\/ 10/);\n}\n\nconsole.log("Client pricing parity tests passed.");\n`,
  );
}

function patchPackageJson() {
  const file = "package.json";
  const pkg = JSON.parse(read(file));
  const pricingTest = "node tools/order-pricing-tests.cjs && node tools/client-pricing-parity-tests.cjs";
  pkg.scripts["pricing:test"] = pricingTest;

  const security = String(pkg.scripts["security:test"] || "");
  if (!security.includes("node tools/client-pricing-parity-tests.cjs")) {
    assert.ok(
      security.includes("node tools/order-pricing-tests.cjs"),
      "security:test must contain order-pricing-tests.cjs",
    );
    pkg.scripts["security:test"] = security.replace(
      "node tools/order-pricing-tests.cjs",
      "node tools/order-pricing-tests.cjs && node tools/client-pricing-parity-tests.cjs",
    );
  }

  write(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

patchCartSummary();
patchCheckout();
writeSharedHelper();
writeRegressionTest();
patchPackageJson();

console.log("Client pricing parity patch applied successfully.");
