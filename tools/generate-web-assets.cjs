const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const publicDir = path.join(root, "public");
const roots = [
  path.join(publicDir, "images"),
  path.join(publicDir, "badges"),
];
const singleFiles = [path.join(publicDir, "logo-burger-brothers.png")];

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const out = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) out.push(...walk(target));
    else if (entry.isFile() && /\.png$/i.test(entry.name)) out.push(target);
  }
  return out;
}

const sources = [
  ...roots.flatMap(walk),
  ...singleFiles.filter((file) => fs.existsSync(file)),
].sort();

async function convert(source) {
  const target = source.replace(/\.png$/i, ".webp");
  const sourceStat = fs.statSync(source);
  if (fs.existsSync(target)) {
    const targetStat = fs.statSync(target);
    if (targetStat.mtimeMs >= sourceStat.mtimeMs && targetStat.size > 0) {
      return { source, target, skipped: true, before: sourceStat.size, after: targetStat.size };
    }
  }

  await sharp(source, { failOn: "none" })
    .rotate()
    .webp({
      quality: 82,
      alphaQuality: 92,
      effort: 5,
      smartSubsample: true,
    })
    .toFile(target);

  return {
    source,
    target,
    skipped: false,
    before: sourceStat.size,
    after: fs.statSync(target).size,
  };
}

async function runPool(items, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await convert(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, worker),
  );
  return results;
}

runPool(sources, 4)
  .then((results) => {
    const before = results.reduce((sum, item) => sum + item.before, 0);
    const after = results.reduce((sum, item) => sum + item.after, 0);
    const saved = Math.max(0, before - after);
    console.log(
      `Web assets ready: ${results.length} files, ${(before / 1024 / 1024).toFixed(1)} MiB -> ${(after / 1024 / 1024).toFixed(1)} MiB (${(saved / 1024 / 1024).toFixed(1)} MiB runtime transfer saved).`,
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
