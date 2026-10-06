const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
function loader() {
  const menu = read('app/menu/page.tsx');
  const body = menu.slice(menu.indexOf('  const reloadDbFirst = async () => {'), menu.indexOf('  /* URL’den'));
  const catalog = deferred(), flags = deferred(), ranks = deferred();
  const loadSeq = { current: 0 }, events = [];
  const context = { exports: {}, loadSeq, dbLoadCatalog: () => catalog.promise,
    dbLoadFeatureFlags: () => flags.promise, dbLoadPopularity: () => ranks.promise,
    setProducts: v => events.push(['products', v]), setCampaigns: v => events.push(['campaigns', v]),
    setFeatures: v => events.push(['flags', v]), setPopularityRanks: v => events.push(['ranks', v]) };
  vm.runInNewContext(`${body}\nexports.reload = reloadDbFirst;`, context);
  return { ...context.exports, catalog, flags, ranks, events, loadSeq };
}
function load(file, deps) {
  const exports = {};
  const js = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(js, { exports, console, URLSearchParams, require: name => {
    if (name in deps) return deps[name];
    if (['react', 'react-dom', 'react/jsx-runtime'].includes(name)) return require(name);
    throw Error(`Unexpected dependency ${name}`);
  } });
  return exports;
}
(async () => {
  const f = loader(); const pending = f.reload();
  f.catalog.resolve({ products: ['fresh'], campaigns: [] });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.events[0][0], 'products', 'catalog must paint before pending auxiliary requests');
  assert.equal(f.events.some(e => e[0] === 'ranks' || e[0] === 'flags'), false);
  f.flags.resolve({ burger: true }); f.ranks.resolve({}); await pending;
  assert.equal(f.events.length, 4);
  const stale = loader(); const oldRequest = stale.reload(); stale.loadSeq.current++;
  stale.catalog.resolve({ products: ['stale'], campaigns: [] }); stale.flags.resolve({}); stale.ranks.resolve({});
  await oldRequest; assert.equal(stale.events.length, 0, 'unmounted/superseded requests must not update cards');
  const normalized = load('components/menu/NormalizedProductImage.tsx', {}).default;
  const card = load('components/menu/ProductCard.tsx', {
    'next/image': { default: props => React.createElement('img', { src: props.src, alt: props.alt }) },
    '@/components/store': { useCart: selector => selector({ addToCart() {} }) },
    '@/lib/media/local-optimized-image': { optimizedLocalImageUrl: src => src.replace('.png', '.webp') },
    './NormalizedProductImage': { default: normalized },
  }).default;
  for (const priority of [true, false]) {
    const html = renderToStaticMarkup(React.createElement(card, {
      sku: 'burger', name: 'Burger', price: 12, image: '/images/burgers/All.png',
      normalizeTransparentImage: true, imagePriority: priority,
    }));
    assert.match(html, /src="\/images\/burgers\/All.webp"/);
    assert.match(html, new RegExp(`loading="${priority ? 'eager' : 'lazy'}"`));
    assert.match(html, new RegExp(`fetchPriority="${priority ? 'high' : 'auto'}"`, 'i'));
  }
  const cardSource = read('components/menu/ProductCard.tsx');
  assert.doesNotMatch(cardSource, /<(?:CoverSingle|CoverCollage)\b/, 'inline component identities must not remount images on updates');
  assert.match(read('app/menu/page.tsx'), /imagePriority=\{index < 4\}/);
  console.log('Mobile image startup: PASS (catalog-first paint, stale request guard, eager/high first cards, lazy remaining cards, stable image element identity)');
})().catch(error => { console.error(error); process.exitCode = 1; });
