const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const image = read("components/menu/NormalizedProductImage.tsx");
const deliveryGate = read("components/customer/DeliveryCheckoutGate.tsx");

assert.match(image, /const \[ready, setReady\] = useState/);
assert.match(image, /opacity: ready \? 1 : 0/);
assert.match(image, /transition: "opacity 120ms ease-out"/);
assert.match(image, /setReady\(true\)/);

assert.match(deliveryGate, /attributeFilter: \["disabled"\]/);
assert.match(deliveryGate, /if \(button\.disabled\) button\.disabled = false/);
assert.match(deliveryGate, /button\.dataset\.bbAddressGateButton !== "1"/);
assert.doesNotMatch(
  deliveryGate,
  /observer\.observe\(document\.body, \{ childList: true, subtree: true, attributes: true \}\)/,
);

console.log("menu visual stability regression tests: OK");
