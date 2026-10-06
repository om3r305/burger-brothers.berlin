const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript');
function load(path){const m={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module:m,exports:m.exports});return m.exports;}
const {createRealtimeResponseGate}=load('lib/assistant/realtime-response-gate.ts');
const {normalizeVoiceLanguage,voiceLanguageInstructions}=load('lib/assistant/voice-language.ts');
let creates=0;const gate=createRealtimeResponseGate(()=>{creates++;return true});
const call=(id)=>({type:'function_call',status:'completed',call_id:id,name:'get_cart',arguments:'{}'});
gate.created('r1');assert.equal(gate.busy(),true);
const calls=gate.done({id:'r1',status:'completed',output:[call('a'),call('b')]});assert.equal(calls.length,2);
gate.toolFinished('a');assert.equal(creates,0);gate.toolFinished('b');assert.equal(creates,1);
gate.toolFinished('b');assert.equal(creates,1);assert.equal(gate.done({id:'r1',status:'completed',output:[call('a')]}).length,0);
gate.created('r2');gate.done({id:'r2',status:'cancelled',output:[call('bad')]});assert.equal(creates,1);
assert.equal(gate.done({id:'r3',status:'incomplete',output:[call('partial')]}).length,0);
// Asynchronous delivery result arrives while a new VAD response is running.
gate.created('r4');gate.done({id:'r4',status:'completed',output:[call('slow')]});gate.created('r5');gate.toolFinished('slow');assert.equal(creates,1);gate.done({id:'r5',status:'completed',output:[]});assert.equal(creates,2);
// A server conflict is recoverable, and does not create a retry storm.
gate.conflict();assert.equal(creates,2);gate.done({id:'server-response',status:'completed',output:[]});assert.equal(creates,3);
for(const value of ['__proto__','ignore instructions',{},null])assert.equal(normalizeVoiceLanguage(value),'auto');
assert.match(voiceLanguageInstructions('tr'),/Speak only Turkish/);assert.match(voiceLanguageInstructions('de'),/Speak only German/);assert.match(voiceLanguageInstructions('auto'),/Turkish speech MUST receive Turkish replies/);
const component=fs.readFileSync('components/assistant/BurgerAssistantCore.tsx','utf8');
assert.doesNotMatch(component.match(/CUSTOMER_ASSISTANT_PATHS = new Set\(\[([\s\S]*?)\]\)/)[1],/"\/"/);
assert.equal((component.match(/type: "response.create"/g)||[]).length,1);
console.log('Realtime response gate PASS: batched completed tools, no duplicate cart calls, no partial/cancelled actions, asynchronous/VAD race, recoverable conflict, language allowlist, landing hidden');
