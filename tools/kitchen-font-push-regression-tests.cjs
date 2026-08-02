const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const proxy = read('print-proxy/index.cjs');
const statusRoute = read('app/api/orders/status/route.ts');
const pushServer = read('lib/server/schnell-push.ts');
const pushClient = read('lib/client/schnell-push.ts');
const successPage = read('app/schnellbestellung/success/page.tsx');
const serviceWorker = read('public/sw.js');

const kitchenStart = proxy.indexOf('function buildSchnellKitchenTicket');
const kitchenEnd = proxy.indexOf('async function buildPrintPayload');
assert.ok(kitchenStart >= 0 && kitchenEnd > kitchenStart, 'Schnell kitchen ticket block missing');
const kitchenBlock = proxy.slice(kitchenStart, kitchenEnd);
const kitchenHelpers = proxy.slice(
  proxy.indexOf('function pushSchnellKitchenWrapped'),
  kitchenEnd,
);

assert.match(kitchenBlock, /fontSel\(0\)/, 'real ESC/POS text Font A must be selected');
assert.match(proxy, /const doubleStrike = on=> Buffer\.from\(\[ESC,0x47,on\?1:0\]\)/, 'double-strike helper missing');
assert.match(
  kitchenHelpers,
  /fontSel\(1\), lineSpace\(38\), size\(2,1\), bold\(1\), doubleStrike\(1\)/,
  'main product rows must use readable wide single-height bold text',
);
assert.match(
  kitchenBlock,
  /fontSel\(0\)[\s\S]*size\(1,1\)[\s\S]*bold\(0\)[\s\S]*underline\(1\)[\s\S]*upperReceipt\(group\)/,
  'category headings must be smaller, regular-weight and underlined',
);
assert.match(
  kitchenHelpers,
  /size\(1,1\), fontSel\(0\), lineSpace\(36\)/,
  'font and line spacing must reset after emphasized rows',
);
assert.match(proxy, /pushSchnellKitchenPricedLine/, 'controlled price wrapping helper missing');
assert.match(kitchenHelpers, /pushSchnellKitchenWrapped\(out, '   \+ ', extraName, \{ boldText:true \}\)/, 'extras must stay normal-size but bold');

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
assert.match(successPage, /primeReadyAudioChannel/, 'foreground audio unlock helper missing');
assert.match(successPage, /pointerdown[\s\S]*touchend[\s\S]*keydown/, 'audio must retry on a real user gesture');
assert.match(
  successPage,
  /const isNewReadyEvent =[\s\S]*lastReadyEventRef\.current !== readyEventId/,
  'new ready events must be detected independently of status=ready',
);
assert.match(
  successPage,
  /if \(isNewReadyEvent\)[\s\S]*tryStartReadyAlert/,
  'Fertig or direct Ausgegeben must trigger foreground sound once',
);

assert.match(pushClient, /subscriptionUsesPublicKey/, 'VAPID subscription key validation missing');
assert.match(pushClient, /existing\.unsubscribe\(\)/, 'stale VAPID subscription must be replaced');

assert.match(serviceWorker, /bb-push-state-v4/, 'service worker push state version was not refreshed');
assert.match(serviceWorker, /fetchJsonWithTimeout/, 'service worker pending fetch timeout missing');
assert.match(serviceWorker, /const schnellTask =[\s\S]*showSchnellReadyEvent/, 'Schnell notification task missing');
assert.match(serviceWorker, /const generalTask =/, 'general notification task missing');
assert.match(
  serviceWorker,
  /Promise\.allSettled\(\[schnellTask, generalTask\]\)/,
  'Schnell notification must not wait for the general pending endpoint',
);

console.log('kitchen typography / Schnell push regression tests: OK');
