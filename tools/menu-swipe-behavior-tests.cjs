const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const originals = { load: Module._load, ts: require.extensions['.ts'], tsx: require.extensions['.tsx'],
  window: global.window, document: global.document, Element: global.Element, HTMLElement: global.HTMLElement };
let pathname = '/', query = '', callbacks = [], cleanups = [], navigation = [], cursor = 0, refs = [];
const listeners = new Map();
class Element {
  constructor(interactive = false) { this.interactive = interactive; this.parentElement = null; this.dataset = {}; }
  closest() { return this.interactive ? this : null; }
}
class HTMLElement extends Element {}
global.Element = Element; global.HTMLElement = HTMLElement;
const classes = new Set();
global.document = {
  body: new HTMLElement(),
  documentElement: { clientWidth: 390, classList: { contains: c => classes.has(c), add: c => classes.add(c), remove: c => classes.delete(c) } },
  querySelectorAll: () => ['burger','vegan','extras','drinks','hotdogs','sauces','donuts','bubbletea'].map(key => ({ dataset: { bbTabKey: key } })),
  addEventListener: (name, fn, options) => {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push({ fn, options });
  },
  removeEventListener: (name, fn) => listeners.set(name, (listeners.get(name) || []).filter(item => item.fn !== fn)),
};
global.window = {
  innerWidth: 390, getComputedStyle: () => ({ overflowX: 'visible' }),
  addEventListener() {}, removeEventListener() {}, setTimeout: () => 1, clearTimeout() {}, scrollTo() {},
  history: { pushState: (_, __, href) => navigation.push(href) },
};
const compile = (mod, filename) => mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, fileName: filename,
}).outputText, filename);
require.extensions['.ts'] = compile; require.extensions['.tsx'] = compile;
const router = { prefetch() {}, push: href => navigation.push(href) };
Module._load = function(request, parent, isMain) {
  if (request === 'react') return { useEffect: fn => callbacks.push(fn), useMemo: fn => fn(), useRef: initial => {
    const index = cursor++; return refs[index] || (refs[index] = { current: initial });
  } };
  if (request === 'next/navigation') return { usePathname: () => pathname, useSearchParams: () => new URLSearchParams(query), useRouter: () => router };
  if (request === '@/components/AppRouteTransition') return { startAppNavigation() {} };
  if (request === '@/lib/public-data-cache') return { warmCategoryData: async () => {} };
  if (request === '@/lib/settings') return { readSettings: () => ({ menuTransitions: { enabled: true } }), fetchAndApplyRemoteSettings: async () => ({ menuTransitions: { enabled: true } }) };
  if (request.startsWith('@/')) return originals.load.call(this, path.join(process.cwd(), request.slice(2) + '.ts'), parent, isMain);
  return originals.load.call(this, request, parent, isMain);
};
const Swipe = require('../components/menu/MobileCategorySwipe.tsx').default;
const { installBrowserHistorySwipeGuard } = require('../lib/client/browser-history-swipe.ts');
function mount(route, search = '') {
  cleanups.forEach(fn => fn?.()); cleanups = []; callbacks = []; refs = []; cursor = 0; classes.clear(); navigation = [];
  pathname = route; query = search;
  cleanups.push(installBrowserHistorySwipeGuard());
  Swipe(); callbacks.forEach(fn => cleanups.push(fn()));
}
function emit(name, x, y = 200, options = {}) {
  const target = options.target || new HTMLElement(); target.parentElement = document.body;
  const point = { clientX: x, clientY: y };
  const event = { target, cancelable: true, defaultPrevented: false,
    touches: name === 'touchend' ? [] : [point], changedTouches: [point],
    preventDefault() { this.defaultPrevented = true; }, ...options };
  (listeners.get(name) || []).forEach(({ fn }) => fn(event));
  return event;
}
function swipe(start, end, startY = 200, endY = 200) {
  emit('touchstart', start, startY); emit('touchmove', end, endY); emit('touchend', end, endY);
}
try {
  for (const route of ['/', '/burger-studio', '/checkout', '/tv', '/driver']) {
    mount(route); swipe(200, 100); swipe(200, 300);
    assert.deepEqual(navigation, [], `${route}: normal swipes never navigate`);
    assert(emit('touchstart', 1).defaultPrevented, `${route}: left browser edge is guarded`);
    assert(emit('touchstart', 389).defaultPrevented, `${route}: right browser edge is guarded`);
  }
  mount('/menu'); swipe(200, 300); assert.deepEqual(navigation, [], 'first category cannot swipe to landing');
  mount('/menu'); swipe(200, 100); assert.deepEqual(navigation, ['/menu?cat=vegan']);
  mount('/extras'); swipe(200, 100); assert.deepEqual(navigation, ['/drinks']);
  mount('/extras'); swipe(200, 300); assert.deepEqual(navigation, ['/menu?cat=vegan']);
  mount('/bubble-tea'); swipe(200, 100); assert.deepEqual(navigation, [], 'last category cannot navigate outside the menu');
  mount('/menu'); swipe(200, 195, 200, 350); assert.deepEqual(navigation, [], 'vertical scrolling stays vertical');
  mount('/menu'); swipe(1, 120); assert.deepEqual(navigation, [], 'browser edges are not category swipes');
  mount('/menu'); emit('touchstart', 200); emit('touchmove', 100); emit('touchcancel', 100); emit('touchend', 100);
  assert.deepEqual(navigation, [], 'cancelled swipe cannot commit');
  mount('/menu'); emit('touchstart', 200, 200, { target: new HTMLElement(true) }); emit('touchmove', 100); emit('touchend', 100);
  assert.deepEqual(navigation, [], 'controls/modals retain their own gestures');
  assert(!emit('touchstart', 1, 200, { target: new HTMLElement(true) }).defaultPrevented, 'edge controls retain taps');
  assert(!emit('touchstart', 1, 200, { touches: [{ clientX: 1 }, { clientX: 3 }] }).defaultPrevented, 'multi-touch is preserved');
  assert(!emit('touchstart', 1, 200, { cancelable: false }).defaultPrevented);
  window.innerWidth = document.documentElement.clientWidth = 1300;
  assert(!emit('touchstart', 1).defaultPrevented, 'desktop input is unchanged');
  cleanups.forEach(fn => fn?.()); cleanups = [];
  assert([...listeners.values()].every(items => items.length === 0), 'listeners are removed on unmount');
  const swiftFiles = ['ios/BurgerBrothersMain/App/WebView.swift','ios/BurgerBrothersSchnell/App/WebView.swift',
    'ios/BurgerBrothersDriver/App/WebView.swift','mobile/ios/burger-brothers/Sources/BBWebView.swift',
    'mobile/ios/bb-schnell/Sources/BBWebView.swift','mobile/ios/bb-driver/Sources/BBWebView.swift'];
  for (const file of swiftFiles) {
    const source = fs.readFileSync(file, 'utf8');
    assert(source.includes('allowsBackForwardNavigationGestures = false'), file);
    assert(!source.includes('allowsBackForwardNavigationGestures = true'), file);
  }
  console.log('Menu swipe behavior: category-only navigation, boundaries, edge guards, cancellation, controls and all six iOS wrappers passed.');
} finally {
  cleanups.forEach(fn => fn?.()); Module._load = originals.load;
  for (const ext of ['ts','tsx']) { if (originals[ext]) require.extensions['.' + ext] = originals[ext]; else delete require.extensions['.' + ext]; }
  for (const key of ['window','document','Element','HTMLElement']) { if (originals[key] === undefined) delete global[key]; else global[key] = originals[key]; }
}
