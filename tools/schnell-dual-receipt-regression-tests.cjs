const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const proxyPath = path.join(root, 'print-proxy', 'index.cjs');
const logoPath = path.join(root, 'print-proxy', 'logo-thermal.bmp');
const proxyToken = 'schnell-dual-receipt-token-0123456789abcdef';

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

function printableText(buffer) {
  let output = '';
  for (const byte of buffer) {
    if (byte === 0xd5 || byte === 0x80) output += '€';
    else if (byte === 0x0a || byte === 0x0d) output += '\n';
    else if (byte >= 0x20 && byte <= 0x7e) output += String.fromCharCode(byte);
  }
  return output;
}

function countSequence(buffer, sequence) {
  let count = 0;
  for (let index = 0; index <= buffer.length - sequence.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < sequence.length; offset += 1) {
      if (buffer[index + offset] !== sequence[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) count += 1;
  }
  return count;
}

function splitAtSecondInit(buffer) {
  const sequence = Buffer.from([0x1b, 0x40]);
  let seen = 0;
  for (let index = 0; index <= buffer.length - sequence.length; index += 1) {
    if (buffer[index] === sequence[0] && buffer[index + 1] === sequence[1]) {
      seen += 1;
      if (seen === 2) return [buffer.subarray(0, index), buffer.subarray(index)];
    }
  }
  throw new Error('second ESC/POS init not found');
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`print-proxy exited early with ${child.exitCode}`);
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

(async () => {
  assert.equal(fs.existsSync(proxyPath), true, 'print-proxy/index.cjs missing');
  assert.equal(fs.existsSync(logoPath), true, 'thermal logo missing');

  const source = fs.readFileSync(proxyPath, 'utf8');
  const clientSource = fs.readFileSync(path.join(root, 'components', 'schnellbestellung', 'SchnellClient.tsx'), 'utf8');
  const schnellCoreSource = fs.readFileSync(path.join(root, 'lib', 'server', 'schnellbestellung.ts'), 'utf8');
  const printApiSource = fs.readFileSync(path.join(root, 'app', 'api', 'print', 'jobs', 'route.ts'), 'utf8');
  const agentSource = fs.readFileSync(path.join(root, 'print-agent', 'agent.mjs'), 'utf8');
  const tvOverlaySource = fs.readFileSync(path.join(root, 'components', 'tv', 'AcceptOrderOverlay.tsx'), 'utf8');
  const tvDetailsSource = fs.readFileSync(path.join(root, 'components', 'tv', 'OrderDetailsModal.tsx'), 'utf8');

  assert.match(clientSource, /selectionError/);
  assert.match(clientSource, /schnell-black-angus-doneness/);
  assert.match(clientSource, /Bitte wählen Sie die Garstufe/);
  assert.match(clientSource, /role="alert"/);
  assert.match(schnellCoreSource, /DONENESS_REQUIRED/);
  assert.match(schnellCoreSource, /schnellProductRequiresDoneness/);
  assert.match(printApiSource, /doneness: normalizeDoneness\(item\?\.doneness\)/);
  assert.match(agentSource, /doneness: normalizeDoneness\(item\.doneness\)/);
  assert.match(tvOverlaySource, /order\.mode === "dine_in" && donenessLabel/);
  assert.match(tvOverlaySource, /Garstufe: \{donenessLabel\(item\.doneness\)\}/);
  assert.match(tvDetailsSource, /order\.mode === "dine_in" && donenessLabel/);
  assert.match(tvDetailsSource, /Garstufe: \{donenessLabel\(item\.doneness\)\}/);

  assert.match(source, /buildSchnellCashReceipt/);
  assert.match(source, /buildSchnellKitchenTicket/);
  assert.match(source, /if \(!isSchnellOrder\(o\)\) return buildTicketFromOrder/);
  const cashSource = source.slice(
    source.indexOf('async function buildSchnellCashReceipt'),
    source.indexOf('function kitchenGroupOrder'),
  );
  assert.doesNotMatch(cashSource, /code128\(/, 'Schnell cash receipt must not print a barcode');
  assert.match(cashSource, /Nr\. \${formatSchnellNumber/);

  const proxyPort = await freePort();
  const printerPort = await freePort();
  let resolvePrinted;
  const printedPromise = new Promise((resolve) => { resolvePrinted = resolve; });

  const printer = net.createServer((socket) => {
    const chunks = [];
    socket.on('data', (chunk) => chunks.push(chunk));
    socket.on('end', () => resolvePrinted(Buffer.concat(chunks)));
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
      CUT_ENABLED: '1',
      PRINT_PROXY_TOKEN: proxyToken,
      FISCAL_OPERATION_MODE: 'webshop_only',
      TZ: 'Europe/Berlin',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  try {
    await waitForHealth(proxyPort, child);

    await postOrder(proxyPort, {
      id: 'schnell-dual-16',
      mode: 'dine_in',
      channel: 'schnellbestellung',
      ts: '2026-08-02T19:42:00+02:00',
      customer: { name: 'Nummer 16' },
      customerNumber: 16,
      items: [
        {
          id: 'lunch-standard',
          sku: 'MITTAG-all-american',
          name: 'All American + Fries',
          category: 'lunch',
          price: 8.9,
          qty: 1,
          taxRate: 7,
          add: [
            {
              id: 'lunch-side:pommes',
              name: 'Pommes inklusive',
              label: 'Pommes inklusive',
              price: 0,
              kind: 'side_upgrade',
            },
            { id: 'kaese', name: 'Käse', label: 'Käse', price: 1 },
          ],
          note: 'OHNE TOMATEN',
        },
        {
          id: 'lunch-curly',
          sku: 'MITTAG-cheesy',
          name: 'Cheesy Cheese + Fries',
          category: 'lunch',
          price: 8.9,
          qty: 1,
          taxRate: 7,
          add: [
            {
              id: 'lunch-side:curly',
              name: 'Curly Fries statt Pommes (+1,00 €)',
              label: 'Curly Fries statt Pommes (+1,00 €)',
              price: 1,
              kind: 'side_upgrade',
            },
          ],
        },
        {
          id: 'black-angus',
          name: 'Black Angus Burger',
          category: 'burger',
          price: 10,
          qty: 1,
          taxRate: 7,
          add: [
            { name: 'Käse', label: 'Käse', price: 1 },
            { name: 'Bacon', label: 'Bacon', price: 1.5 },
          ],
          doneness: { code: 'light', label: 'Leicht gebraten' },
          note: 'OHNE TOMATEN',
        },
        {
          id: 'fit',
          name: 'Fit Burger',
          category: 'burger',
          price: 10,
          qty: 1,
          taxRate: 7,
          note: 'OHNE ZWIEBELN',
        },
        { id: 'cheese-fries', name: 'Cheese Fries', category: 'extras', price: 5.3, qty: 1, taxRate: 7 },
        { id: 'almdudler', name: 'Almdudler 0,37 l', category: 'drinks', price: 3, qty: 1, taxRate: 19 },
        { id: 'aioli', name: 'Aioli', category: 'sauces', price: 1.2, qty: 1, taxRate: 7 },
      ],
      merchandise: 51.8,
      total: 51.8,
      paymentMethod: 'cash',
      paymentStatus: 'pay_at_counter',
      meta: {
        source: 'qr_quick_order',
        customerNumber: 16,
        fulfillment: 'takeaway',
        takeaway: true,
      },
    });

    const printed = await Promise.race([
      printedPromise,
      wait(5_000).then(() => { throw new Error('mock printer capture timeout'); }),
    ]);

    assert.equal(countSequence(printed, Buffer.from([0x1b, 0x40])), 2, 'must contain two ESC/POS receipts');

    const [cashBuffer, kitchenBuffer] = splitAtSecondInit(printed);
    const cutCommand = Buffer.from([0x1d, 0x56, 0x00]);
    assert.ok(cashBuffer.lastIndexOf(cutCommand) > cashBuffer.length - 16, 'cash receipt must end with a cut command');
    assert.ok(kitchenBuffer.lastIndexOf(cutCommand) > kitchenBuffer.length - 16, 'kitchen receipt must end with a cut command');
    const cash = printableText(cashBuffer);
    const kitchen = printableText(kitchenBuffer);
    const textFontA = Buffer.from([0x1b, 0x4d, 0x00]);
    const readableLineSpacing = Buffer.from([0x1b, 0x33, 0x24]);
    const verticalOnlyDoubleHeight = Buffer.from([0x1d, 0x21, 0x01]);
    assert.ok(
      countSequence(kitchenBuffer, textFontA) >= 1,
      'Schnell kitchen receipt must select real ESC/POS text Font A',
    );
    assert.ok(
      countSequence(kitchenBuffer, readableLineSpacing) >= 1,
      'Schnell kitchen receipt must use readable 36-dot line spacing',
    );
    assert.equal(
      countSequence(kitchenBuffer, verticalOnlyDoubleHeight),
      0,
      'Schnell kitchen body must not use vertically stretched 1x2 text',
    );

    assert.match(cash, /Berliner Str\. 9/);
    assert.match(cash, /St\.-Nr\.: 17\/602\/03138/);
    assert.match(cash, /Sonntag, 02\.08\.2026 19:42\s+Nr\. 0016/);
    assert.match(cash, /1x All American \+ Fries\s+8,90 €/);
    assert.match(cash, /\+ Kse\s+1,00 €/);
    assert.match(cash, /Leicht gebraten/);
    assert.match(cash, /Zwischensumme/);
    assert.match(cash, /GESAMT/);
    assert.match(cash, /Zahlungsart: BAR\s+51,80 €/);
    assert.match(cash, /MwSt\.\s+Netto\s+Steuer\s+Brutto/);
    assert.match(cash, /7 %/);
    assert.match(cash, /19 %/);
    assert.match(cash, /Vielen Dank fr Ihre Bestellung!/);
    assert.doesNotMatch(cash, /Enthaltene MwSt\.:/);
    assert.doesNotMatch(cash, /SCHNELLBESTELLUNG/);
    assert.doesNotMatch(cash, /ZUM MITNEHMEN/);
    assert.doesNotMatch(cash, /BAR OFFEN|BARZAHLUNG|SALONBESTELLUNG/);
    assert.doesNotMatch(cash, /Pommes inklusive/i);
    assert.doesNotMatch(cash, /schnell-dual-16/);

    assert.match(kitchen, /02\.08\.2026\s+19:42/);
    assert.match(kitchen, /SCHNELLBESTELLUNG/);
    assert.match(kitchen, /MITTAGSMEN/);
    assert.match(kitchen, /1x ALL AMERICAN \+ FRIES\s+9,90 €/);
    assert.match(kitchen, /1x CHEESY CHEESE \+ FRIES\s+9,90 €/);
    assert.match(kitchen, /CURLY FRIES STATT POMMES\s+\+1,00 €/);
    assert.match(kitchen, /1x BLACK ANGUS BURGER\s+12,50 €/);
    assert.match(kitchen, /LEICHT GEBRATEN/);
    assert.equal(
      kitchen.split('LEICHT GEBRATEN').length - 1,
      1,
      'LEICHT GEBRATEN must be printed only for Black Angus',
    );
    assert.match(kitchen, /1x FIT BURGER\s+10,00 €/);
    assert.match(kitchen, /OHNE ZWIEBELN/);
    assert.match(kitchen, /EXTRAS/);
    assert.match(kitchen, /GETRNKE/);
    assert.match(kitchen, /SOSSEN/);
    assert.match(kitchen, /ZUM MITNEHMEN/);
    assert.doesNotMatch(kitchen, /Berliner Str\. 9/);
    assert.doesNotMatch(kitchen, /Zwischensumme|GESAMT|MwSt|Vielen Dank|BAR OFFEN|BARZAHLUNG/);
    assert.doesNotMatch(kitchen, /Pommes inklusive/i);

    const lunchIndex = kitchen.indexOf('MITTAGSMEN');
    const burgerIndex = kitchen.indexOf('BURGER');
    const extrasIndex = kitchen.indexOf('EXTRAS');
    const drinksIndex = kitchen.indexOf('GETRNKE');
    const saucesIndex = kitchen.indexOf('SOSSEN');
    assert.ok(lunchIndex >= 0 && lunchIndex < burgerIndex, 'Mittagsmenü must come before Burger');
    assert.ok(burgerIndex < extrasIndex && extrasIndex < drinksIndex && drinksIndex < saucesIndex, 'kitchen groups are out of order');

    console.log('schnell dual receipt regression tests: OK');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => printer.close(resolve));
  }

  if (stderr.trim()) console.error(stderr.trim());
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
