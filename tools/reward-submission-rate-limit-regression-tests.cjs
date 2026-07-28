const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const route = read('app/api/schnellbestellung/reward/submission/route.ts');
const client = read('components/rewards/RewardCelebration.tsx');

assert.match(route, /schnell:reward-submission-ip[\s\S]*80[\s\S]*10 \* 60_000/);
assert.match(route, /schnell:reward-submission-order[\s\S]*6[\s\S]*session\.deviceId[\s\S]*orderId/);
assert.doesNotMatch(route, /schnell:reward-submission", 8, 10 \* 60_000/);
assert.match(client, /rate_limited/);
assert.match(client, /Retry-After/);
assert.match(client, /\(Code: \$\{code\}\)/);

console.log('reward submission rate-limit regression tests: OK');
