const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { randomUUID } = require('node:crypto');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function storageFixture(blocked) {
  const persisted = new Map();
  const exports = {};
  const window = { localStorage: {
    getItem(k) { if (blocked) throw new Error('SecurityError'); return persisted.get(k) ?? null; },
    setItem(k,v) { if (blocked) throw new Error('QuotaExceededError'); persisted.set(k,v); },
    removeItem(k) { if (blocked) throw new Error('SecurityError'); persisted.delete(k); },
  }, setTimeout: () => 1, clearTimeout() {} };
  vm.runInNewContext(compile(fs.readFileSync('lib/client/schnell-storage.ts','utf8')), { exports, window, Map });
  return { storage: exports.schnellStorage, window, persisted };
}
const client = fs.readFileSync('components/schnellbestellung/SchnellClient.tsx','utf8');
function clientFixture({ blocked = false, deferred = false, responseOk = true, payload, abort = false } = {}) {
  const f = storageFixture(blocked);
  const events = []; let fetchCount = 0; let release;
  const storage = f.storage;
  const cart = [{ key: 'burger', product: { id: 'burger' }, qty: 1, extraIds: [], note: '' }];
  const scope = { exports: {}, crypto: { randomUUID }, Date, JSON, Error, String, Number, Math, AbortController,
    window: f.window, schnellStorage: storage, cart, takeaway: false, busy: false, orderSubmitLockRef: { current: false },
    catalogSettings: { takeawayEnabled: true }, total: 12,
    productRequiresDoneness: () => false, normalizeDoneness: v => v,
    orderFingerprint: (items,takeaway) => JSON.stringify({items,takeaway}),
    setBusy: v => events.push(['busy',v]), setError: v => events.push(['error',v]),
    setCart: v => events.push(['cart',v]), setCartOpen() {}, setConfirmOpen() {},
    stopRewardCelebrationSound() {}, prewarmRewardCelebration() {},
    saveHistoryEntry: () => storage.setItem('history','saved'), saveSchnellActiveOrder: id => events.push(['active',id]),
    bindSchnellPushToOrder: async () => false,
    router: { push: url => events.push(['push',url]), replace: url => events.push(['replace',url]) },
    fetch: async () => {
      fetchCount++;
      if (deferred) await new Promise(resolve => { release = resolve; });
      if (abort) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
      return { ok: responseOk, json: async () => payload ?? { ok:true, orderId:'FAST-1', customerNumber:1, total:12 } };
    },
  };
  const keyFn = client.slice(client.indexOf('function getStableIdempotencyKey('), client.indexOf('function normalizeCatalogSettings('));
  const placeFn = client.slice(client.indexOf('  async function placeOrder()'), client.indexOf('\n  return (\n    <main',client.indexOf('  async function placeOrder()')));
  vm.runInNewContext(compile(keyFn + '\n' + placeFn + '\nexports.placeOrder = placeOrder; exports.key = getStableIdempotencyKey;'),scope);
  return { ...f, scope, events, place: scope.exports.placeOrder, key: () => scope.exports.key(cart,false), fetchCount: () => fetchCount, release: () => release() };
}
function serverFixture({ first, inside, race = false } = {}) {
  let creates = 0, transactions = 0; let created;
  const source = fs.readFileSync('lib/server/schnellbestellung.ts','utf8');
  const functionSource = source.slice(source.indexOf('export async function createCashSchnellOrder('));
  const exports = {};
  const transaction = {
    order: { findFirst: async () => inside ?? null, create: async ({data}) => { creates++; created = { id:'FAST-1', ...data }; return created; } },
    setting: { findUnique: async () => null, upsert: async () => ({}) },
  };
  vm.runInNewContext(compile(functionSource), { exports, Date, Number, Math, String, Error,
    Prisma: { Decimal: class { constructor(v) { this.value=v; } }, TransactionIsolationLevel: { Serializable:'Serializable' } },
    getTenantId: async () => 'tenant', berlinBusinessDate: () => '2026-10-03', obj: v => v || {}, rewardFromOrderMeta: meta => meta.reward || null,
    prepareCashSchnellOrder: async () => ({ since:0, settings: { maxOrdersPerDevice:3, numberStart:1 },
      canonicalItems:[{ id:'burger', category:'burger', qty:1, price:12 }], merchandise:12, discount:0, payable:12, takeaway:false }),
    activeDeviceOrders: async () => [], throwDeviceRateLimit() {}, decideSchnellReward: async () => null,
    prisma: { order: { findFirst: async () => first ?? null }, $transaction: async (run, options) => {
      transactions++; assert.equal(options.isolationLevel,'Serializable');
      if (race && transactions === 1) { const e = new Error('race'); e.code='P2034'; throw e; }
      return run(transaction);
    } },
  });
  return { create: () => exports.createCashSchnellOrder({ items:[], deviceId:'device-A', idempotencyKey:'retry-key-123456',session:{iat:1} }),
    counts: () => ({creates,transactions}), row: () => created };
}
function routeFixture(code) {
  let calls = 0;
  const exports = {};
  const deps = {
    "next/server": require("next/server"),
    "@/lib/server/schnellbestellung": {
      createCashSchnellOrder: async () => { calls++; if (code) throw new Error(code); return {order:{id:"FAST-1",total:12},customerNumber:1,reused:false}; },
      getSchnellSettings: async () => ({locationCheckEnabled:false}), SCHNELL_COOKIE:"session",
      verifySessionToken: () => ({deviceId:"device-A"}), isAndroidUserAgent: () => false,
    },
    "@/lib/server/request-security": { enforceRateLimit: async () => null, hasTrustedMutationOrigin: () => true,
      readRequestCookie: () => "signed-test-session" },
    "@/lib/server/shop-status": {getShopStatusFresh: async () => ({closed:false})},
  };
  vm.runInNewContext(compile(fs.readFileSync('app/api/schnellbestellung/orders/route.ts','utf8')),
    { exports, require: name => deps[name], performance, Date, String, Number, Math, Array, Error, console });
  return { post: body => exports.POST(new Request('https://example.test/api/schnellbestellung/orders', {
    method:'POST', headers:{'content-type':'application/json','idempotency-key':'retry-key-123456'}, body:JSON.stringify(body) })), calls: () => calls };
}
(async () => {
  for (const blocked of [false,true]) {
    const f = clientFixture({ blocked, deferred:true });
    const key = f.key(); assert.equal(f.key(),key,'retry key must remain stable with storage blocked');
    f.storage.setItem('bb_schnell_cart','old');
    const first = f.place(); const second = f.place();
    await second; assert.equal(f.fetchCount(),1,'same-frame double tap must submit only once');
    f.release(); await first;
    assert.equal(f.storage.getItem('bb_schnell_cart'),null);
    assert.equal(f.storage.getItem('bb_schnell_pending_order'),null);
    assert(f.events.some(([type,url]) => type==='push' && url.includes('order=FAST-1')),'successful order must navigate even when storage fails');
    assert.equal(f.scope.orderSubmitLockRef.current,false);
  }
  const invalid = clientFixture({payload:{ok:true}}); await invalid.place();
  assert(!invalid.events.some(([type]) => type==='push' || type==='cart'),'invalid success must preserve cart and retry key');
  const failed = clientFixture({abort:true}); const retryKey = failed.key(); await failed.place(); assert.equal(failed.key(),retryKey);
  assert(failed.events.some(([type,msg]) => type==='error' && msg.includes('Verbindung')));
  const expired = clientFixture({responseOk:false,payload:{error:'session_expired'}}); await expired.place();
  assert(expired.events.some(([type,url]) => type==='replace' && url==='/schnellbestellung/enter'));
  const foreign = { id:'OTHER', meta:{deviceId:'device-B',customerNumber:7} };
  for (const fixture of [{first:foreign},{inside:foreign}]) {
    const f = serverFixture(fixture); await assert.rejects(f.create(), /IDEMPOTENCY_CONFLICT/); assert.equal(f.counts().creates,0);
  }
  const owned = {id:'OWN',meta:{deviceId:'device-A',customerNumber:2}};
  for (const fixture of [{first:owned},{inside:owned}]) {
    const f = serverFixture(fixture); assert.equal((await f.create()).order.id,'OWN'); assert.equal(f.counts().creates,0);
  }
  const created = serverFixture({race:true}); const result = await created.create();
  assert.equal(result.reused,false); assert.equal(result.customerNumber,1); assert.equal(created.counts().creates,1); assert.equal(created.counts().transactions,2);
  assert.equal(created.row().mode,'dine_in'); assert.equal(created.row().status,'new'); assert.equal(created.row().meta.deviceId,'device-A');
  for (const payload of [null, [], "bad"]) {
    const f = routeFixture(); const response = await f.post(payload);
    assert.equal(response.status,400); assert.equal((await response.json()).error,"INVALID_ORDER_PAYLOAD"); assert.equal(f.calls(),0);
  }
  const conflict = routeFixture("IDEMPOTENCY_CONFLICT"); assert.equal((await conflict.post({items:[]})).status,409);
  const routeSuccess = routeFixture(); const routeResponse = await routeSuccess.post({items:[{productId:"burger",qty:1}]});
  assert.equal(routeResponse.status,200); assert.equal((await routeResponse.json()).orderId,"FAST-1");
  console.log('Schnell mobile order behavior: PASS (blocked storage, repeat key, double tap, response validation, timeout, session expiry, ownership and transaction retry)');
})().catch(e => { console.error(e); process.exitCode=1; });
