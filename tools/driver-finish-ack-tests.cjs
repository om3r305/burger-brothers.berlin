const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const compile = source => ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const current={id:'driver-test',name:'Driver Test'};
const order={id:'test-order',orderId:'test-order',mode:'delivery',status:'out_for_delivery',ts:Date.now(),items:[],customer:{},meta:{driver:current},driver:current};
function loadDomain(source,response) {
  const mod={exports:{}}; const calls=[]; let localWrites=0;
  new Function('require','module','exports','fetch',compile(source))((name)=>{
    if(name==='@/lib/orders') return {setOrderStatus:()=>{localWrites++;},upsertOrder:()=>{}};
    throw Error(name);
  },mod,mod.exports,async(url,options)=>{calls.push({url,options});if(response instanceof Error)throw response;return {ok:response.status>=200&&response.status<300,status:response.status,json:async()=>response.body};});
  return {domain:mod.exports,calls,get writes(){return localWrites;}};
}
async function transportTests(){
  const source=fs.readFileSync('lib/driver/domain.ts','utf8');
  for(const status of [403,409,429,500,503]){
    const test=loadDomain(source,{status,body:{ok:false,error:'driver_status_transition_not_allowed'}});
    await assert.rejects(test.domain.updateOrderStatusOnServer(order,'done',current),/Fahrt starten/);
    assert.equal(test.writes,0);assert.equal(test.calls.length,1);
  }
  const expired=loadDomain(source,{status:401,body:{ok:false}});
  await assert.rejects(expired.domain.updateOrderStatusOnServer(order,'done',current),e=>e.name==='DriverSessionExpiredError');
  const offline=loadDomain(source,new Error('network offline'));
  await assert.rejects(offline.domain.updateOrderStatusOnServer(order,'done',current),/network offline/);
  for(const body of [{ok:true},{ok:true,order},{ok:true,order:{...order,id:'wrong',status:'done'}}]){
    const test=loadDomain(source,{status:200,body});
    await assert.rejects(test.domain.updateOrderStatusOnServer(order,'done',current),/nicht bestätigt/);
  }
  const acknowledged=loadDomain(source,{status:200,body:{ok:true,order:{...order,status:'done',meta:{}}}});
  assert.equal((await acknowledged.domain.updateOrderStatusOnServer(order,'done',current)).status,'done');
}
async function hookTests(){
  const source=fs.readFileSync('hooks/driver/use-driver-orders.ts','utf8');
  const start=source.indexOf('  const finishOne = useCallback(');
  const end=source.indexOf('\n  const ',start+15)>0?source.indexOf('\n  const ',start+15):source.indexOf('\n  return {',start);
  const snippet=source.slice(start,end);
  async function run(status,reject){
    let rows=[{...order,status}], calls=0, completions=0; const notices=[];
    const dependencies={useCallback:f=>f,current,isDriverOrder:()=>true,normalizeStatus:x=>x,notify:(...v)=>notices.push(v),markBusy:()=>{},clearPosKey:()=>{},orderTipAmount:()=>0,orderPayableTotal:()=>10,withDriverState:(o,d,s)=>({...o,status:s}),setOrders:f=>{rows=f(rows);},updateOrderStatusOnServer:async()=>{calls++;if(reject)throw Error('server rejected');return {...order,status:'done',meta:{}};},upsertOrder:()=>{},toStoredOrder:x=>x,showCompletion:()=>{completions++;},refresh:async()=>{},window:{dispatchEvent:()=>{}},CustomEvent:class{},Date};
    const names=Object.keys(dependencies);
    const finish=new Function(...names,compile(snippet)+'\nreturn finishOne;')(...Object.values(dependencies));
    const result=await finish(rows[0]);return {result,rows,calls,completions,notices};
  }
  const unstarted=await run('preparing',false);assert.equal(unstarted.result,false);assert.equal(unstarted.calls,0);assert.equal(unstarted.completions,0);
  const failed=await run('out_for_delivery',true);assert.equal(failed.result,false);assert.equal(failed.rows[0].status,'out_for_delivery');assert.equal(failed.completions,0);
  const completed=await run('out_for_delivery',false);assert.equal(completed.result,true);assert.equal(completed.rows[0].status,'done');assert.equal(completed.completions,1);
}
(async()=>{await transportTests();await hookTests();console.log('PASS: rejected, offline, expired, malformed and wrong-order responses fail closed; only confirmed completion shows success; departure guard and rollback work');})().catch(e=>{console.error(e);process.exit(1);});
