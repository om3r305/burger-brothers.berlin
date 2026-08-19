const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = fs.readFileSync("lib/assistant/delivery-area.ts", "utf8");
const chat = fs.readFileSync("app/api/assistant/chat/route.ts", "utf8");
const realtime = fs.readFileSync("app/api/assistant/realtime/route.ts", "utf8");
const component = fs.readFileSync("components/assistant/BurgerAssistant.tsx", "utf8");
const middleware = fs.readFileSync("middleware.ts", "utf8");

const body = ts
  .replace(/export type[\s\S]*?\n};\n/, "")
  .replace(/type DeliverySettings[\s\S]*?\n};\n/, "")
  .replace(/: DeliverySettings/g, "")
  .replace(/: CustomerDeliveryAreaResult/g, "")
  .replace(/: unknown/g, "")
  .replace(/export /g, "");
const factory = new Function(`${body}; return { buildCustomerDeliveryAreaResult, extractDeliveryPostalCode };`);
const { buildCustomerDeliveryAreaResult, extractDeliveryPostalCode } = factory();
const lookup = (settings, plz) => buildCustomerDeliveryAreaResult(settings, plz);

assert.deepEqual(lookup({ pricingOverrides: { plzMin: { 10115: 11 } } }, "10115"), {
  postalCode: "10115", deliverable: true, minimumOrderAfterDiscount: 11,
});
assert.equal(lookup({ delivery: { plzMin: { 10117: 12 } } }, "10117").minimumOrderAfterDiscount, 12);
assert.equal(lookup({ delivery: { minOrderAfterDiscountByPLZ: { 10119: 13 } } }, "10119").minimumOrderAfterDiscount, 13);

const mixed = {
  pricingOverrides: { plzMin: { 10115: 10, 10117: 20, 10119: 30 } },
  delivery: {
    plzMin: { 10117: 21, 10178: 40 },
    minOrderAfterDiscountByPLZ: { 10119: 31, 10178: 41, 10179: 50 },
  },
};
assert.equal(lookup(mixed, "10115").minimumOrderAfterDiscount, 10);
assert.equal(lookup(mixed, "10117").minimumOrderAfterDiscount, 21);
assert.equal(lookup(mixed, "10119").minimumOrderAfterDiscount, 31);
assert.equal(lookup(mixed, "10178").minimumOrderAfterDiscount, 41);
assert.equal(lookup(mixed, "10179").minimumOrderAfterDiscount, 50);
assert.equal(lookup(mixed, "99999").deliverable, false);
assert.equal(extractDeliveryPostalCode("Liefert ihr nach 10115?"), "10115");
assert.equal(extractDeliveryPostalCode("Bestellung 10115"), "");

assert.match(ts, /pricingOverrides\?\.plzMin[\s\S]*delivery\?\.plzMin[\s\S]*minOrderAfterDiscountByPLZ/);
assert.match(chat, /extractDeliveryPostalCode\(request\.message\)/);
assert.match(chat, /request\.customerDeliveryArea = buildCustomerDeliveryAreaResult\([\s\S]*getServerSettings\(\)/);
assert.match(realtime, /name: "check_delivery_area"/);
assert.match(component, /api\/assistant\/delivery-area\?plz=/);
assert.doesNotMatch(component, /getServerSettings|pricingOverrides\?\.plzMin|minOrderAfterDiscountByPLZ/);
assert.match(component, /voiceOrbRef\.current\?\.style\.setProperty\("--voice-level"/);
assert.doesNotMatch(component, /setAudioLevel|setVoiceLevel|setMeterLevel/);
assert.match(middleware, /path === "\/api\/assistant\/delivery-area" && readOnly/);
console.log("Assistant delivery-area checks PASSED.");
