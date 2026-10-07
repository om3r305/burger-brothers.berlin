const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
function load(file,requireFn,extra={}) {
 const m={exports:{}};
 const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(js,{module:m,exports:m.exports,require:requireFn,console,...extra});return m.exports;
}
(async()=>{
 let ai={voiceEnabled:false,assistantEnabled:true},unavailable=false,providerCalls=0;
 const route=load('app/api/assistant/realtime/route.ts',name=>{
  if(name==='@/lib/server/settings')return {getServerSettings:async()=>{if(unavailable)throw Error('offline');return {features:{ai}};}};
  if(name==='@/lib/server/request-security')return {hasTrustedMutationOrigin:()=>true,enforceRateLimit:async()=>null,securityJson:(value,status)=>Response.json(value,{status})};
  return {};
 },{process:{env:{}},Response,fetch:()=>{providerCalls++;throw Error('must not reach provider');}});
 const request=()=>new Request('https://burger-brothers.berlin/api/assistant/realtime',{method:'POST',body:'{}'});
 for(const controls of [{voiceEnabled:false,assistantEnabled:true},{voiceEnabled:true,assistantEnabled:false},{}]){
  ai=controls;const response=await route.POST(request());assert.equal(response.status,403);assert.equal((await response.json()).error,'voice_disabled');
 }
 unavailable=true;assert.equal((await route.POST(request())).status,503);unavailable=false;
 ai={voiceEnabled:true,assistantEnabled:true};const enabled=await route.POST(request());assert.equal((await enabled.json()).error,'voice_not_configured');assert.equal(providerCalls,0);
 let path='/',effects=0;
 const wrapper=load('components/assistant/BurgerAssistant.tsx',name=>{
  if(name==='react')return {...React,useRef:()=>({current:null}),useState:()=>[null,()=>{}],useEffect:()=>{effects++;}};
  if(name==='next/navigation')return {usePathname:()=>path};
  if(name==='next/dynamic')return {default:()=>()=>null};
  if(name==='@/lib/settings')return {readSettings:()=>({})};
  if(name==='react/jsx-runtime')return require(name);
  throw Error(name);
 }).default;
 for(path of ['/','/install','/tv','/admin/settings','/driver']){effects=0;assert.equal(renderToStaticMarkup(React.createElement(wrapper)),'');assert.equal(effects,0,'ineligible routes must not mount assistant effects');}
 for(path of ['/menu','/checkout','/menu/']){effects=0;renderToStaticMarkup(React.createElement(wrapper));assert.ok(effects>0,'customer ordering routes still mount controls');}
 console.log('Text-only/startup PASS: admin voice/master gates before provider, settings failure rejection, reversible enable, no assistant effects on landing/operational routes, menu/checkout preserved.');
})().catch(error=>{console.error(error);process.exitCode=1;});
