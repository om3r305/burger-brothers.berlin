const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = process.cwd();
let value;
let writes = 0;
const load = Module._load;
const resolve = Module._resolveFilename;
const forbidden = new Proxy({}, { get() { throw new Error('Sandbox touched production data'); } });
const setting = {
  findUnique: async ({where}) => { assert.equal(where.tenantId_key.key, 'driver_review_sandbox_v1'); return value ? {value} : null; },
  upsert: async ({where,create,update}) => {
    assert.equal(where.tenantId_key.key, 'driver_review_sandbox_v1');
    assert.equal(create.tenantId, 'tenant-test');
    value = structuredClone(update.value); writes++; return {value};
  },
};
Module._resolveFilename = function(request,...args) {
  if(request.startsWith('@/')) return path.join(root,request.slice(2)+'.ts');
  return resolve.call(this,request,...args);
};
Module._load = function(request,...args) {
  if(request === '@/lib/db') return {prisma: {setting, order:forbidden, trackingSession:forbidden, customer:forbidden, pushSubscription:forbidden},getTenantId:async()=> 'tenant-test'};
  return load.call(this,request,...args);
};
require.extensions['.ts'] = (module,file) => module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);

(async()=>{
 const demo = require('../lib/server/driver-review.ts');
 const policy = require('../lib/driver/review-identity.ts');
 assert.equal(policy.isDriverReviewSubject('App Review'),false);
 assert.equal(policy.isDriverReviewSubject('z17crutd'),true);
 for(const url of ['/api/orders','/api/admin/orders','/api/track/lookup','/api/track/route','/api/track/by-order/real','/api/orders/create']) {
   assert.equal(policy.driverReviewRequestAllowed(new Request('https://example.test'+url)),false,url);
 }
 assert.equal(policy.driverReviewRequestAllowed(new Request('https://example.test/api/orders/list')),true);
 assert.equal(policy.driverReviewRequestAllowed(new Request('https://example.test/api/orders/list',{method:'POST'})),false);
 await demo.resetDriverReview();
 let response = await demo.driverReviewList();
 let body = await response.json();
 assert.equal(body.orders.length,4); assert.equal(body.review,true);
 assert.ok(body.orders.every(o=>o.id.startsWith('review-driver-') && !o.customer.phone && !o.customer.email));
 assert.equal((await demo.driverReviewGet('REAL-ORDER')).status,404);
 const before = writes;
 assert.equal((await demo.driverReviewMutation('claim',{id:'REAL-ORDER'})).status,404);
 assert.equal((await demo.driverReviewMutation('status',{id:'review-driver-1',status:'done'})).status,403);
 assert.equal(writes,before);
 response = await demo.driverReviewMutation('claim',{id:'review-driver-1',driver:{id:'other'}});
 assert.equal((await response.json()).order.driver.id,'z17crutd');
 assert.equal((await demo.driverReviewMutation('status',{id:'review-driver-1',status:'done'})).status,403);
 response = await demo.driverReviewMutation('status',{id:'review-driver-1',status:'out_for_delivery'});
 assert.equal((await response.json()).order.status,'out_for_delivery');
 assert.equal((await demo.driverReviewNativeRoute()).status,200);
 assert.equal((await demo.driverReviewTracking({driverId:'other',orderIds:['review-driver-1']})).status,403);
 assert.equal((await demo.driverReviewTracking({driverId:'z17crutd',orderIds:['REAL-ORDER']})).status,403);
 assert.equal((await demo.driverReviewTracking({driverId:'z17crutd',orderIds:['review-driver-1'],lat:1,lng:1})).status,200);
 assert.equal((await demo.driverReviewNotification({orderId:'review-driver-1'})).status,200);
 assert.equal((await demo.driverReviewNotification({orderId:'REAL-ORDER'})).status,404);
 response = await demo.driverReviewMutation('status',{id:'review-driver-1',status:'done'});
 assert.equal((await response.json()).order.status,'done');
 assert.ok(!JSON.stringify(value).includes('"lat":1,'));
 await demo.resetDriverReview();
 body = await (await demo.driverReviewList()).json();
 assert.equal(body.orders[0].status,'ready'); assert.equal(body.orders[0].driver,null);
 console.log('PASS: isolated fixtures, deny real IDs, claim/start/complete, simulated notifications/tracking, reset, fail-closed route policy');
})().catch(e=>{console.error(e);process.exitCode=1;});
