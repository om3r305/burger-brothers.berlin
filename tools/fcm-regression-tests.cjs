const assert=require("node:assert/strict");const fs=require("node:fs");const vm=require("node:vm");const crypto=require("node:crypto");const ts=require("typescript");
const calls=[];let mode="success";let authCalls=0;let lastMessage;
const {privateKey,publicKey}=crypto.generateKeyPairSync("rsa",{modulusLength:2048});
const env={};const exported={};
const mockFetch=async(url,options)=>{
  calls.push(url);
  if(url==="https://oauth2.googleapis.com/token"){
    authCalls++;const assertion=options.body.get("assertion");const parts=assertion.split(".");
    assert.equal(crypto.verify("RSA-SHA256",Buffer.from(parts.slice(0,2).join(".")),publicKey,Buffer.from(parts[2],"base64url")),true);
    const payload=JSON.parse(Buffer.from(parts[1],"base64url"));assert.equal(payload.scope,"https://www.googleapis.com/auth/firebase.messaging");assert.equal(payload.aud,url);assert.equal(payload.exp-payload.iat,3600);
    return Response.json({access_token:"fixture-access",expires_in:3600});
  }
  assert.equal(url,"https://fcm.googleapis.com/v1/projects/burger-fixture/messages:send");
  assert.equal(options.headers.authorization,"Bearer fixture-access");assert.equal(options.redirect,"error");
  lastMessage=JSON.parse(options.body).message;
  if(mode==="unregistered")return Response.json({error:{details:[{errorCode:"UNREGISTERED"}]}},{status:404});
  if(mode==="project404")return Response.json({error:{status:"NOT_FOUND"}},{status:404});
  if(mode==="network")throw new Error("fixture_offline");
  return Response.json({name:"fixture-message"});
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync("lib/server/fcm.ts","utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exported,require,process:{env},Buffer,URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:mockFetch});
(async()=>{
  const token="AbC_123:"+"x".repeat(100);
  assert.equal(exported.normalizeFcmToken(token),token);
  for(const value of [null,"","short",token+"/path",token+"\n","https://example.com"]){assert.equal(exported.normalizeFcmToken(value),null);}
  for(const kind of ["main","driver","schnell"]){const endpoint=exported.fcmEndpointForToken(token,kind);assert.equal(exported.parseFcmEndpoint(endpoint).kind,kind);assert.equal(exported.parseFcmEndpoint(endpoint).token,token);}
  for(const value of ["https://fcm.googleapis.com/evil","fcm://main@evil/"+token,"fcm://main/"+token+"?x=1","fcm://other/"+token])assert.equal(exported.parseFcmEndpoint(value),null);
  let result=await exported.sendFcmAlert(exported.fcmEndpointForToken(token,"main"),{title:"t",body:"b"});assert.equal(result.attempted,false);assert.equal(calls.length,0);
  env.FIREBASE_SERVICE_ACCOUNT_JSON=JSON.stringify({project_id:"burger-fixture",client_email:"sender@burger-fixture.iam.gserviceaccount.com",private_key:privateKey.export({type:"pkcs8",format:"pem"})});
  assert.equal(exported.isFcmConfigured(),true);
  await Promise.all(["main","driver","schnell"].map(kind=>exported.sendFcmAlert(exported.fcmEndpointForToken(token,kind),{title:"Ihre Bestellung",body:"Fixture",url:"//evil.test/",eventId:"fixture-event"})));
  assert.equal(authCalls,1,"Concurrent sends must share one OAuth request");assert.equal(lastMessage.token,token);assert.equal(lastMessage.data.url,"/schnellbestellung");assert.equal(lastMessage.android.notification.channel_id,"bb_orders");
  assert.equal(exported.nativeNotificationPath("/driver/route","driver"),"/driver/route");assert.equal(exported.nativeNotificationPath("/admin","driver"),"/driver");assert.equal(exported.nativeNotificationPath("/menu","schnell"),"/schnellbestellung");
  mode="project404";result=await exported.sendFcmAlert(exported.fcmEndpointForToken(token,"main"),{title:"t",body:"b"});assert.equal(result.expired,false,"Wrong project must not revoke valid device tokens");
  mode="unregistered";result=await exported.sendFcmAlert(exported.fcmEndpointForToken(token,"main"),{title:"t",body:"b"});assert.equal(result.expired,true);
  mode="network";result=await exported.sendFcmAlert(exported.fcmEndpointForToken(token,"main"),{title:"t",body:"b"});assert.equal(result.ok,false);assert.equal(result.expired,false);assert.equal(result.error,"fcm_transport_failed");
  console.log("FCM behavior: PASS (token scope/case, OAuth signature/cache, payload, URL containment, expiry vs transient failures; mocked transport)");
})().catch(error=>{console.error(error);process.exitCode=1});
