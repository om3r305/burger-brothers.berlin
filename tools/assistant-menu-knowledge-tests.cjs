const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const source = fs.readFileSync('components/assistant/BurgerAssistantCore.tsx', 'utf8');
const begin = source.indexOf('function compactMenuToolProduct(');
const end = source.indexOf('\nfunction searchMenuCatalog(', begin);
const js = ts.transpileModule(source.slice(begin, end), { compilerOptions: { target: ts.ScriptTarget.ES2020 }}).outputText;
const compact = new Function(`${js}; return compactMenuToolProduct;`)();
const input = {id:'big', name:'Big Daddy',category:'burger',displayPrice:10.5,description:'mit Salat, doppelt Bacon, doppelt Fleisch, doppelt Cheddarkäse',allergens:['A1','M'],extras:[{id:'bbq',name:'BBQ Sauce',price:0.7}]};
const result = compact(input);
assert.equal(result.description,input.description);
assert.deepEqual(result.allergens,['A1','M']);
assert.equal(result.productId,'big');
assert.equal(result.extras[0].id,'bbq');
assert.ok(!result.description.includes('BBQ'), 'optional sauce must not become part of the recipe');
assert.equal(compact({...input,description:'x'.repeat(2000),allergens:Array(30).fill('M')}).description.length,1000);
assert.equal(compact({...input,allergens:Array(30).fill('M')}).allergens.length,20);
const knowledge = fs.readFileSync('lib/assistant/menu-knowledge.ts','utf8');
for(const route of ['chat','realtime']){
 const text = fs.readFileSync(`app/api/assistant/${route}/route.ts`,'utf8');
 assert.ok(text.includes('${RESTAURANT_MENU_KNOWLEDGE}'), `${route} receives the same trusted restaurant facts`);
}
assert.ok(knowledge.includes('not pork/Schwein'));
assert.ok(knowledge.includes('certificate is displayed inside'));
assert.ok(knowledge.includes('OPTIONAL paid additions'));
assert.ok(knowledge.includes('not to chicken, fish, salads, vegan'));
assert.ok(knowledge.includes('cross-contact'));
assert.ok(fs.readFileSync('components/CategoryBlurb.tsx','utf8').includes('@/lib/menu-descriptions'));
console.log('Menu knowledge PASS: live recipe/allergens retained, optional extras separate, bounded payload, shared menu defaults and owner facts in text/voice.');
