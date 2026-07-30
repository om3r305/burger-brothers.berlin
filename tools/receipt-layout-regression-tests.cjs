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

    const schnellHeading = indexAscii(schnell, 'Schnellbestellung');
    const headerTime = indexAscii(schnell, '21:40');
    const storeHeader = indexAscii(schnell, 'Berliner Str. 9');
    const payment = indexAscii(schnell, 'BAR OFFEN');
    const salon = indexAscii(schnell, 'SALONBESTELLUNG');
    const takeaway = indexAscii(schnell, 'ZUM MITNEHMEN');

    assert.ok(schnellHeading >= 0, 'Schnellbestellung heading missing');
    assert.ok(headerTime > schnellHeading && headerTime < storeHeader, 'header must show actual Schnell order time');
    assert.equal(containsAscii(schnell, '22:15'), false, 'Schnell header must not show ETA time');
    assert.ok(salon > payment, 'customer number block must be below BAR OFFEN');
    assert.ok(takeaway > salon, 'takeaway label must follow customer number block');
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

    assert.equal(containsAscii(discounts, 'Schnell-Rabatt'), true, 'campaign reason missing on receipt');
    assert.equal(containsAscii(discounts, '20 % Rabatt'), true, 'reward discount text missing on receipt');
    assert.equal(containsAscii(discounts, 'auf deine Bestellung'), true, 'reward reason missing on receipt');

    console.log('receipt layout regression tests: OK');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => printer.close(resolve));
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
