const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = process.cwd();
const helperFile = path.join(root, "lib/pricing/client-order-pricing.ts");
const source = fs.readFileSync(helperFile, "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    strict: true,
  },
  fileName: helperFile,
  reportDiagnostics: true,
});
const errors = (output.diagnostics || []).filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
);
assert.equal(errors.length, 0, errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"));

const moduleShim = { exports: {} };
new Function("module", "exports", output.outputText)(moduleShim, moduleShim.exports);
const { roundCurrencyCents, standardSurchargeDiscount } = moduleShim.exports;

assert.equal(roundCurrencyCents(20.25), 20.25);
assert.equal(roundCurrencyCents(20.45), 20.45);
assert.equal(standardSurchargeDiscount(2, 0.1), 0.2);

const merchandise = 20.5;
const merchandiseDiscount = roundCurrencyCents(merchandise * 0.1);
const grossSurcharge = 2;
const surchargeDiscount = standardSurchargeDiscount(grossSurcharge, 0.1);
const netSurcharge = roundCurrencyCents(grossSurcharge - surchargeDiscount);
const payable = roundCurrencyCents(merchandise - merchandiseDiscount + netSurcharge);
assert.equal(merchandiseDiscount + surchargeDiscount, 2.25);
assert.equal(payable, 20.25);

for (const relativePath of ["components/CartSummary.tsx", "app/checkout/page.tsx"]) {
  const clientSource = fs.readFileSync(path.join(root, relativePath), "utf8");
  assert.match(clientSource, /standardSurchargeDiscount/);
  assert.match(clientSource, /netSurcharges/);
  assert.doesNotMatch(clientSource, /Math\.round\(\([^\n]+\) \* 10\) \/ 10/);
}

console.log("Client pricing parity tests passed.");
