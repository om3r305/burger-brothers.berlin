const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(require('node:path').join(__dirname, '../lib/client/schnell-catalog.ts'), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function fixture() {
  let calls = 0;
  let status = 200;
  let resolvePending;
  let delayed = false;
  const context = {
    exports: {}, Date, AbortController,
    require: () => ({ BURGER_STUDIO_SCRATCH_SKU: 'internal' }),
    window: { setTimeout, clearTimeout, localStorage: { setItem() {} } },
    fetch: async () => {
      calls++;
      if (delayed) await new Promise(resolve => { resolvePending = resolve; });
      return { ok: status === 200, status, json: async () => ({ products: [], categories: [] }) };
    },
  };
  vm.runInNewContext(code, context);
  return { load: context.exports.loadSchnellCatalog, calls: () => calls,
    fail: () => { status = 503; }, recover: () => { status = 200; },
    delay: () => { delayed = true; }, resolve: () => resolvePending() };
}

(async () => {
  const cached = fixture();
  await cached.load();
  await cached.load();
  assert.equal(cached.calls(), 1, 'recent successful result should be reused');
  await cached.load({ forceRefresh: true, cacheMode: 'no-store' });
  assert.equal(cached.calls(), 2, 'forced refresh must fetch immediately after completion');

  const failed = fixture();
  failed.fail();
  await failed.load();
  failed.recover();
  assert.equal((await failed.load()).ok, true);
  assert.equal(failed.calls(), 2, 'a failed result must allow an immediate retry');

  cached.fail();
  await cached.load({ forceRefresh: true });
  cached.recover();
  await cached.load();
  assert.equal(cached.calls(), 4, 'a failed refresh must invalidate the previous successful result');

  const concurrent = fixture();
  concurrent.delay();
  const first = concurrent.load();
  const second = concurrent.load({ forceRefresh: true });
  assert.equal(first, second, 'concurrent consumers should share the in-flight request');
  concurrent.resolve();
  await Promise.all([first, second]);
  assert.equal(concurrent.calls(), 1);
  console.log('Schnell catalog request behavior: 4 scenarios PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
