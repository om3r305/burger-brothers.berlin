const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) =>
  fs.readFileSync(path.join(root, relative), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function extractModel(schema, modelName) {
  const marker = `model ${modelName} {`;
  const start = schema.indexOf(marker);
  assert(start >= 0, `${modelName} model not found`);

  let depth = 0;
  let opened = false;

  for (let index = start; index < schema.length; index += 1) {
    const char = schema[index];

    if (char === "{") {
      depth += 1;
      opened = true;
    } else if (char === "}") {
      depth -= 1;
      if (opened && depth === 0) {
        return schema.slice(start, index + 1);
      }
    }
  }

  throw new Error(`${modelName} model is not closed`);
}

const exportRoute = read("app/api/brian/export/route.ts");
const learnRoute = read("app/api/brian/learn/route.ts");
const schema = read("prisma/schema.prisma");
const brianModel = extractModel(schema, "BrianLearnLog");

assert(
  !/\bmode\s*:\s*true\s*,/.test(exportRoute),
  "Brian export must not select a non-existent BrianLearnLog.mode field",
);

assert(
  exportRoute.includes("raw: true"),
  "Brian export must select raw JSON",
);

assert(
  exportRoute.includes("mode: raw?.mode,"),
  "Brian export must read mode from raw JSON",
);

assert(
  !exportRoute.includes("raw?.mode || row?.mode"),
  "Brian export must not fall back to a non-existent row.mode field",
);

assert(
  !/^\s*mode\s+(String|Json)\??\s/m.test(brianModel),
  "BrianLearnLog unexpectedly contains a direct mode field; review the export contract",
);

assert(
  learnRoute.includes("mode,") &&
    learnRoute.includes("raw: entry"),
  "Brian learn must preserve mode inside raw JSON",
);

console.log("Brian export regression tests: OK");
