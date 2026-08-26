const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const model = fs.readFileSync(path.join(root, "lib/burger-studio-v2.ts"), "utf8");
const stack = fs.readFileSync(
  path.join(root, "components/burger-studio/BurgerStackV2.tsx"),
  "utf8",
);

// Additive migration must preserve existing live config while appending only
// missing premium ingredients.
assert(model.includes('id: "black-angus"'));
assert(model.includes('name: "Black Angus Patty"'));
assert(model.includes('addPrice: 6'));
assert(model.includes('visual: "black-angus"'));
assert(model.includes('id: "chicken-breast"'));
assert(model.includes('addPrice: 4.5'));
assert(model.includes('visual: "chicken-breast"'));
assert(model.includes('id: "farmers-market"'));
assert(model.includes('name: "Farmers Market Gemüse"'));
assert(model.includes('group: "topping"'));
assert(model.includes('addPrice: 3'));
assert(model.includes('vegan: true'));
assert(model.includes('visual: "farmers-market"'));
assert(model.includes('if (!map.has(ingredient.id)) map.set(ingredient.id, { ...ingredient });'));

// New protein/topping visuals must resolve to distinct physical layers.
assert(stack.includes('return "black-angus"'));
assert(stack.includes('return "chicken-breast"'));
assert(stack.includes('return "farmers-market"'));
assert(stack.includes('.bsv2-layer--black-angus{height:57px'));
assert(stack.includes('.bsv2-layer--chicken-breast{height:46px'));
assert(stack.includes('.bsv2-layer--farmers-market{height:32px'));
assert(stack.includes('.bsv2-layer--beef{height:48px'));

// Appetite polish: substantial melting cheese, sauce gloss and short hot finish.
assert(stack.includes('bsv2-cheese-drip'));
assert(stack.includes('bsv2-cheese-settle'));
assert(stack.includes('.bsv2-steam'));
assert(stack.includes('bsv2-steam-rise'));
assert(stack.includes('bsv2-heat-glow'));
assert(stack.includes('.bsv2-layer--sauce .bsv2-food-detail:after'));
assert(stack.includes('@media(prefers-reduced-motion:reduce)'));
assert(stack.includes('.bsv2-assembly-flash'));
assert(stack.includes('bsv2-top-close'));

// Keep food-order and the lightweight DOM/CSS architecture intact.
assert(stack.includes('layers.sort((a, b) => a.order - b.order'));
assert(stack.includes('["beef", "black-angus", "chicken-breast", "crispy", "vegan"]'));
assert(!stack.includes('@react-three/fiber'));
assert(!stack.includes('@react-three/drei'));
assert(!stack.includes('THREE.'));
assert(!stack.includes('<Canvas'));

console.log("Burger Studio appetite-pro regression tests: OK");
