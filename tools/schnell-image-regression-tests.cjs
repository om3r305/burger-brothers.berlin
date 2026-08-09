const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const client = read("components/schnellbestellung/SchnellClient.tsx");
const localImages = read("lib/media/local-optimized-image.ts");

assert.match(client, /localImageFallbackUrl,/);
assert.match(client, /optimizedLocalImageUrl,/);
assert.match(
  client,
  /optimizedLocalImageUrl\(product\.imageUrl\) \|\| product\.imageUrl/,
);
assert.match(
  client,
  /localImageFallbackUrl\(product\.imageUrl\) \|\| product\.imageUrl/,
);
assert.match(client, /image\.src = preferredImageUrl/);
assert.match(client, /setImageSource\(fallbackImageUrl\)/);
assert.match(client, /src=\{imageSource\}/);
assert.doesNotMatch(client, /src=\{product\.imageUrl\}/);

assert.match(localImages, /DURSTLOESCHER_LOCAL_PATH/);
assert.match(localImages, /"\/images\/drinks\/durst\.webp"/);
assert.match(localImages, /"\/images\/drinks\/durst\.png"/);

for (const asset of [
  "public/images/drinks/durst.webp",
  "public/images/drinks/durst.png",
]) {
  assert.ok(fs.existsSync(path.join(root, asset)), `${asset} eksik`);
}

console.log("schnell image regression tests: OK");
