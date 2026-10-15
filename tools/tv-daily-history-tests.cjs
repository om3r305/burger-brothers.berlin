const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const transpile = path => ts.transpileModule(fs.readFileSync(path,'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function load(path, dependencies) {
  const mod={exports:{}};
  new Function('require','module','exports',transpile(path))(name=>{
    if (!(name in dependencies)) throw Error(`Unexpected import ${name}`);
    return dependencies[name];
  },mod,mod.exports);
  return mod.exports;
}
const domain=load('lib/tv/domain.ts',{'@/lib/brian':{normalizeStreet:x=>x}});
for (const [now,start,end] of [
  ['2026-10-15T22:12:00Z','2026-10-15T22:00:00Z','2026-10-16T21:59:59.999Z'],
  ['2026-03-29T12:00:00Z','2026-03-28T23:00:00Z','2026-03-29T21:59:59.999Z'],
  ['2026-10-25T12:00:00Z','2026-10-24T22:00:00Z','2026-10-25T22:59:59.999Z'],
]) {
  const bounds=domain.dayBoundsMs('Europe/Berlin',Date.parse(now));
  assert.equal(new Date(bounds.start).toISOString(),new Date(start).toISOString());
  assert.equal(new Date(bounds.end).toISOString(),new Date(end).toISOString());
}
const now=Date.now();
const bounds=domain.dayBoundsMs('Europe/Berlin');
const old=new Date(bounds.start-86400000), today=new Date(now);
const row=(id,mode,status,date,extra={})=>({id,tenantId:'tenant-test',mode,status,ts:date,createdAt:date,updatedAt:date,total:10,items:[],customer:{},meta:{},...extra});
const rows=[
 row('old-issued','dine_in','ready',old),
 row('today-issued','dine_in','ready',today),
 row('cross-midnight-issued','dine_in','ready',old,{meta:{readyAt:today.toISOString()}}),
 row('old-done','delivery','done',old,{doneAt:old}),
 row('done-today','delivery','done',old,{doneAt:today}),
 row('old-active','delivery','out_for_delivery',old),
 row('old-pickup-ready','pickup','ready',old),
 row('old-preparing','dine_in','preparing',old),
];
let reads=0;
const route=load('app/api/orders/list/route.ts',{
 'next/server':{NextResponse:{json:(body,options)=>({body,...options})}},
 '@prisma/client':{Prisma:{Decimal:class {},dmmf:{datamodel:{models:[{name:'Order',fields:['archivedAt','doneAt'].map(name=>({name}))}]}}}},
 '@/lib/db':{getTenantId:async()=> 'tenant-test',prisma:{order:{findMany:async args=>{reads++;assert.equal(args.where.tenantId,'tenant-test');return rows;}}}},
 '@/lib/server/payment-draft':{isPaymentDraft:()=>false,PAYMENT_DRAFT_STATUSES:['awaiting_payment']},
 '@/lib/server/request-security':{getSessionSubject:async()=>'',hasSessionRole:async(req,role)=>role==='admin',requireAnySessionRole:async()=>null,securityJson:()=>{throw Error('auth error');}},
 '@/lib/server/driver-order':{driverCanSeeOrder:()=>true,sanitizeOrderForDriver:x=>x},
});
(async()=>{
 const result=await route.GET(new Request('https://example.test/api/orders/list?view=tv&includeDone=1'));
 assert.equal(result.status,200,JSON.stringify(result.body));
 const ids=result.body.allOrders.map(x=>x.id);
 assert.deepEqual(ids,['today-issued','cross-midnight-issued','done-today','old-active','old-pickup-ready','old-preparing']);
 const history=await route.GET(new Request('https://example.test/api/orders/list?view=tv&all=1'));
 assert.equal(history.body.allOrders.length,rows.length,'explicit history access remains available');
 assert.equal(reads,2);
 console.log('PASS: TV daily API filters issued history, preserves active work/history, Berlin midnight and DST bounds');
})().catch(error=>{console.error(error);process.exit(1)});
