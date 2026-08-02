const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const proxyPath = path.join(root, 'print-proxy', 'index.cjs');
const logoPath = path.join(root, 'print-proxy', 'logo-thermal.bmp');
const proxyToken = 'layout-regression-token-0123456789abcdef';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`print-proxy exited early with ${child.exitCode}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: {
          origin: 'https://www.burger-brothers.berlin',
          'x-print-proxy-token': proxyToken,
        },
      });
      if (response.ok) return;
    } catch {}
    await wait(100);
  }
  throw new Error('print-proxy health timeout');
}

async function postOrder(port, order) {
  const response = await fetch(`http://127.0.0.1:${port}/print/full`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://www.burger-brothers.berlin',
      'x-print-proxy-token': proxyToken,
    },
    body: JSON.stringify({ order }),
  });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, JSON.stringify(body));
}

function containsAscii(buffer, value) {
  return buffer.includes(Buffer.from(value, 'ascii'));
}

function indexAscii(buffer, value) {
  return buffer.indexOf(Buffer.from(value, 'ascii'));
}

(async () => {
  assert.equal(fs.existsSync(proxyPath), true, 'print-proxy/index.cjs missing');
  assert.equal(fs.existsSync(logoPath), true, 'local thermal logo missing');

  const proxyPort = await freePort();
  const printerPort = await freePort();
  const printed = [];
  const waiting = [];

  const printer = net.createServer((socket) => {
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => {
      printed.push(Buffer.concat(chunks));
      const resolve = waiting.shift();
      if (resolve) resolve();
    });
  });

  await new Promise((resolve, reject) => {
    printer.once('error', reject);
    printer.listen(printerPort, '127.0.0.1', resolve);
  });

  const child = spawn(process.execPath, [proxyPath], {
    cwd: path.dirname(proxyPath),
    env: {
      ...process.env,
      PORT: String(proxyPort),
      PRINTER_HOST: '127.0.0.1',
      PRINTER_PORT: String(printerPort),
      LOGO_FILE: path.basename(logoPath),
      LOGO_URL: 'http://127.0.0.1/unused.bmp',
      CUT_ENABLED: '0',
      PRINT_PROXY_TOKEN: proxyToken,
      FISCAL_OPERATION_MODE: 'webshop_only',
      TZ: 'Europe/Berlin',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  async function capture(order) {
    const next = new Promise((resolve) => waiting.push(resolve));
    await postOrder(proxyPort, order);
    await Promise.race([
      next,
      wait(5_000).then(() => { throw new Error('mock printer capture timeout'); }),
    ]);
    return printed.shift();
  }

  try {
    await waitForHealth(proxyPort, child);

    const commonItems = [
      { id: 'burger-1', name: 'Big Daddy', category: 'Burger', price: 10.5, qty: 1, taxRate: 7 },
    ];

    const pickup = await capture({
      id: 'pickup-layout-test',
      mode: 'pickup',
      channel: 'web',
      planned: '21:09',
      ts: '2026-07-29T20:54:00+02:00',
      customer: { name: 'Ömer', zip: '13507', street: 'Kamener Weg', houseNo: '5a' },
      items: commonItems,
      merchandise: 10.5,
      total: 10.5,
      paymentMethod: 'cash',
      paymentStatus: 'pending',
    });

    assert.equal(
      pickup.reduce((count, byte, index) => count + (byte === 0x1b && pickup[index + 1] === 0x40 ? 1 : 0), 0),
      1,
      'Abholung must keep its existing single-receipt flow',
    );
    assert.equal(containsAscii(pickup, 'ABHOLUNG'), true, 'pickup heading missing');
    assert.equal(containsAscii(pickup, 'Kamener Weg'), false, 'pickup must not print customer address');
    assert.equal(containsAscii(pickup, 'mer'), false, 'pickup must not print customer name at bottom');

    const delivery = await capture({
      id: 'delivery-layout-test',
      mode: 'delivery',
      channel: 'web',
      planned: '21:31',
      ts: '2026-07-29T20:56:00+02:00',
      customer: { name: 'Ömer', zip: '13507', street: 'Kamener Weg', houseNo: '5a' },
      items: commonItems,
      merchandise: 10.5,
      total: 12.5,
      pricing: { delivery: 2, total: 12.5 },
      paymentMethod: 'online',
      paymentStatus: 'paid',
    });

    assert.equal(
      delivery.reduce((count, byte, index) => count + (byte === 0x1b && delivery[index + 1] === 0x40 ? 1 : 0), 0),
      1,
      'Lieferung must keep its existing single-receipt flow',
    );
    assert.equal(containsAscii(delivery, 'GEPLANT LIEFERUNG'), true, 'large planned delivery heading missing');
    assert.equal(containsAscii(delivery, '13507 - Kamener Weg'), true, 'delivery ZIP and street missing');
    assert.equal(containsAscii(delivery, 'mer'), true, 'delivery customer name missing');
    assert.equal(containsAscii(delivery, 'Kamener Weg 5a'), false, 'delivery house number must be omitted');
    assert.equal(containsAscii(delivery, 'Kamener Weg - 5a'), false, 'delivery house number must be omitted');

    const schnell = await capture({
      id: 'schnell-layout-test',
      mode: 'dine_in',
      channel: 'schnellbestellung',
      ts: '2026-07-29T21:40:00+02:00',
      etaMin: 35,
      customer: { name: 'Nummer 6' },
      customerNumber: 6,
      items: commonItems,
      merchandise: 10.5,
      total: 10.5,
      paymentMethod: 'cash',
      paymentStatus: 'pay_at_counter',
      meta: {
        customerNumber: 6,
        fulfillment: 'takeaway',
        takeaway: true,
      },
    });

    const schnellHeading = indexAscii(schnell, 'SCHNELLBESTELLUNG');
    const headerTime = indexAscii(schnell, '21:40');
    const storeHeader = indexAscii(schnell, 'Berliner Str. 9');
    const thanks = indexAscii(schnell, 'Vielen Dank');
    const takeaway = indexAscii(schnell, 'ZUM MITNEHMEN');
    const initCount = schnell.reduce(
      (count, byte, index) =>
        count + (byte === 0x1b && schnell[index + 1] === 0x40 ? 1 : 0),
      0,
    );

    assert.equal(initCount, 2, 'Schnellbestellung must print exactly one cash and one kitchen receipt');
    assert.ok(storeHeader >= 0, 'cash receipt store header missing');
    assert.ok(headerTime > storeHeader, 'cash receipt must show actual Schnell order time');
    assert.ok(thanks > headerTime, 'cash receipt thank-you line missing');
    assert.ok(schnellHeading > thanks, 'kitchen receipt must follow the cash receipt');
    assert.equal(containsAscii(schnell, '22:15'), false, 'Schnell receipts must not show ETA time');
    assert.equal(containsAscii(schnell, 'BAR OFFEN'), false, 'Schnell cash receipt must not print BAR OFFEN');
    assert.equal(containsAscii(schnell, 'SALONBESTELLUNG'), false, 'kitchen receipt must not print SALONBESTELLUNG');
    assert.ok(takeaway > schnellHeading, 'takeaway label must be at the bottom of the kitchen receipt');
    assert.equal(containsAscii(schnell, 'Nummer 6'), false, 'duplicate Nummer 6 line must be removed');

    const discounts = await capture({
      id: 'discount-layout-test',
      mode: 'dine_in',
      channel: 'schnellbestellung',
      ts: '2026-07-29T21:42:00+02:00',
      customer: { name: 'Nummer 7' },
      customerNumber: 7,
      items: [{ id: 'burger-2', name: 'Avocado Burger', category: 'Burger', price: 39.1, qty: 1, taxRate: 7 }],
      merchandise: 39.1,
      discount: 8.32,
      total: 30.78,
      paymentMethod: 'cash',
      paymentStatus: 'pay_at_counter',
      meta: {
        customerNumber: 7,
        fulfillment: 'eat_here',
        campaigns: [{ name: 'Schnell-Rabatt', amount: 5.82 }],
        reward: {
          customerLabel: '20 % Rabatt auf deine Bestellung',
          discountAmount: 2.5,
        },
      },
    });

    assert.equal(containsAscii(discounts, 'Rabatt'), true, 'conditional discount row missing on cash receipt');
    assert.equal(containsAscii(discounts, 'Geschenk'), true, 'conditional gift row missing on cash receipt');
    assert.equal(containsAscii(discounts, 'BAR OFFEN'), false, 'Schnell cash receipt must stay free of payment instructions');
    assert.equal(containsAscii(discounts, 'ZUM MITNEHMEN'), false, 'eat-here Schnell order must print only the number');

    console.log('receipt layout regression tests: OK');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => printer.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
