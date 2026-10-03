const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const assert = require('node:assert/strict');
const compile = source => ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const mod = {exports:{}};
vm.runInNewContext(compile(fs.readFileSync('lib/server/payment-draft.ts','utf8')), {exports:mod.exports,module:mod});
const {isPaymentDraft} = mod.exports;
const rows = [
  {id:'real',status:'new',meta:{}},
  ...['payment_pending','payment_completed','refund_pending','refund_failed'].map(status=>({id:status,status,meta:{}})),
  {id:'draft-with-legacy-status',status:'new',meta:{paymentSession:{state:'failed'}}},
  {id:'real-cancelled',status:'cancelled',meta:{payment:{status:'refunded'}}},
];
const source = fs.readFileSync('app/api/orders/list/route.ts','utf8');
const filter = source.slice(source.indexOf('    let allOrders = rows'),source.indexOf('.map(serializeOrder);')+'.map(serializeOrder);'.length);
const ctx = {rows,isPaymentDraft,serializeOrder:r=>r};
vm.runInNewContext(compile(filter+'\nglobalThis.orders = allOrders;'),ctx);
assert.deepEqual(Array.from(ctx.orders,r=>r.id),['real','real-cancelled']);
// Warm tenant caches must not substitute for a real query.
const create = fs.readFileSync('app/api/orders/create/route.ts','utf8');
const probe = create.slice(create.indexOf('async function databaseUnavailableForEmergency()'),create.indexOf('\nasync function handleEmergencyOrder('));
let calls=0, unavailable=false;
const probeCtx = {setTimeout,clearTimeout,Promise,prisma:{$queryRaw:async()=>{calls++;if(unavailable) throw Error('database down');return [{one:1}];}},getTenantId:()=>{throw Error('must not use cached tenant');}};
vm.runInNewContext(compile(probe),probeCtx);
(async()=>{
  const payloadGuard = create.slice(create.indexOf('  const order = body?.order'), create.indexOf('  const rawIdempotencyKey'));
  const payloadCtx = {NextResponse:require('next/server').NextResponse};
  vm.runInNewContext(compile('function validatePayload(body) { '+payloadGuard+' return null; }'), payloadCtx);
  for (const body of [null, false, 1, "text", [], {order:[]}]) {
    const result = payloadCtx.validatePayload(body);
    assert.equal(result.status,400);
    assert.equal((await result.json()).error,'INVALID_ORDER_PAYLOAD');
  }
  assert.equal(payloadCtx.validatePayload({order:{items:[]}}), null);
  assert.equal(await probeCtx.databaseUnavailableForEmergency(),false);
  unavailable=true;
  assert.equal(await probeCtx.databaseUnavailableForEmergency(),true);
  assert.equal(calls,2);
  console.log('TV excludes payment drafts and legacy refund states; emergency probe executes fresh SQL.');
})().catch(e=>{console.error(e);process.exitCode=1;});
