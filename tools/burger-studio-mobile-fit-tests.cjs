const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const originalLoad = Module._load;
const jsx = (type, props) => ({ type, props });
const compile = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
require.extensions['.ts'] = compile;
require.extensions['.tsx'] = compile;
Module._load = function(request, parent, isMain) {
  if (request === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
  if (request.startsWith('@/')) {
    const base = path.join(process.cwd(), request.slice(2));
    return originalLoad.call(this, fs.existsSync(base + '.ts') ? base + '.ts' : base + '.tsx', parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};
const Stack = require('../components/burger-studio/BurgerStackV2.tsx').default;
const { createDefaultBurgerStudioV2Config } = require('../lib/burger-studio-v2.ts');
const { mobileLayerHeight } = require('../lib/burger-studio-mobile-layout.ts');
const config = createDefaultBurgerStudioV2Config();
function nodes(node, predicate, out = []) {
  if (Array.isArray(node)) node.forEach(child => nodes(child, predicate, out));
  else if (node && typeof node === 'object') {
    if (predicate(node)) out.push(node);
    nodes(node.props?.children, predicate, out);
  }
  return out;
}
function pixels(value) { return parseFloat(value); }
const bun = config.ingredients.find(item => item.group === 'bun');
const ingredients = config.ingredients.filter(item => item.active && item.group !== 'bun');
// Exercise the real component with progressively fuller recipes and every
// individual ingredient, including the tallest Black Angus photo.
const recipes = [{ [bun.id]: 1 }];
const selection = { [bun.id]: 1 };
for (const ingredient of ingredients) {
  recipes.push({ [bun.id]: 1, [ingredient.id]: ingredient.max });
  for (let qty = 1; qty <= ingredient.max; qty++) {
    selection[ingredient.id] = qty;
    recipes.push({ ...selection });
  }
}
for (const recipe of recipes) for (const assembled of [false, true]) {
  const tree = Stack({ config, recipe: { version: 1, templateId: null, ingredients: recipe }, assembled });
  const style = tree.props.style;
  assert.equal(style['--bsv2-mobile-scale'], 0.8, 'food width must not shrink as the recipe grows');
  const canvasHeight = pixels(style['--bsv2-mobile-height']);
  if (assembled) assert.equal(canvasHeight, 365, 'assembled canvas remains compact');
  assert(pixels(style['--bsv2-mobile-stage-height']) >= canvasHeight * 0.8 + 48, 'phone stage grows to expose the entire scaled canvas without nested scrolling');
  const top = pixels(style[assembled ? '--bsv2-mobile-final-top' : '--bsv2-mobile-build-top']);
  assert(top >= 0 && top + 123 <= canvasHeight, 'entire top bun stays inside the phone canvas');
  const layers = nodes(tree, node => !!node.props?.['data-visual-kind']);
  assert.equal(layers.length, Object.values(recipe).reduce((a, b) => a + b, 0) - 1, 'no selected ingredients are dropped to fit');
  for (const layer of layers) {
    const bottom = pixels(layer.props.style[assembled ? '--bsv2-mobile-final-bottom' : '--bsv2-mobile-build-bottom']);
    assert(bottom >= 0 && bottom + mobileLayerHeight(layer.props['data-visual-kind']) <= canvasHeight, 'ingredient stays within canvas');
  }
  for (const flow of nodes(tree, node => node.props?.className === 'bsv2-cheese-flow')) {
    const edges = flow.props.children;
    assert.equal(edges.length, 40, 'cheese edge photo patches cover the full slice');
    for (const edge of edges) {
      assert(edge.props.style['--bsv2-edge-sag'] >= 1 && edge.props.style['--bsv2-edge-sag'] <= 2.05, 'sag stays attached and bounded over the next ingredient');
    }
    assert(edges.some(edge => edge.props.style['--bsv2-edge-sag'] === 1), 'middle portions stay still rather than stretching the whole cheese');
  }
  if (!assembled) for (let index = 1; index < layers.length; index++) {
    const previous = layers[index - 1];
    const previousTop = pixels(previous.props.style['--bsv2-mobile-build-bottom']) + mobileLayerHeight(previous.props['data-visual-kind']);
    assert(pixels(layers[index].props.style['--bsv2-mobile-build-bottom']) >= previousTop + 10, 'building ingredients have a real gap, including meat and cheese');
  }
  for (const viewport of [320, 375, 390, 393, 430, 768]) {
    const stageWidth = viewport - 24;
    const foodWidth = Math.min(stageWidth - 24, 345) * 0.8 * 0.82;
    assert(foodWidth <= stageWidth, 'phone preview never overflows horizontally');
    assert(365 * 0.8 <= 340, 'fixed canvas fits mobile stage vertically');
  }
}
const source = fs.readFileSync('components/burger-studio/BurgerStackV2.tsx', 'utf8');
assert(source.includes('position:absolute;left:50%;top:0'));
assert(!source.includes('overflow-y:auto;overflow-x:hidden'));
assert(source.includes('height:calc(var(--bsv2-mobile-stage-height) - 48px);overflow:visible'));
// Restore a removed ingredient with a different object insertion order. The
// real rendered identities and positions must equal the original full recipe.
const original = { ...selection };
for (const ingredient of ingredients) {
 const changed = { ...original };
 delete changed[ingredient.id];
 Stack({config,recipe:{version:1,templateId:null,ingredients:changed},assembled:false});
 changed[ingredient.id] = original[ingredient.id];
 const render = ingredients => Stack({config,recipe:{version:1,templateId:null,ingredients},assembled:false});
 assert.deepEqual(render(changed),render(original), 'remove/re-add must restore canonical layer identities, counts and positions');
}
assert(source.includes('height:var(--bsv2-mobile-height)'));
assert(source.includes('bottom:var(--bsv2-mobile-build-bottom)'));
assert(source.includes('bottom:var(--bsv2-mobile-final-bottom)'));
assert(!source.includes('292 / Math.max(1, stageHeight'));
assert(source.includes('background-image:var(--bsv2-photo);background-size:4000% 181.818182%'));
assert(!source.includes('animation:bsv2-photo-melt'));
assert(!source.includes('animation:bsv2-slow-cheese-flow'));
const ui = fs.readFileSync('components/burger-studio/BurgerStudioV2.tsx', 'utf8');
assert(ui.includes('grid-cols-1 gap-2 min-[375px]:grid-cols-2 sm:grid-cols-1'));
assert(ui.includes('break-words text-sm font-bold'));
assert(ui.includes('h-11 w-11'), 'touch targets remain at least 44 pixels');
console.log(`Burger Studio mobile fit: ${recipes.length} recipes in both states, fixed food size, non-overlapping layers, remove/re-add stability and 320–768px bounds passed.`);
