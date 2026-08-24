const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const stack = fs.readFileSync(
  path.join(root, "components/burger-studio/BurgerStackV2.tsx"),
  "utf8",
);

// Every burger piece shares one horizontal center axis. State-specific transforms
// may add rotation/animation, but buns and layers always include translateX(-50%).
assert(stack.includes('.bsv2-piece{position:absolute;left:50%;transform:translateX(-50%)'));
assert(stack.includes('.is-building .bsv2-bun-bottom{bottom:25px;transform:translateX(-50%)}'));
assert(stack.includes('.is-building .bsv2-bun-top{top:25px;transform:translateX(-50%) rotate(-1.2deg)}'));
assert(stack.includes('.is-assembled .bsv2-bun-bottom{bottom:38px;transform:translateX(-50%)}'));
assert(stack.includes('.is-assembled .bsv2-bun-top{bottom:var(--bsv2-top-bottom);transform:translateX(-50%)'));

// Final assembly uses ingredient-aware physical spacing instead of a generic
// fixed index gap, which keeps thin vegetables/sauces attached to the burger.
assert(stack.includes('function assembledStep(kind: string)'));
assert(stack.includes('const finalBottoms = layers.map((layer) =>'));
assert(stack.includes('"--bsv2-final-bottom": `${finalBottoms[index]}px`'));
assert(stack.includes('"--bsv2-top-bottom": `${finalTopBottom}px`'));
assert(stack.includes('.is-assembled .bsv2-layer{top:auto;bottom:var(--bsv2-final-bottom)'));
assert(!stack.includes('.is-assembled .bsv2-layer{top:auto;bottom:calc(73px + (var(--bsv2-i) * 24px))'));

// Food-logical ordering and top-bun-last assembly animation remain intact.
assert(stack.includes('layers.sort((a, b) => a.order - b.order'));
assert(stack.includes('foodPriority(kind, ingredient.group, unit)'));
assert(stack.includes('@keyframes bsv2-drop'));
assert(stack.includes('@keyframes bsv2-top-close'));
assert(stack.includes('animation-delay:calc(110ms + (var(--bsv2-count) * 48ms))'));

// Classic bun gets clearly visible sesame; Smash and gluten-free remain seedless.
const sesameBlock = stack.match(/\.bsv2-bun--classic\.bsv2-bun-top:before\{[^}]+\}/)?.[0] || "";
assert(sesameBlock.includes('radial-gradient'));
assert((sesameBlock.match(/radial-gradient/g) || []).length >= 10);
assert(sesameBlock.includes('filter:drop-shadow'));
assert(stack.includes('.bsv2-bun--smash:before,.bsv2-bun--gluten-free:before,.bsv2-bun-bottom:before{content:none}'));

// Lightweight ingredient polish remains recognizable without WebGL/new runtime.
assert(stack.includes('.bsv2-layer--beef .bsv2-food-detail:before'));
assert(stack.includes('.bsv2-layer--bacon .bsv2-food-detail:before'));
assert(stack.includes('.bsv2-layer--lettuce .bsv2-food-detail:before'));
assert(stack.includes('.bsv2-layer--cheddar,.bsv2-layer--gouda,.bsv2-layer--mozzarella,.bsv2-layer--gorgonzola'));
assert(!stack.includes('@react-three/fiber'));
assert(!stack.includes('@react-three/drei'));
assert(!stack.includes('THREE.'));
assert(!stack.includes('<Canvas'));

console.log("Burger Studio mobile assembly regression tests: OK");
