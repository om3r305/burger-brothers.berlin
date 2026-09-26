const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const read = p => fs.readFileSync(p, 'utf8');
const ts = s => stripTypeScriptTypes(s);

async function checkoutTest(responses, expectedCalls, failure) {
  const page = read('app/checkout/page.tsx');
  const code = page.slice(page.indexOf('  async function createOrderWithRetryAndEmergency('), page.indexOf('\nfunction Field(')).replace(/\n}\s*$/, '');
  let calls = [], sleeps = 0;
  const ctx = { Error, Date, Math, String, AbortSignal,
    ORDER_RETRY_TOTAL_MS: 300000, ORDER_RETRY_INTERVAL_MS: 30000,
    createCheckoutIdempotencyKey: () => 'stable-test-key',
    reportCheckoutError() {}, clearActiveCoupon() {},
    parseOrderCreateEnvelope: x => x, recordValue: x => x || {},
    stringValue: x => typeof x === 'string' ? x : '', toNum: (x,d) => x ?? d,
    normalizePlannedHHMM: x => x || '', orderMode: 'pickup', avgPickupMinutes: 10, avgDeliveryMinutes: 35,
    setOrderRetryState() {}, sleep: async () => { sleeps++; },
    errorMessage: e => e.message,
    fetch: async (url, opts) => {
      calls.push(opts);
      assert.ok(opts.signal instanceof AbortSignal);
      const r = responses.shift();
      if (r instanceof Error) throw r;
      assert.ok(r, 'unexpected retry');
      return { status:r, ok:r===200, json:async()=>r===200?{ok:true,id:'order-1'}:{ok:false,error:'rejected'} };
    },
  };
  vm.createContext(ctx); vm.runInContext(ts(code),ctx);
  if (failure) await assert.rejects(ctx.createOrderWithRetryAndEmergency({}), /rejected/);
  else assert.equal((await ctx.createOrderWithRetryAndEmergency({})).id,'order-1');
  assert.equal(calls.length,expectedCalls);
  assert.equal(sleeps,expectedCalls-1);
  assert.ok(calls.every(c=>c.headers['Idempotency-Key']==='stable-test-key'));
}

function driverTest() {
  const source=read('lib/driver/domain.ts');
  const code=source.slice(source.indexOf('export function isOrderForTodayOrFresh('),source.indexOf('\nfunction normalizeExtra(')).replace('export ','');
  const ctx={Date,normalizeStatus:x=>x,todayKey:()=> 'today',orderDateFromId:()=>null,getOrderCreatedMs:o=>o.ts,getOrderDoneMs:o=>o.doneAt,toMsStrict:x=>x??null,dayKeyForMs:x=>x===2?'today':'yesterday'};
  vm.createContext(ctx);vm.runInContext(ts(code),ctx);
  assert.equal(ctx.isOrderForTodayOrFresh({status:'out_for_delivery',ts:1,meta:{}},'Europe/Berlin',1),true);
  assert.equal(ctx.isOrderForTodayOrFresh({status:'done',ts:1,meta:{}},'Europe/Berlin',1),false);
  assert.equal(ctx.isOrderForTodayOrFresh({status:'done',ts:1,doneAt:2,meta:{}},'Europe/Berlin',1),true);
}

async function tvTest() {
  const source=read('hooks/tv/use-tv-orders.ts').replace(/^import[\s\S]*?from "[^"]+";\n/gm,'').replace('export function','function');
  let values=[], index=0, fail=false;
  const now=Date.now();
  const rows=[{id:'old-active',ts:now-86400000,status:'out_for_delivery'},{id:'old-done',ts:now-86400000,status:'done'},{id:'today',ts:now,status:'preparing'}];
  const ctx={Date,Math,Number,Object,Set,console:{error(){}},
    useCallback:f=>f,useEffect:()=>{},useRef:v=>({current:v}),useState:v=>{const i=index++;values[i]=typeof v==='function'?v():v;return [values[i],x=>values[i]=typeof x==='function'?x(values[i]):x];},
    UNKNOWN_ORDER_GRACE_MS:1,
    fetchOrdersFromTvEndpoint:async()=>{if(fail)throw Error('offline');return rows;},
    autoDisplayStatus:o=>o.status,
    dayBoundsMs:()=>({start:now-1000,end:now+1000,key:'today'}),
    readTvClockCache:()=>({}),readTvFirstSeenCache:()=>({}),saveTvClockCache(){},saveTvFirstSeenCache(){},
    orderDateFromId:()=>null,getOrderExactCreatedMs:o=>o.ts,getOrderStartMs:o=>o.ts,
  };
  vm.createContext(ctx);vm.runInContext(ts(source),ctx);
  const hook=ctx.useTvOrders({avgPickup:10,avgDelivery:35,newGraceMin:5,timezone:'Europe/Berlin',nowMs:now,onNewOrders(){},notify(){}});
  await hook.refresh();
  assert.deepEqual(Array.from(values[0],o=>o.id),['old-active','today']);
  assert.ok(values[2]>0);
  fail=true;await hook.refresh();assert.match(values[1],/Keine Verbindung/);assert.equal(values[0].length,2);
  fail=false;await hook.refresh();assert.equal(values[1],'');
  hook.setOptimisticAcceptedOrder(rows[2],45);assert.equal(values[3].today,45);
  await hook.refresh();assert.equal(values[3].today,45,'pending save retains optimistic ETA');
  hook.releaseEtaOverride('today');assert.equal(values[3].today,undefined);
}
(async()=>{
  for(const status of [400,401,403,409,422,429]) await checkoutTest([status],1,true);
  await checkoutTest([503,200],2,false);
  await checkoutTest([new Error('network failure'),200],2,false);
  driverTest();await tvTest();
  console.log('PASS: terminal errors, transient retry, timeout signal, stable idempotency, midnight retention, TV stale warning/recovery and ETA save lifecycle');
})().catch(e=>{console.error(e);process.exit(1)});
