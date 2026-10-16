const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = process.cwd();
const originalTsLoader = require.extensions[".ts"];

require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

const saved = process.env.SCHNELL_REVIEW_CODE;

try {
  const review = require(path.join(root, "lib/server/schnell-review.ts"));

  // Off unless a long enough code is configured.
  delete process.env.SCHNELL_REVIEW_CODE;
  assert.equal(review.isValidReviewCode("anything-long-enough-123"), false);
  process.env.SCHNELL_REVIEW_CODE = "short";
  assert.equal(review.isValidReviewCode("short"), false, "codes under 16 chars are rejected");

  process.env.SCHNELL_REVIEW_CODE = "apple-review-2026-abcdef";
  assert.equal(review.isValidReviewCode("apple-review-2026-abcdef"), true);
  assert.equal(review.isValidReviewCode("apple-review-2026-abcdeX"), false);
  assert.equal(review.isValidReviewCode(""), false);

  assert.equal(review.reviewCodeFromToken("review:abc"), "abc");
  assert.equal(review.reviewCodeFromToken("eyJ0eXAiOi.sig"), null, "normal QR tokens are untouched");

  assert.equal(review.isReviewSession({ review: true }), true);
  assert.equal(review.isReviewSession({ review: "true" }), false);
  assert.equal(review.isReviewSession(null), false);

  const now = 1_800_000_000_000;
  const id = review.createReviewOrderId(now);
  assert.equal(review.isReviewOrderId(id), true);
  assert.equal(review.isReviewOrderId("clx123"), false);
  assert.equal(review.reviewOrderStatus(id, now + 5_000), "new");
  assert.equal(review.reviewOrderStatus(id, now + 30_000), "preparing");
  assert.equal(review.reviewOrderStatus(id, now + 60_000), "ready");

  // Wiring: review sessions never reach the real order writer.
  const orders = fs.readFileSync(path.join(root, "app/api/schnellbestellung/orders/route.ts"), "utf8");
  const reviewReturn = orders.indexOf("if (review) {");
  const realOrder = orders.indexOf("createCashSchnellOrder({");
  assert(reviewReturn > 0 && realOrder > reviewReturn, "simulated review order returns before createCashSchnellOrder");
  assert.match(orders, /!review &&\s*settings\.locationCheckEnabled/);

  const verify = fs.readFileSync(path.join(root, "app/api/schnellbestellung/location/verify/route.ts"), "utf8");
  assert.match(verify, /isValidReviewCode\(reviewCode\)/);
  assert.match(verify, /review: true/);

  const status = fs.readFileSync(path.join(root, "app/api/schnellbestellung/status/route.ts"), "utf8");
  assert.match(status, /if \(!isReviewSession\(session\)\)/, "review order ids need a review session");

  const sessionHelper = fs.readFileSync(path.join(root, "lib/server/schnellbestellung.ts"), "utf8");
  assert.match(sessionHelper, /data\.review === true \? \{ review: true \}/);

  console.log("Schnell App Store review access tests passed.");
} finally {
  if (saved === undefined) delete process.env.SCHNELL_REVIEW_CODE;
  else process.env.SCHNELL_REVIEW_CODE = saved;
  if (originalTsLoader) require.extensions[".ts"] = originalTsLoader;
  else delete require.extensions[".ts"];
}
