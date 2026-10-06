const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
function load(path,requireFn){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText,{module:m,exports:m.exports,require:requireFn,Intl,Date});return m.exports;}
const themes=load('lib/assistant/bros-themes.ts',require);
const scenes=load('components/assistant/BrosThemeShow.tsx',require);
assert.deepEqual(Object.keys(scenes.BROS_SCENE_MOTIFS).sort(),Object.keys(themes.BROS_THEME_NOTES).sort());
for(const theme of Object.keys(themes.BROS_THEME_NOTES)){
 const html=renderToStaticMarkup(React.createElement(scenes.default,{theme,effect:themes.brosThemeNote(theme).effect}));
 assert.ok(html.includes(`data-scene="${theme}"`));
 assert.equal((html.match(/class="bb-bros-scene-particle"/g)||[]).length,8);
 assert.ok(!html.includes('<img')&&!html.includes('<video'));
}
// Run the real hook with a deterministic clock. Check behavior, not source strings.
let now=0,id=0,cursor=0,pending=[],slots=[],effects=[],result,args=[true,true,false];
const jobs=new Map(),storage=new Map(),doc={hidden:false,activeElement:{matches:()=>false},documentElement:{getAttribute:()=> 'lights'},addEventListener(){},removeEventListener(){}};
const win={setTimeout(fn,ms){jobs.set(++id,{fn,at:now+ms});return id;},clearTimeout(i){jobs.delete(i);},setInterval(fn,ms){jobs.set(++id,{fn,at:now+ms,interval:ms});return id;},clearInterval(i){jobs.delete(i);}};
const react={useState(v){const i=cursor++;if(!(i in slots))slots[i]=v;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v}];},useRef(v){const i=cursor++;return slots[i]||(slots[i]={current:v});},useCallback(fn){cursor++;return fn;},useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((v,j)=>v!==effects[i].deps[j]))pending.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});}};
const m={exports:{}};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/assistant/useBrosCompanion.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:m,exports:m.exports,require:n=>n==='react'?react:themes,window:win,document:doc,localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},MutationObserver:class{observe(){}disconnect(){}},Intl,Date});
function render(){cursor=0;result=m.exports.useBrosCompanion(...args);const queue=pending;pending=[];queue.forEach(fn=>fn());cursor=0;result=m.exports.useBrosCompanion(...args);const queue2=pending;pending=[];queue2.forEach(fn=>fn());}
function advance(ms){const end=now+ms;while(true){const next=[...jobs].filter(([,j])=>j.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;const [i,j]=next;now=j.at;if(j.interval)j.at+=j.interval;else jobs.delete(i);j.fn();render();}now=end;render();}
render();advance(1000);assert.match(result.bubble,/herzlich willkommen/);advance(7600);assert.equal(result.bubble,'');advance(5400);assert.equal(result.action,'showcase');assert.match(result.bubble,/Lichtshow/);advance(7000);assert.equal(result.action,'idle');assert.equal(result.bubble,'');advance(5000);assert.equal(result.action,'walk');advance(3200);assert.equal(result.action,'idle');advance(22800);assert.equal(result.action,'look');
args=[false,true,false];render();assert.equal(jobs.size,0);assert.equal(result.action,'idle');advance(100000);assert.equal(result.bubble,'');
console.log('Bros scenes PASS: 27 themes, welcome closes, show returns, varied idle actions, timers cancel when chat opens');
