const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const proxyPath = path.join(root, "print-proxy", "index.cjs");
const domainPath = path.join(root, "lib", "tv", "domain.ts");
const modalPath = path.join(
  root,
  "components",
  "tv",
  "OrderDetailsModal.tsx",
);
const logoPath = path.join(root, "print-proxy", "logo-thermal.bmp");

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address ? address.port : 0;
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
          origin: "https://www.burger-brothers.berlin",
        },
      });

      if (response.ok) return;
    } catch {}

    await wait(100);
  }

  throw new Error("print-proxy health timeout");
}

async function postOrder(port, order) {
  const response = await fetch(`http://127.0.0.1:${port}/print/full`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://www.burger-brothers.berlin",
    },
    body: JSON.stringify({ order }),
  });

  const body = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, JSON.stringify(body));
}

function printableText(buffer) {
  let output = "";

  for (const byte of buffer) {
    if (byte === 0xd5 || byte === 0x80) {
      output += "€";
    } else if (byte === 0x0a || byte === 0x0d) {
      output += "\n";
    } else if (byte >= 0x20 && byte <= 0x7e) {
      output += String.fromCharCode(byte);
    }
  }

  return output;
}

function lineWith(text, needle) {
  return text
    .split(/\r?\n/)
    .find((line) => line.includes(needle));
}

function lineStartingWith(text, label) {
  return text
    .split(/\r?\n/)
    .find((line) => line.trimStart().startsWith(label));
}

(async () => {
  assert.equal(fs.existsSync(proxyPath), true, "print-proxy/index.cjs missing");
  assert.equal(fs.existsSync(domainPath), true, "lib/tv/domain.ts missing");
  assert.equal(fs.existsSync(modalPath), true, "TV details modal missing");
  assert.equal(fs.existsSync(logoPath), true, "thermal logo missing");

  const proxySource = fs.readFileSync(proxyPath, "utf8");
  const domainSource = fs.readFileSync(domainPath, "utf8");
  const modalSource = fs.readFileSync(modalPath, "utf8");

  assert.match(
    proxySource,
    /ROUND_TOTAL_STEP_CENTS\s*\|\|\s*1/,
    "receipt rounding must default to one cent",
  );
  assert.match(
    proxySource,
    /receiptItemUnitPrice\(it,\s*receiptItemPricing\)/,
    "receipt item line must use the canonical extras-aware unit price",
  );
  assert.match(
    domainSource,
    /merchandiseValue\s*>\s*0[\s\S]*pricingSubtotalValue/,
    "TV totals must prefer the stored merchandise amount",
  );
  assert.match(
    modalSource,
    /getOrderItemLineTotal\(order,\s*item\)/,
    "TV item rows must use the shared line-total helper",
  );
  assert.doesNotMatch(
    modalSource,
    /<td className="p-2">Rabatte<\/td>/,
    "TV must not print a duplicate generic discount amount above details",
  );

  const proxyPort = await freePort();
  const printerPort = await freePort();
  const printed = [];
  const waiting = [];

  const printer = net.createServer((socket) => {
    const chunks = [];

    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => {
      printed.push(Buffer.concat(chunks));
      const resolve = waiting.shift();
      if (resolve) resolve();
    });
  });

  await new Promise((resolve, reject) => {
    printer.once("error", reject);
    printer.listen(printerPort, "127.0.0.1", resolve);
  });

  const child = spawn(process.execPath, [proxyPath], {
    cwd: path.dirname(proxyPath),
    env: {
      ...process.env,
      PORT: String(proxyPort),
      PRINTER_HOST: "127.0.0.1",
      PRINTER_PORT: String(printerPort),
      LOGO_FILE: path.basename(logoPath),
      LOGO_URL: "http://127.0.0.1/unused.bmp",
      CUT_ENABLED: "0",
      ROUND_TOTAL_STEP_CENTS: "1",
      TZ: "Europe/Berlin",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  async function capture(order) {
    const next = new Promise((resolve) => waiting.push(resolve));
    await postOrder(proxyPort, order);

    await Promise.race([
      next,
      wait(5_000).then(() => {
        throw new Error("mock printer capture timeout");
      }),
    ]);

    return printed.shift();
  }

  try {
    await waitForHealth(proxyPort, child);

    const schnellBuffer = await capture({
      id: "price-schnell-regression",
      mode: "dine_in",
      channel: "schnellbestellung",
      ts: "2026-07-29T21:36:00+02:00",
      customer: { name: "Nummer 2" },
      customerNumber: 2,
      items: [
        {
          id: "avocado",
          name: "Avocado Burger",
          category: "Burger",
          price: 9.5,
          qty: 1,
          taxRate: 7,
          add: [{ name: "Käse", label: "Käse", price: 1 }],
        },
        {
          id: "big-daddy",
          name: "Big Daddy",
          category: "Burger",
          price: 10.5,
          qty: 1,
          taxRate: 7,
          add: [
            {
              name: "Jalapeños",
              label: "Jalapeños",
              price: 1.5,
            },
          ],
        },
        {
          id: "cheese-fries",
          name: "Cheese Fries",
          category: "Extras",
          price: 5.3,
          qty: 1,
          taxRate: 7,
        },
        {
          id: "chili-cheese-fries",
          name: "Chili Cheese Fries",
          category: "Extras",
          price: 5.8,
          qty: 1,
          taxRate: 7,
        },
        {
          id: "fritz",
          name: "Fritz-kola 0,33l (div. Sorten)",
          category: "Getränke",
          price: 2.8,
          qty: 1,
          taxRate: 19,
        },
        {
          id: "fanta",
          name: "Fanta 0,33l",
          category: "Getränke",
          price: 2.8,
          qty: 1,
          taxRate: 19,
        },
        {
          id: "aioli",
          name: "Aioli",
          category: "Soßen",
          price: 1.2,
          qty: 1,
          taxRate: 7,
        },
        {
          id: "sour",
          name: "Sour Creme",
          category: "Soßen",
          price: 1.2,
          qty: 1,
          taxRate: 7,
        },
      ],
      merchandise: 41.6,
      discount: 8.32,
      total: 33.28,
      paymentMethod: "cash",
      paymentStatus: "pay_at_counter",
      meta: {
        customerNumber: 2,
        fulfillment: "eat_here",
        source: "qr_quick_order",
        reward: {
          customerLabel: "20 % Rabatt auf deine Bestellung",
          discountAmount: 8.32,
        },
      },
    });

    const schnellText = printableText(schnellBuffer);

    assert.match(
      lineWith(schnellText, "1x Avocado Burger") || "",
      /10\.50€/,
      "Schnell item line must include the 1.00 EUR cheese extra",
    );
    assert.match(
      lineWith(schnellText, "1x Big Daddy") || "",
      /12\.00€/,
      "Schnell item line must include the 1.50 EUR jalapeno extra",
    );
    assert.match(
      lineWith(schnellText, "Zwischensumme") || "",
      /41\.60€/,
      "receipt subtotal must include paid extras",
    );
    assert.equal(
      schnellText.includes("-8.32€"),
      true,
      "real reward discount must be printed",
    );
    assert.match(
      lineWith(schnellText, "Gesamt") || "",
      /33\.28€/,
      "receipt total must stay at the exact cent amount",
    );
    assert.equal(
      schnellText.includes("33.30€"),
      false,
      "receipt must not round 33.28 EUR to 33.30 EUR",
    );
    assert.match(
      lineStartingWith(schnellText, "Netto MwSt 19 %") || "",
      /3\.76€/,
      "19 percent net amount is incorrect",
    );
    assert.match(
      lineStartingWith(schnellText, "MwSt 19 %") || "",
      /0\.72€/,
      "19 percent VAT amount is incorrect",
    );
    assert.match(
      lineStartingWith(schnellText, "Netto MwSt 7 %") || "",
      /26\.92€/,
      "7 percent net amount must include burger extras",
    );
    assert.match(
      lineStartingWith(schnellText, "MwSt 7 %") || "",
      /1\.88€/,
      "7 percent VAT amount must include burger extras",
    );

    const webBuffer = await capture({
      id: "price-web-regression",
      mode: "pickup",
      channel: "web",
      ts: "2026-07-29T21:40:00+02:00",
      customer: { name: "Test" },
      items: [
        {
          id: "all-american",
          name: "All American",
          category: "Burger",
          price: 7.5,
          qty: 1,
          taxRate: 7,
          canonicalBasePrice: 6.5,
          canonicalExtrasTotal: 1,
          canonicalUnitPrice: 7.5,
          add: [{ name: "Käse", label: "Käse", price: 1 }],
        },
      ],
      merchandise: 7.5,
      total: 7.5,
      paymentMethod: "cash",
      paymentStatus: "pending",
    });

    const webText = printableText(webBuffer);

    assert.match(
      lineWith(webText, "1x All American") || "",
      /7\.50€/,
      "web item price already includes extras and must not be doubled",
    );
    assert.equal(
      (lineWith(webText, "1x All American") || "").includes("8.50€"),
      false,
      "web extra must not be added twice",
    );
    assert.match(
      lineWith(webText, "Zwischensumme") || "",
      /7\.50€/,
      "web subtotal must remain unchanged",
    );

    console.log("price / TV / receipt regression tests: OK");
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => printer.close(resolve));
  }

  if (stderr.trim()) {
    console.error(stderr.trim());
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
