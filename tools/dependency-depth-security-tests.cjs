const assert = require('node:assert/strict');
const braces = require('braces');
assert.deepEqual(braces.expand('a/{b,c}/d'), ['a/b/d', 'a/c/d']);
assert.deepEqual(braces.expand('x/{1..3}.ts'), ['x/1.ts', 'x/2.ts', 'x/3.ts']);
for (const method of ['parse', 'compile', 'expand', 'stringify']) {
  for (const pattern of ['{'.repeat(4000)+'a'+ '}'.repeat(4000), '('.repeat(4000)+'a'+')'.repeat(4000)])
    assert.throws(() => braces[method](pattern), e => e instanceof SyntaxError && /safe depth/.test(e.message));
}
let ast = {type: 'text', value: 'a'};
for(let i=0; i<8000; i++) ast = {type:'brace', nodes:[ast]};
for (const method of ['compile', 'expand', 'stringify'])
  assert.throws(() => braces[method](ast), e => e instanceof SyntaxError && /safe depth/.test(e.message));
console.log('Dependency depth guard rejects hostile strings and ASTs; normal glob expansion preserved.');
