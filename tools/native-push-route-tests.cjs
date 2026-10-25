const assert=require("node:assert/strict");const fs=require("node:fs");const vm=require("node:vm");const ts=require("typescript");const crypto=require("node:crypto");
function load(file,mocks){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,require:id=>{if(id in mocks)return mocks[id];throw new Error("Unexpected dependency: "+id)},process:{env:{}},Buffer,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:()=>{throw new Error("Real network forbidden in regression test")}});return exports;}
const fcm=load("lib/server/fcm.ts",{"node:crypto":crypto});
const origin="https://www.burger-brothers.berlin";const token="fixture_TOKEN:"+"x".repeat(100);let mutations=[];let signedDriver="driver-1";let credentialDriver="driver-1";
const security={
  requireMutationRole:async req=>req.headers.get("origin")!==origin?Response.json({ok:false},{status:403}):req.headers.get("x-fixture-role")!=="driver"?Response.json({ok:false},{status:401}):null,
  requireSessionRole:async req=>req.headers.get("x-fixture-role")==="driver"?null:Response.json({ok:false},{status:401}),
  getSessionSubject:async()=>signedDriver,enforceRateLimit:async()=>null,readRequestCookie:()=>"signed-cookie",securityJson:(body,status=200)=>Response.json(body,{status}),
};
const db={pushSubscription:{upsert:async input=>{mutations.push(input);return {id:"device-1",...input.create}},updateMany:async input=>{mutations.push(input);return {count:1}}},order:{findMany:async input=>{assert.equal(input.where.mode,"delivery");assert.equal(input.where.status,"out_for_delivery");return [{id:"own",driver:{id:"driver-1"},meta:{}},{id:"other",driver:{id:"driver-2"},meta:{}}]}},trackingSession:{updateMany:async input=>{mutations.push(input);return {count:1}}}};
const database={prisma:db,getTenantId:async()=>"tenant-1"};
const session={readSessionToken:async()=>({sub:credentialDriver,credential:"credential-version-hash",exp:Math.floor(Date.now()/1000)+3600})};
const driverPushRoute=load("app/api/native/driver/push/route.ts",{"@/lib/db":database,"@/lib/server/fcm":{...fcm,isFcmConfigured:()=>true},"@/lib/server/native-driver-push":{DRIVER_PUSH_SCOPE:"driver_app",newDriverDeviceHash:()=>"opaque-device-hash"},"@/lib/server/session":session,"@/lib/server/request-security":security});
const route=load("app/api/native/driver/route/route.ts",{"@/lib/db":database,"@/lib/server/request-security":security});
function req(body,role="driver",requestOrigin=origin,method="POST"){return new Request(origin+"/api/native/driver/push",{method,headers:{origin:requestOrigin,"x-fixture-role":role,"content-type":"application/json"},...(method==="GET"?{}:{body:JSON.stringify(body)})});}
(async()=>{
  assert.equal((await driverPushRoute.POST(req({token},"customer"))).status,401);assert.equal(mutations.length,0);
  assert.equal((await driverPushRoute.POST(req({token},"driver","https://evil.test"))).status,403);assert.equal(mutations.length,0);
  assert.equal((await driverPushRoute.POST(req({token:"invalid"}))).status,400);assert.equal(mutations.length,0);
  credentialDriver="other-driver";assert.equal((await driverPushRoute.POST(req({token}))).status,401);assert.equal(mutations.length,0);credentialDriver="driver-1";
  assert.equal((await driverPushRoute.POST(req({token,driverId:"attacker",appScope:"customer_app"}))).status,200);
  let saved=mutations.pop();assert.equal(saved.create.deviceId,"driver-1");assert.equal(saved.create.tenantId,"tenant-1");assert.equal(saved.create.appScope,"driver_app");assert.equal(saved.create.endpoint,fcm.fcmEndpointForToken(token,"driver"));assert.equal(saved.create.auth,"credential-version-hash");assert.ok(saved.create.expirationTime>Date.now());
  assert.equal((await driverPushRoute.DELETE(req({token,driverId:"attacker"}))).status,200);saved=mutations.pop();assert.equal(saved.where.deviceId,"driver-1");assert.equal(saved.where.appScope,"driver_app");
  const response=await route.GET(req(null,"driver",origin,"GET"));const data=await response.json();assert.deepEqual(data.orderIds,["own"]);assert.equal(data.driverId,"driver-1");assert.equal("customer" in data,false);
  assert.equal((await route.POST(req({active:true}))).status,400);assert.equal(mutations.length,0);
  assert.equal((await route.POST(req({active:false,driverId:"attacker"}))).status,200);saved=mutations.pop();assert.equal(saved.where.driverId,"driver-1");assert.equal(saved.where.tenantId,"tenant-1");assert.equal(saved.data.active,false);
  const devices=[];const events=[];let sends=0;let transient=false;let accountCurrent=true;
  const order={id:"order-1",tenantId:"tenant-1",mode:"delivery",status:"ready",driver:{id:"driver-1"},meta:{deviceId:"schnell-device",readyEventId:"ready-1"}};
  const queueDb={
    pushSubscription:{findMany:async()=>devices,upsert:async input=>({id:"schnell-sub",...input.create}),update:async()=>({})},
    notificationEvent:{create:async input=>{const event={id:"event-"+events.length,...input.data};events.push(event);return event},update:async input=>{mutations.push(input);return input.data},findMany:async()=>events.map(event=>({...event,subscription:devices[0],order}))},
  };
  const queueMocks={"node:crypto":crypto,"@/lib/db":{prisma:queueDb,getTenantId:async()=>"tenant-1"},"@/lib/server/fcm":{...fcm,sendFcmAlert:async()=>{sends++;return {attempted:true,ok:!transient,expired:false,status:transient?503:200}}}};
  const domain=load("lib/server/driver-order.ts",{});
  const driverQueue=load("lib/server/native-driver-push.ts",{...queueMocks,"@/lib/server/driver-order":domain,"@/lib/server/driver-session":{driverSessionIsCurrent:async()=>accountCurrent}});
  devices.push({id:"driver-sub-1",deviceId:"driver-1",endpoint:fcm.fcmEndpointForToken(token,"driver"),appScope:"driver_app",active:true,auth:"hash",expirationTime:new Date(Date.now()+3600000)});
  devices.push({...devices[0],id:"driver-sub-2",deviceId:"driver-2"});
  assert.equal((await driverQueue.notifyNativeDriversForOrder(order,"new","ready")).sent,1);assert.equal(sends,1,"Only assigned driver receives delivery alert");
  order.status="done";await driverQueue.flushNativeDriverNotifications();assert.equal(sends,1,"Completed delivery must not retry stale alerts");
  order.status="ready";accountCurrent=false;await driverQueue.notifyNativeDriversForOrder(order,"new","ready");assert.equal(sends,1,"Revoked driver credential must not receive alerts");accountCurrent=true;
  const schnellQueue=load("lib/server/native-schnell-push.ts",{...queueMocks,"@/lib/server/schnellbestellung":{getSchnellSettings:async()=>({backgroundReadyPushEnabled:true})}});
  const before=sends;await schnellQueue.queueNativeSchnellReady({...order,tenantId:"other-tenant"},{endpoint:fcm.fcmEndpointForToken(token,"schnell")});assert.equal(sends,before);
  await schnellQueue.queueNativeSchnellReady({...order,channel:"website"},{endpoint:fcm.fcmEndpointForToken(token,"schnell")});assert.equal(sends,before,"Non-Schnell orders cannot create Schnell alerts");
  transient=true;const result=await schnellQueue.queueNativeSchnellReady({...order,channel:"schnellbestellung"},{endpoint:fcm.fcmEndpointForToken(token,"schnell")});assert.equal(result.ok,false);assert.equal(mutations.at(-1).data.status,"queued","Transient Schnell delivery failure remains queued");
  assert.equal(mutations.at(-1).data.availableAt>Date.now(),true);
  console.log("Native push routes/queues: PASS (role/origin gates, session-derived identity, tenant/order containment, stop-only mutation, driver revocation, stale order expiry, Schnell transient retry; mocked DB/transport)");
})().catch(error=>{console.error(error);process.exitCode=1});
