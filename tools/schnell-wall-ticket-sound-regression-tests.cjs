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
  /fontSel\(0\)[\s\S]*size\(1,1\)[\s\S]*bold\(0\)[\s\S]*underline\(1\)[\s\S]*upperReceipt\(group\)/,
  'group headings must be smaller, regular-weight and underlined',
);
assert.match(
  kitchenHelpers,
  /function pushSchnellKitchenHeroPricedLine[\s\S]*const bigWidth = 28;[\s\S]*fontSel\(1\), lineSpace\(38\), size\(2,1\), bold\(1\), doubleStrike\(1\)[\s\S]*fontSel\(0\)/,
  'main products must use wide single-height bold Font B text',
);
assert.doesNotMatch(
  kitchenHelpers,
  /pushSchnellKitchenHeroPricedLine[\s\S]*size\(2,2\)/,
  'oversized 2x2 product text must not return',
);
assert.match(
  kitchenHelpers,
  /pushSchnellKitchenWrapped\(out, '   \+ ', extraName, \{ boldText:true \}\)/,
  'extras must stay normal-size and become bold',
);
assert.match(
  kitchen,
  /size\(2,1\), text\(String\(ctx\.customerNumber\)\)[\s\S]*text\('ZUM MITNEHMEN'\)/,
  'customer number and takeaway label must use the reduced footer size',
);
assert.doesNotMatch(
  kitchen,
  /size\(2,2\), text\(String\(ctx\.customerNumber\)\)/,
  'oversized customer number must not return',
);

assert.match(
  serviceWorker,
  /notificationclick[\s\S]*pathname !== "\/schnellbestellung\/success"[\s\S]*client\.postMessage\(openMessage\)[\s\S]*await client\.focus\(\)[\s\S]*client\.postMessage\(openMessage\)/,
  'notification click must focus the waiting success page without navigating it',
);
assert.match(
  serviceWorker,
  /Navigation reloads the document and destroys the audio channel/,
  'service worker must document the iOS audio-channel preservation rule',
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
  /scheduleNextRound[\s\S]*__bbSchnellReadyAlertGeneration[\s\S]*1_800/,
  'ready sound must repeat automatically with a stop-safe generation guard',
);
assert.match(
  successPage,
  /data-schnell-finish="true"[\s\S]*onClick=\{finish\}/,
  'Bestellung beenden must stop the active alert',
);
assert.doesNotMatch(
  successPage,
  /Ton einschalten|readySoundBlocked/,
  'manual sound button must be removed',
);
assert.doesNotMatch(
  successPage,
  /__bbSchnellReadyStopWebAudio|createDynamicsCompressor|oscillator\.type =/,
  'synthetic delayed Web Audio alert must be removed',
);

console.log('Schnell final ticket / notification-click sound regression tests: OK');
