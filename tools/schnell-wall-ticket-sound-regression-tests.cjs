const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const proxy = read('print-proxy/index.cjs');
const successPage = read('app/schnellbestellung/success/page.tsx');
const schnellClient = read('components/schnellbestellung/SchnellClient.tsx');

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
  /lineSpace\(64\)[\s\S]*size\(2,2\)[\s\S]*underline\(1\)[\s\S]*upperReceipt\(group\)/,
  'group headings must use wall-readable 2x Font A',
);
assert.match(
  kitchenHelpers,
  /function pushSchnellKitchenHeroPricedLine[\s\S]*size\(2,2\), bold\(1\), doubleStrike\(1\)/,
  'main products must use large thick wall-readable text',
);
assert.match(
  kitchen,
  /size\(2,2\), text\(String\(ctx\.customerNumber\)\)/,
  'customer number must be reduced to 2x size',
);
assert.doesNotMatch(
  kitchen,
  /size\(3,3\), text\(String\(ctx\.customerNumber\)\)/,
  'old oversized customer number must not return',
);

const orderButtonIndex = schnellClient.indexOf('onClick={() => {\n                  primeReadyAudio();');
const placeOrderIndex = schnellClient.indexOf('void placeOrder();', orderButtonIndex);
assert.ok(orderButtonIndex >= 0 && placeOrderIndex > orderButtonIndex, 'audio must be primed from the final order button before placing the order');
assert.match(
  schnellClient,
  /new Audio\("\/sounds\/dine-in\.wav"\)[\s\S]*media\.play\(\)/,
  'the ready sound media element must be unlocked by the order gesture',
);
assert.match(
  schnellClient,
  /context\.resume\(\)\.then\(\(\) => \{/,
  'Web Audio context must be resumed from the order gesture',
);
assert.match(
  successPage,
  /if \(document\.visibilityState !== "visible"\) return;[\s\S]*lastReadyEventRef\.current = readyEventId;[\s\S]*playReadyAlert/,
  'background push must not consume the in-app sound event before the app becomes visible',
);
assert.doesNotMatch(
  successPage,
  /__bbSchnellReadyAudioContext\?\.suspend\(/,
  'unlocked audio context must not be suspended and re-locked on mobile PWA',
);

console.log('Schnell wall ticket / in-app sound regression tests: OK');
