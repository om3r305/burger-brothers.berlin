const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = process.cwd();
const source = fs.readFileSync(path.join(root, "lib/assistant/delivery-area.ts"), "utf8");
const route = fs.readFileSync(path.join(root, "app/api/assistant/delivery-area/route.ts"), "utf8");
const realtime = fs.readFileSync(path.join(root, "app/api/assistant/realtime/route.ts"), "utf8");
const wrapper = fs.readFileSync(path.join(root, "components/assistant/BurgerAssistant.tsx"), "utf8");
const component = fs.readFileSync(path.join(root, "components/assistant/BurgerAssistantCore.tsx"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const sandbox = { exports: {} };
vm.runInNewContext(compiled, sandbox);
const lookup = sandbox.exports.buildCustomerDeliveryAreaResult;

function assert(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`PASS: ${message}`);
}

const settings = {
  delivery: { plzMin: { "13507": 25 }, surcharges: { burger: 9 }, internalFlag: true },
  security: { adminPin: "never-return-this" },
};
const served = lookup(settings, "13507");
assert(JSON.stringify(served) === JSON.stringify({ postalCode: "13507", deliverable: true, minimumOrder: 25 }), "served PLZ returns only explicit customer fields");
const unserved = lookup(settings, "10115");
assert(JSON.stringify(unserved) === JSON.stringify({ postalCode: "10115", deliverable: false }), "unserved PLZ does not invent minimum or fee fields");
assert(!JSON.stringify(served).includes("adminPin") && !JSON.stringify(served).includes("surcharges"), "raw settings and admin data never enter tool output");
assert(source.includes("settings.delivery?.plzMin") && source.includes("settings.pricingOverrides?.plzMin"), "lookup follows checkout's authoritative delivery minimum compatibility chain");
assert(route.includes("getServerSettings()") && route.includes("buildCustomerDeliveryAreaResult(settings, postalCode)"), "server route reads authoritative server settings and returns the safe projection");
assert(realtime.includes('name: "check_delivery_area"') && realtime.includes("Never answer these facts from memory"), "Realtime requires PLZ lookup instead of model memory");
assert(wrapper.includes('import BurgerAssistantCore from "./BurgerAssistantCore";') && wrapper.includes("<BurgerAssistantCore />"), "assistant shell delegates customer behavior to the guarded core");
assert(component.includes('fetch("/api/assistant/delivery-area"') && component.includes('event?.name === "check_delivery_area"'), "voice core executes the local/server delivery tool on demand");

console.log("\nBurger Assistant delivery-area checks PASSED.");
