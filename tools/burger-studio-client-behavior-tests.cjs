// Execute the customer component with controlled hooks, storage and HTTP.
// This checks handlers and rendered states; it does not emulate mobile layout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const originalLoad = Module._load;
const originalTs = require.extensions['.ts'];
const originalTsx = require.extensions['.tsx'];
const globals = { window: global.window, localStorage: global.localStorage, fetch: global.fetch };
let hooks = [], cursor = 0, effects = [], tree;
let denyStorage = false, failHttp = false, calls = 0;
const stored = new Map(), cart = [];
const react = {
  useState(initial) {
    const index = cursor++;
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
    return [hooks[index], value => { hooks[index] = typeof value === 'function' ? value(hooks[index]) : value; }];
  },
  useMemo(fn) { cursor++; return fn(); },
  useEffect(fn, deps) {
    const index = cursor++;
    if (!hooks[index] || deps.some((value, i) => value !== hooks[index].deps[i])) {
      effects.push(() => {
        hooks[index]?.cleanup?.();
        hooks[index] = { deps, cleanup: fn() };
      });
    }
  },
};
const jsx = (type, props) => ({ type, props });
const compile = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
require.extensions['.ts'] = compile;
require.extensions['.tsx'] = compile;
Module._load = function(request, parent, isMain) {
  if (request === 'react') return react;
  if (request === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
  if (request === 'next/link') return { __esModule: true, default: 'link' };
  if (request === 'next/navigation') return { useSearchParams: () => new URLSearchParams() };
  if (request === '@/components/store') return { useCart: selector => selector({ orderMode: 'pickup', addToCart: item => cart.push(item) }) };
  if (request === '@/components/NavBar' || request === '@/components/burger-studio/BurgerStackV2') return { __esModule: true, default: 'visual' };
  if (request.startsWith('@/')) {
    const base = path.join(process.cwd(), request.slice(2));
    return originalLoad.call(this, fs.existsSync(base + '.ts') ? base + '.ts' : base + '.tsx', parent, isMain);
  }
  return originalLoad.call(this, request, parent, isMain);
};
const { createDefaultBurgerStudioV2Config } = require('../lib/burger-studio-v2.ts');
const Component = require('../components/burger-studio/BurgerStudioV2.tsx').default;
const config = createDefaultBurgerStudioV2Config();
Object.assign(config, { enabled: true, scratchEnabled: true, templates: [], scratchBasePrice: 3.5 });
global.window = { setTimeout: () => 1, clearTimeout: () => {} };
global.localStorage = {
  getItem: key => stored.get(key) ?? null,
  setItem: (key, value) => { if (denyStorage) throw new Error('storage blocked'); stored.set(key, value); },
};
global.fetch = async url => {
  calls++;
  if (failHttp) return Response.json({ error: 'unavailable' }, { status: 503 });
  return Response.json(url.startsWith('/api/settings') ? { menu: { burgerStudio: config } } : { products: [] });
};
function render() {
  cursor = 0; tree = Component();
  const pending = effects; effects = [];
  pending.forEach(fn => fn());
  return tree;
}
function nodes(node, predicate, output = []) {
  if (Array.isArray(node)) node.forEach(item => nodes(item, predicate, output));
  else if (node && typeof node === 'object') {
    if (predicate(node)) output.push(node);
    nodes(node.props?.children, predicate, output);
  }
  return output;
}
function text(node) {
  if (Array.isArray(node)) return node.map(text).join('');
  if (node && typeof node === 'object') return text(node.props?.children);
  return node == null ? '' : String(node);
}
function button(name) {
  const matches = nodes(tree, node => node.type === 'button' && (node.props['aria-label'] === name || text(node) === name));
  assert.equal(matches.length, 1, `expected one ${name} button`);
  return matches[0];
}
function click(name) { const node = button(name); assert(!node.props.disabled); node.props.onClick(); render(); }
async function flush() { await new Promise(resolve => setImmediate(resolve)); render(); }
async function main() {
  failHttp = true;
  render(); await flush();
  assert(text(tree).includes('konnte nicht geladen werden'));
  assert(!text(tree).includes('ist gerade geschlossen'));
  assert.equal(cart.length, 0);
  failHttp = false;
  click('Erneut versuchen'); await flush();
  assert.equal(calls, 4, 'retry reloads both required resources');
  assert(button('🔥 Burger fertig machen').props.disabled, 'incomplete burger cannot be completed');
  click('Classic Bun hinzufügen');
  click('🥩Protein');
  click('Black Angus Patty hinzufügen');
  assert(text(tree).includes('9,50'));
  denyStorage = true;
  click('♡ Speichern');
  assert(text(tree).includes('Speichern nicht möglich'));
  assert(!text(tree).includes('Burger gespeichert ✓'));
  denyStorage = false;
  click('♡ Speichern');
  assert(text(tree).includes('Burger gespeichert ✓'));
  assert(stored.has('bb_burger_studio_saved_v2'));
  click('🔥 Burger fertig machen');
  const mobileCart = nodes(tree, node => node.type === 'button' && text(node) === 'In den Warenkorb' && node.props.className.includes('min-h-12'))[0];
  assert(mobileCart && !mobileCart.props.disabled);
  mobileCart.props.onClick(); render();
  assert.equal(cart.length, 1);
  assert.equal(cart[0].item.sku, 'BSTUDIO-SCRATCH-BASE');
  assert.deepEqual(cart[0].add.map(extra => extra.id), ['bstudio:marker', 'bstudio:add:brioche', 'bstudio:add:black-angus']);
  assert.equal(cart[0].item.price + cart[0].add.reduce((sum, extra) => sum + extra.price, 0), 9.5);
  click('Black Angus Patty reduzieren');
  assert(button('🔥 Burger fertig machen').props.disabled, 'editing resets assembly and completion');
  console.log('Burger Studio client behavior: HTTP retry, honest storage, build completion and cart payload passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  hooks.forEach(hook => hook?.cleanup?.());
  Module._load = originalLoad;
  if (originalTs) require.extensions['.ts'] = originalTs; else delete require.extensions['.ts'];
  if (originalTsx) require.extensions['.tsx'] = originalTsx; else delete require.extensions['.tsx'];
  for (const [key, value] of Object.entries(globals)) { if (value === undefined) delete global[key]; else global[key] = value; }
});
