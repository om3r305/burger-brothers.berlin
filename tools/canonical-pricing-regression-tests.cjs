const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = process.cwd();
const originalTsLoader = require.extensions[".ts"];

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
        .map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        )
        .join("\n"),
    );
  }

  module._compile(output.outputText, filename);
};

try {
  const { canonicalizeSplitShares } = require(
    path.join(root, "lib/server/split-pricing.ts"),
  );

  const unchanged = canonicalizeSplitShares({
    raw: [
      { label: "Person 1", baseAmountCents: 600, items: [{ key: "a", label: "A" }] },
      { label: "Person 2", baseAmountCents: 400, items: [{ key: "b", label: "B" }] },
    ],
    payableCents: 1000,
    serviceFeeCents: 20,
    maxPeople: 8,
  });

  assert.equal(unchanged.adjusted, false);
  assert.deepEqual(
    unchanged.shares.map((share) => share.baseAmountCents),
    [600, 400],
  );
  assert.equal(
    unchanged.shares.reduce((sum, share) => sum + share.amountCents, 0),
    1040,
  );

  const repriced = canonicalizeSplitShares({
    raw: [
      { label: "Person 1", baseAmountCents: 600, items: [{ key: "a", label: "A" }] },
      { label: "Person 2", baseAmountCents: 400, items: [{ key: "b", label: "B" }] },
    ],
    payableCents: 1030,
    serviceFeeCents: 20,
    maxPeople: 8,
  });

  assert.equal(repriced.adjusted, true);
  assert.equal(repriced.submittedBaseTotalCents, 1000);
  assert.equal(repriced.canonicalBaseTotalCents, 1030);
  assert.equal(repriced.differenceCents, 30);
  assert.equal(
    repriced.shares.reduce((sum, share) => sum + share.baseAmountCents, 0),
    1030,
  );
  assert.deepEqual(
    repriced.shares.map((share) => share.items[0].key),
    ["a", "b"],
  );


  const orderPricingSource = fs.readFileSync(
    path.join(root, "lib/server/order-pricing.ts"),
    "utf8",
  );
  const prepareSource = fs.readFileSync(
    path.join(root, "app/api/payments/prepare/route.ts"),
    "utf8",
  );
  const checkoutSource = fs.readFileSync(
    path.join(root, "app/checkout/page.tsx"),
    "utf8",
  );
  const checkoutTypesSource = fs.readFileSync(
    path.join(root, "types/checkout.ts"),
    "utf8",
  );
  const securityTestSource = fs.readFileSync(
    path.join(root, "tools/security-tests.mjs"),
    "utf8",
  );

  assert.doesNotMatch(orderPricingSource, /ORDER_PRICE_CHANGED/);
  assert.match(orderPricingSource, /pricingAdjustment/);
  assert.match(prepareSource, /canonicalizeSplitShares/);
  assert.match(prepareSource, /canonicalPricing/);
  assert.match(checkoutSource, /Gesamtbetrag wurde sicher auf/);
  assert.match(
    checkoutTypesSource,
    /pricingAdjustment\?: PricingAdjustment;/,
  );
  assert.match(
    checkoutTypesSource,
    /canonicalPricing\?: CanonicalPricingSnapshot;/,
  );
  assert.doesNotMatch(
    checkoutTypesSource,
    /pricingAdjustment\?: unknown;[\s\S]*canonicalPricing\?: unknown;/,
  );
  assert.match(
    securityTestSource,
    /CANONICAL_PRICE_SOURCE_OF_TRUTH_V3/,
  );
  assert.doesNotMatch(
    securityTestSource,
    /submitted\/canonical price mismatch protection missing/,
  );

  assert.throws(
    () =>
      canonicalizeSplitShares({
        raw: [
          { label: "Person 1", baseAmountCents: 1000, items: [] },
          { label: "Person 2", baseAmountCents: 0, items: [] },
        ],
        payableCents: 1000,
        serviceFeeCents: 20,
        maxPeople: 8,
      }),
    /SPLIT_EMPTY_PERSON/,
  );

  console.log("Canonical pricing regression tests passed.");
} finally {
  if (originalTsLoader) require.extensions[".ts"] = originalTsLoader;
  else delete require.extensions[".ts"];
}
