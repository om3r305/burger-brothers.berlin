const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const proxy = read('print-proxy/index.cjs');
const successPage = read('app/schnellbestellung/success/page.tsx');
const schnellClient = read('components/schnellbestellung/SchnellClient.tsx');
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
  /readyStartRetryIdsRef[\s\S]*scheduleReadyStartBurst[\s\S]*retryDelays = \[0, 50, 120, 220, 360, 550, 800, 1_100\]/,
  'notification-open sound must retry during the first second instead of waiting for polling',
);
assert.match(
  successPage,
  /getReadyMediaElement[\s\S]*media\.readyState < 2[\s\S]*media\.load\(\)/,
  'ready sound must be eagerly loaded before the notification opens the page',
);
assert.match(
  serviceWorker,
  /Promise\.all\([\s\S]*\[0, 50, 120, 250, 450, 700\][\s\S]*client\.postMessage\(openMessage\)/,
  'service worker must repeat the notification-open event during the first 700ms',
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
assert.match(
  schnellClient,
  /__bbSchnellReadyAudioBuffer[\s\S]*fetch\("\/sounds\/dine-in\.wav"[\s\S]*decodeAudioData/,
  'the order-button gesture must decode the real ready sound into the primed Web Audio context',
);
assert.match(
  successPage,
  /startPrimedWebAudioAlert[\s\S]*createBufferSource\(\)[\s\S]*source\.loop = true[\s\S]*context\.resume\(\)/,
  'the ready screen must play the real alert through the already-unlocked Web Audio context',
);
assert.match(
  successPage,
  /BB_SCHNELL_READY_PUSH[\s\S]*message\.type === "BB_SCHNELL_READY_PUSH"[\s\S]*tryStartReadyAlert\(eventId\)[\s\S]*scheduleReadyStartBurst/,
  'background push must arm the old proven audio path before the notification is tapped',
);
assert.match(
  successPage,
  /createDynamicsCompressor[\s\S]*oscillator\.type = index % 2 === 0 \? "square" : "sawtooth"/,
  'the original Web Audio alarm must remain as a fallback when the decoded file is unavailable',
);
assert.match(
  successPage,
  /stopReadyAlert\(readyTimeoutIdsRef\.current, true\)[\s\S]*Bestellung beenden/,
  'Bestellung beenden must stop and suspend every active alert channel',
);

console.log('Schnell final ticket / notification-click sound regression tests: OK');
