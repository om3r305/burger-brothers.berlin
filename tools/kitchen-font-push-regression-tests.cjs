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
const readyAlarm = read('lib/client/schnell-ready-alarm.ts');
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

assert.match(successPage, /prewarmSchnellPush\(\)/, 'push channel must be prewarmed on the success page');
assert.match(successPage, /bindSchnellPushToOrder\(orderId\)/, 'order push binding must be repaired on the success page');
assert.match(successPage, /readyOpenedFromNotification/, 'notification-open state must remain explicit');
assert.match(successPage, /BB_SCHNELL_NOTIFICATION_OPEN/, 'service-worker notification open message must be handled');
assert.match(successPage, /startSchnellReadyAlarm\(\)/, 'foreground ready alarm must start from the current alarm helper');
assert.match(successPage, /stopSchnellReadyAlarm\(\)/, 'foreground ready alarm cleanup must remain explicit');
assert.match(readyAlarm, /new Audio\("\/sounds\/dine-in\.wav"\)/, 'ready alarm must use the configured Schnell sound');

assert.match(pushClient, /subscriptionUsesPublicKey/, 'VAPID subscription key validation missing');
assert.match(pushClient, /existing\.unsubscribe\(\)/, 'stale VAPID subscription must be replaced');

assert.match(serviceWorker, /bb-push-state-v5/, 'service worker push state version was not refreshed');
assert.match(serviceWorker, /fetchJsonWithTimeout/, 'service worker pending fetch timeout missing');
assert.match(serviceWorker, /const schnellTask =[\s\S]*showSchnellReadyEvent/, 'Schnell notification task missing');
assert.match(serviceWorker, /const generalTask =/, 'general notification task missing');
assert.match(
  serviceWorker,
  /Promise\.allSettled\(\[schnellTask, generalTask\]\)/,
  'Schnell notification must not wait for the general pending endpoint',
);

console.log('kitchen typography / Schnell push regression tests: OK');
