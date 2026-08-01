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

const failures = [];
for (const test of tests) {
  process.stdout.write(`\n[regression] ${test}\n`);
  const result = spawnSync(process.execPath, [test], {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) failures.push(test);
}

if (failures.length > 0) {
  console.error(`\nRegression suite failed (${failures.length}/${tests.length}):`);
  for (const test of failures) console.error(`- ${test}`);
  process.exit(1);
}

console.log(`\nAll ${tests.length} regression/security test files passed.`);
