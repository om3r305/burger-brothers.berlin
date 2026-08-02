const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const proxy = read('print-proxy/index.cjs');
const statusRoute = read('app/api/orders/status/route.ts');
const pushServer = read('lib/server/schnell-push.ts');
const successPage = read('app/schnellbestellung/success/page.tsx');

const kitchenStart = proxy.indexOf('function buildSchnellKitchenTicket');
const kitchenEnd = proxy.indexOf('async function buildPrintPayload');
assert.ok(kitchenStart >= 0 && kitchenEnd > kitchenStart, 'Schnell kitchen ticket block missing');
const kitchenBlock = proxy.slice(kitchenStart, kitchenEnd);

assert.match(kitchenBlock, /fontSel\(0\)/, 'real ESC/POS text Font A must be selected');
assert.match(kitchenBlock, /lineSpace\(36\)/, 'readable line spacing must be used');
assert.doesNotMatch(
  proxy.slice(proxy.indexOf('function pushSchnellKitchenWrapped'), kitchenEnd),
  /size\(1,\s*options\.height\s*\|\|\s*2\)/,
  'kitchen body must not vertically stretch every line',
);
assert.doesNotMatch(
  kitchenBlock,
  /size\(1,\s*2\).*upperReceipt\(group\)/s,
  'category headings must not be vertically stretched',
);
assert.match(proxy, /pushSchnellKitchenPricedLine/, 'controlled price wrapping helper missing');

assert.match(
  statusRoute,
  /next === "done"[\s\S]*previousStatus !== "ready"[\s\S]*previousStatus !== "done"/,
  'direct Ausgegeben must create a ready event when Fertig was skipped',
);
assert.match(
  statusRoute,
  /requestedStatus === "done"[\s\S]*Boolean\(updatedMeta\.readyEventId\)/,
  'Ausgegeben must retry the same ready push event',
);
assert.match(
  statusRoute,
  /await sendEmptySchnellPush\(subscriptionForPush, 4_000\)/,
  'Schnell ready push must be attempted before the status response finishes',
);
assert.match(pushServer, /timeoutMs = 4_000/, 'bounded push timeout missing');
assert.match(successPage, /retryDelays = \[0, 1_500, 5_000\]/, 'order push binding retries missing');
assert.match(successPage, /bindWithRetry/, 'push binding retry function missing');

console.log('kitchen font / Schnell push regression tests: OK');
