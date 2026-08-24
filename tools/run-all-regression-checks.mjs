import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const toolsDir = path.join(root, "tools");
const tests = fs
  .readdirSync(toolsDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && /test.*\.(?:cjs|mjs)$/i.test(entry.name))
  .map((entry) => path.join("tools", entry.name))
  .sort((a, b) => a.localeCompare(b));

// Historical suites are kept in the repository for traceability, but some of
// them intentionally assert architecture that has since been replaced. They
// must never be silently ignored: each skipped suite names the active tests
// that now own that behavior, and the runner verifies those replacements exist.
const superseded = new Map([
  [
    path.join("tools", "android-qr-direct-installer-regression-tests.cjs"),
    [
      path.join("tools", "dedicated-schnell-installer-regression-tests.cjs"),
      path.join("tools", "android-install-prompt-v2-regression-tests.cjs"),
    ],
  ],
  [
    path.join("tools", "android-required-install-regression-tests.cjs"),
    [path.join("tools", "dedicated-schnell-installer-regression-tests.cjs")],
  ],
  [
    path.join("tools", "assistant-realtime-stability-tests.cjs"),
    [
      path.join("tools", "assistant-realtime-v2-tests.cjs"),
      path.join("tools", "assistant-realtime-regression-tests.cjs"),
    ],
  ],
  [
    path.join("tools", "exact-old-sound-regression-tests.cjs"),
    [path.join("tools", "schnell-order-sound-once-regression-tests.cjs")],
  ],
  [
    path.join("tools", "schnell-ios-audio-gesture-regression-tests.cjs"),
    [
      path.join("tools", "schnell-order-sound-once-regression-tests.cjs"),
      path.join("tools", "schnell-performance-permission-regression-tests.cjs"),
    ],
  ],
  [
    path.join("tools", "schnell-keepalive-ready-audio-regression-tests.cjs"),
    [
      path.join("tools", "schnell-order-sound-once-regression-tests.cjs"),
      path.join("tools", "schnellbestellung-regression-tests.cjs"),
    ],
  ],
  [
    path.join("tools", "schnell-old-audio-engine-regression-tests.cjs"),
    [path.join("tools", "schnell-order-sound-once-regression-tests.cjs")],
  ],
  [
    path.join("tools", "schnell-wall-ticket-sound-regression-tests.cjs"),
    [
      path.join("tools", "schnell-order-sound-once-regression-tests.cjs"),
      path.join("tools", "schnell-dual-receipt-regression-tests.cjs"),
      path.join("tools", "receipt-layout-regression-tests.cjs"),
    ],
  ],
]);

const discovered = new Set(tests);
for (const [historical, replacements] of superseded) {
  if (!discovered.has(historical)) continue;
  for (const replacement of replacements) {
    if (!discovered.has(replacement)) {
      console.error(
        `[regression] superseded mapping is invalid: ${historical} -> missing ${replacement}`,
      );
      process.exit(1);
    }
  }
}

const failures = [];
let activeCount = 0;
let supersededCount = 0;

for (const test of tests) {
  const replacements = superseded.get(test);
  if (replacements) {
    supersededCount += 1;
    process.stdout.write(
      `\n[regression] SKIP superseded ${test} -> ${replacements.join(", ")}\n`,
    );
    continue;
  }

  activeCount += 1;
  process.stdout.write(`\n[regression] ${test}\n`);
  const result = spawnSync(process.execPath, [test], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) failures.push(test);
}

if (failures.length > 0) {
  console.error(`\nRegression suite failed (${failures.length}/${activeCount} active tests):`);
  for (const test of failures) console.error(`- ${test}`);
  process.exit(1);
}

console.log(
  `\nAll ${activeCount} active regression/security test files passed. ` +
    `${supersededCount} historical suites were explicitly superseded.`,
);
