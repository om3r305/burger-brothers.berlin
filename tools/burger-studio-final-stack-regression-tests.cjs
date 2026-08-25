const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = process.cwd();
const stack = fs.readFileSync(
  path.join(root, "components/burger-studio/BurgerStackV2.tsx"),
  "utf8",
);

// Build mode remains centered and food ordering remains canonical.
assert(stack.includes('.bsv2-piece{position:absolute;left:50%;transform:translateX(-50%)'));
assert(stack.includes('layers.sort((a, b) => a.order - b.order'));
assert(stack.includes('foodPriority(kind, ingredient.group, unit)'));

// Final stack uses visible-footprint spacing rather than DOM box height.
assert(stack.includes('function assembledStep(kind: string)'));
assert(stack.includes('return 4;'));
assert(stack.includes('if (kind === "lettuce") return 10;'));
assert(stack.includes('if (kind === "tomato") return 7;'));
assert(stack.includes('if (["onion", "fried-onion", "pickle"].includes(kind)) return 6;'));
assert(stack.includes('if (kind === "beef") return 29;'));
assert(stack.includes('if (kind === "crispy") return 31;'));
assert(stack.includes('let finalCursor = 80;'));
assert(stack.includes('const finalTopBottom = Math.max(90, finalCursor + 1);'));
assert(stack.includes('bottom:var(--bsv2-final-bottom)'));

// Thin ingredients get a larger visible assembled footprint to remove perceived
// black gaps while preserving the floating build-mode artwork.
assert(stack.includes('.is-assembled .bsv2-layer--sauce'));
assert(stack.includes('height:13px;width:72%'));
assert(stack.includes('.is-assembled .bsv2-layer--lettuce{height:31px;width:82%}'));
assert(stack.includes('.is-assembled .bsv2-layer--tomato{height:24px;width:72%}'));
assert(stack.includes('.is-assembled .bsv2-layer--pickle,.is-assembled .bsv2-layer--onion'));

// Existing bun variants and finish animation must remain untouched.
assert(stack.includes('.bsv2-bun--classic.bsv2-bun-top:before'));
assert(stack.includes('.bsv2-bun--smash:before,.bsv2-bun--gluten-free:before,.bsv2-bun-bottom:before{content:none}'));
assert(stack.includes('@keyframes bsv2-flash'));
assert(stack.includes('@keyframes bsv2-drop'));
assert(stack.includes('@keyframes bsv2-top-close'));
assert(stack.includes('animation-delay:calc(110ms + (var(--bsv2-count) * 48ms))'));

// Keep the stack lightweight.
assert(!stack.includes('@react-three/fiber'));
assert(!stack.includes('@react-three/drei'));
assert(!stack.includes('THREE.'));
assert(!stack.includes('<Canvas'));

console.log("Burger Studio final stack regression tests: OK");
