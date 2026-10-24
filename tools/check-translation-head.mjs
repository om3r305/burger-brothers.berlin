import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function assertTranslationHead(html) {
  const headEnd = html.indexOf("</head>");
  assert.ok(headEnd >= 0, "HTML must contain a complete initial head");
  const head = html.slice(0, headEnd);
  assert.match(html, /<html\b[^>]*\blang=["']de["']/i);
  assert.match(html, /<html\b[^>]*\btranslate=["']no["']/i);
  const tags = (head.match(/<meta\b[^>]*>/gi) || [])
    .filter((tag) => /\bname=["']google["']/i.test(tag));
  assert.equal(tags.length, 1, "One google meta must exist in the initial head, before streamed body metadata");
  assert.match(tags[0], /\bcontent=["']notranslate["']/i);
}

// The checker must reject the exact failure mode observed in production.
assertTranslationHead('<html lang="de" translate="no"><head><meta name="google" content="notranslate"/></head><body></body></html>');
assert.throws(() => assertTranslationHead('<html lang="de" translate="no"><head></head><body><meta name="google" content="notranslate"/></body></html>'));

const baseUrl = process.argv[2];
if (baseUrl === "--file") {
  assertTranslationHead(readFileSync(process.argv[3], "utf8"));
  console.log("PASS: raw response initial head has notranslate");
  process.exit(0);
}
if (!baseUrl) throw new Error("Usage: node tools/check-translation-head.mjs https://host (or local test server)");
const agents = {
  android: "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  desktop: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};
const results = await Promise.allSettled(Object.entries(agents).flatMap(([agent, userAgent]) =>
  ["/?source=android-twa", "/menu", "/checkout"].map(async (route) => {
    const response = await fetch(new URL(route, baseUrl), {
      headers: { "user-agent": userAgent }, redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    assert.equal(response.status, 200, `${agent} ${route}: HTTP 200 expected`);
    assertTranslationHead(await response.text());
    console.log(`PASS: ${agent} ${route}: initial head has notranslate`);
  }),
));
for (const result of results) if (result.status === "rejected") console.error(result.reason.message);
assert.ok(results.every((result) => result.status === "fulfilled"), "Translation head HTTP regression checks failed");
console.log("Translation initial-head regression checks: OK (6 HTTP responses)");
