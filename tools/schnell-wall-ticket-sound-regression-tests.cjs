const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const proxy = read('print-proxy/index.cjs');
const successPage = read('app/schnellbestellung/success/page.tsx');
const serviceWorker = read('public/sw.js');

const kitchenStart = proxy.indexOf('function buildSchnellKitchenTicket');
const kitchenEnd = proxy.indexOf('async function buildPrintPayload');
assert.ok(kitchenStart >= 0 && kitchenEnd > kitchenStart, 'Schnell kitchen block missing');
const kitchen = proxy.slice(kitchenStart, kitchenEnd);
const kitchenHelpers = proxy.slice(
  proxy.indexOf('function pushSchnellKitchenWrapped'),
  kitchenEnd,
);

assert.match(
  kitchen,
  /align\(1\), bold\(1\), text\('SCHNELLBESTELLUNG'\), bold\(0\), align\(0\)[\s\S]*twoCol\(ctx\.when\.date, ctx\.when\.time\)/,
  'Schnellbestellung must be centered with date/time underneath',
);
assert.match(
  kitchen,
  /fontSel\(1\)[\s\S]*lineSpace\(50\)[\s\S]*size\(2,2\)[\s\S]*underline\(1\)[\s\S]*upperReceipt\(group\)[\s\S]*fontSel\(0\)/,
  'group headings must use intermediate Font B 2x2 and restore Font A',
);
assert.match(
  kitchenHelpers,
  /function pushSchnellKitchenHeroPricedLine[\s\S]*const bigWidth = 28;[\s\S]*fontSel\(1\), lineSpace\(50\), size\(2,2\), bold\(1\), doubleStrike\(1\)[\s\S]*fontSel\(0\)/,
  'main products must use intermediate thick Font B 2x2 text',
);
assert.doesNotMatch(
  kitchenHelpers,
  /pushSchnellKitchenHeroPricedLine[\s\S]*lineSpace\(64\), size\(2,2\)/,
  'oversized Font A wall text must not return',
);
assert.match(
  kitchen,
  /size\(2,2\), text\(String\(ctx\.customerNumber\)\)/,
  'customer number must stay at reduced 2x size',
);
assert.doesNotMatch(
  kitchen,
  /size\(3,3\), text\(String\(ctx\.customerNumber\)\)/,
  'old oversized customer number must not return',
);

assert.match(
  serviceWorker,
  /notificationclick[\s\S]*readyOpen[\s\S]*readyEventId[\s\S]*BB_SCHNELL_NOTIFICATION_OPEN/,
  'notification click must carry the ready event into the opened success page',
);
assert.match(
  successPage,
  /openedFromReadyPush[\s\S]*readyEventFromPush[\s\S]*tryStartReadyAlert/,
  'success page must immediately retry sound when opened from a ready notification',
);
assert.match(
  successPage,
  /window\.addEventListener\("focus", retryPendingAlert\)[\s\S]*window\.addEventListener\("pageshow", retryPendingAlert\)[\s\S]*visibilitychange/,
  'pending ready sound must retry when the PWA becomes visible after notification tap',
);
assert.match(
  successPage,
  /await Promise\.race\([\s\S]*context\.resume\(\)[\s\S]*280/,
  'blocked Web Audio resume must not remain pending until the finish button',
);
assert.match(
  successPage,
  /__bbSchnellReadyStopWebAudio[\s\S]*source\.stop\(\)[\s\S]*node\.disconnect\(\)/,
  'scheduled Web Audio nodes must be stoppable by Bestellung beenden',
);
assert.match(
  successPage,
  /data-schnell-finish="true"[\s\S]*onClick=\{finish\}/,
  'finish button must be excluded from sound-unlock fallback and stop the alert',
);
assert.match(
  successPage,
  /readySoundBlocked[\s\S]*Ton einschalten/,
  'iOS autoplay rejection must have an explicit sound activation fallback',
);

console.log('Schnell tuned ticket / notification-open sound regression tests: OK');
