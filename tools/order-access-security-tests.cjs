const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = process.cwd();
const originalLoad = Module._load;
const originalResolveFilename = Module._resolveFilename;
const originalTsLoader = require.extensions[".ts"];
let pause = { pickup: false, delivery: false };

function resolveAlias(request) {
  if (!request.startsWith("@/")) return null;
  const base = path.join(root, request.slice(2));
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]
    .find((candidate) => fs.existsSync(candidate)) || null;
}

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
      resolveJsonModule: true,
      strict: true,
    },
    fileName: filename,
    reportDiagnostics: true,
  });
  const errors = (output.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  if (errors.length) {
    throw new Error(
      errors
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
        .join("\n"),
    );
  }
  module._compile(output.outputText, filename);
};

Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  const alias = resolveAlias(request);
  if (alias) return alias;
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "@/lib/db") {
    return {
      prisma: {
        setting: {
          findUnique: async () => ({ value: pause }),
        },
      },
    };
  }

  if (request === "node:fs") {
    return {
      ...fs,
      readFileSync(file, ...args) {
        if (String(file).replaceAll("\\", "/").endsWith("/public/data/streets.json")) {
          return JSON.stringify({ "13505": ["Teststraße"] });
        }
        return fs.readFileSync(file, ...args);
      },
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

function openWeek() {
  const day = [{ start: "00:00", end: "23:59" }];
  return { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day };
}

async function expectValidationError(promise, code) {
  await assert.rejects(promise, (error) => error && error.code === code);
}

async function main() {
  const access = require(path.join(root, "lib/server/driver-order.ts"));
  const validation = require(path.join(root, "lib/server/order-validation.ts"));

  const baseOrder = {
    id: "ORDER-1",
    orderId: "ORDER-1",
    mode: "delivery",
    status: "ready",
    ts: Date.now(),
    customer: {
      name: "Max Mustermann",
      phone: "03012345678",
      email: "private@example.test",
      plz: "13505",
      zip: "13505",
      street: "Teststraße",
      house: "1",
      address: "Teststraße 1 | 13505 Berlin",
    },
    items: [{ id: "burger-1", name: "Burger", price: 20, qty: 1 }],
    meta: {
      paymentMethod: "online",
      paymentIntentId: "pi_secret",
      history: [{ action: "secret" }],
      payment: {
        method: "online",
        status: "paid",
        paymentIntentId: "pi_secret",
        sessionId: "cs_secret",
        payableTotal: 20,
      },
    },
    history: [{ action: "secret" }],
    coupon: "SECRET",
    print: { raw: "private" },
    total: 20,
  };

  assert.equal(access.driverCanSeeOrder(baseOrder, "driver-1"), true);
  assert.equal(
    access.driverCanSeeOrder(
      { ...baseOrder, driver: { id: "driver-2", name: "Other" } },
      "driver-1",
    ),
    false,
  );
  assert.equal(
    access.driverCanSeeOrder(
      { ...baseOrder, status: "done", driver: { id: "driver-1", name: "Mine" } },
      "driver-1",
    ),
    true,
  );
  assert.equal(access.driverCanSeeOrder({ ...baseOrder, status: "done" }, "driver-1"), false);

  const visible = access.sanitizeOrderForDriver({
    ...baseOrder,
    driver: { id: "driver-1", name: "Mine", password: "plaintext" },
  });
  const serializedVisible = JSON.stringify(visible);
  assert.equal(visible.customer.email, undefined);
  assert.equal(visible.history, undefined);
  assert.equal(visible.coupon, undefined);
  assert.equal(visible.print, undefined);
  assert.equal(serializedVisible.includes("pi_secret"), false);
  assert.equal(serializedVisible.includes("cs_secret"), false);
  assert.equal(serializedVisible.includes("plaintext"), false);
  assert.equal(visible.meta.payment.method, "online");
  assert.equal(visible.meta.payment.status, "paid");

  const settings = {
    validation: { phoneDigits: 11 },
    delivery: {
      plzMin: { "13505": 20 },
      minOrderAfterDiscountByPLZ: { "13505": 20 },
    },
    hours: {
      timezone: "Europe/Berlin",
      pickup: openWeek(),
      delivery: openWeek(),
      allowPreorder: true,
      avgPickupMinutes: 15,
      avgDeliveryMinutes: 35,
      daysAhead: 0,
      forceClosed: false,
    },
  };
  const pricing = {
    mode: "delivery",
    orderBeforeTipCents: 2050,
    pricingMeta: { surcharges: { pfand: 0.5 } },
  };

  pause = { pickup: false, delivery: false };
  await validation.validateOrderForCheckout({
    tenantId: "tenant-1",
    order: baseOrder,
    settings,
    pricing,
  });

  await expectValidationError(
    validation.validateOrderForCheckout({
      tenantId: "tenant-1",
      order: { ...baseOrder, customer: { ...baseOrder.customer, street: "Fake Place" } },
      settings,
      pricing,
    }),
    "ORDER_STREET_INVALID",
  );
  await expectValidationError(
    validation.validateOrderForCheckout({
      tenantId: "tenant-1",
      order: baseOrder,
      settings,
      pricing: { ...pricing, orderBeforeTipCents: 2049 },
    }),
    "ORDER_MINIMUM_NOT_MET",
  );

  pause = { pickup: false, delivery: true };
  await expectValidationError(
    validation.validateOrderForCheckout({
      tenantId: "tenant-1",
      order: baseOrder,
      settings,
      pricing,
    }),
    "ORDER_MODE_PAUSED",
  );

  console.log("Order access and checkout validation tests passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._load = originalLoad;
    Module._resolveFilename = originalResolveFilename;
    if (originalTsLoader) require.extensions[".ts"] = originalTsLoader;
    else delete require.extensions[".ts"];
  });
