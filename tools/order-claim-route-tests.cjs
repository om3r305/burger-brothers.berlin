const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { NextResponse } = require("next/server");

const root = process.cwd();
const originalLoad = Module._load;
const originalResolveFilename = Module._resolveFilename;
const originalTsLoader = require.extensions[".ts"];
let updateCount = 0;
let lastPatch = null;

function freshRow(status = "ready") {
  return {
    id: "ORDER-1",
    tenantId: "tenant-1",
    mode: "delivery",
    channel: "web",
    status,
    merchandise: 20,
    discount: 0,
    surcharges: 0,
    total: 20,
    coupon: null,
    couponDiscount: 0,
    customer: {
      name: "Max",
      phone: "03012345678",
      email: "private@example.test",
      address: "Teststraße 1 | 13505 Berlin",
      plz: "13505",
    },
    items: [{ id: "burger-1", name: "Burger", price: 20, qty: 1 }],
    meta: {
      paymentMethod: "online",
      paymentIntentId: "pi_secret",
      history: [],
    },
    driver: null,
    history: [],
    print: null,
    ts: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

let row = freshRow();
const tx = {
  order: {
    findFirst: async () => row,
    updateMany: async ({ data }) => {
      updateCount += 1;
      lastPatch = data;
      row = { ...row, ...data, updatedAt: new Date() };
      return { count: 1 };
    },
  },
  $queryRaw: async () => [],
};
const prisma = {
  setting: {
    findFirst: async () => ({
      value: [
        { id: "driver-1", name: "Ali", passwordHash: "scrypt$secret" },
        { id: "driver-2", name: "Veli", passwordHash: "scrypt$secret" },
      ],
    }),
  },
  $transaction: async (callback) => callback(tx),
};

function resolveAlias(request) {
  if (!request.startsWith("@/")) return null;
  const base = path.join(root, request.slice(2));
  return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]
    .find((candidate) => fs.existsSync(candidate)) || null;
}

require.extensions[".ts"] = (module, filename) => {
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
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
      errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")).join("\n"),
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
    return { prisma, getTenantId: async () => "tenant-1" };
  }
  if (request === "@/lib/server/request-security") {
    return {
      requireMutationRole: async () => null,
      hasSessionRole: async (req, role) =>
        role === "admin" && req.headers.get("x-test-role") === "admin",
      getSessionSubject: async (req, role) =>
        role === "driver" ? req.headers.get("x-test-driver") || "" : "",
      securityJson: (payload, status = 200) => NextResponse.json(payload, { status }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function request(body, driver = "driver-1") {
  return new Request("https://example.test/api/orders/claim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-role": "driver",
      "x-test-driver": driver,
    },
    body: JSON.stringify({ id: "ORDER-1", ...body }),
  });
}

async function main() {
  const route = require(path.join(root, "app/api/orders/claim/route.ts"));

  row = freshRow();
  updateCount = 0;
  lastPatch = null;
  const response = await route.POST(
    request({
      by: "admin",
      driverPassword: "plaintext",
      driver: { id: "driver-2", name: "Spoof", password: "plaintext" },
    }),
  );
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(updateCount, 1);
  assert.deepEqual(lastPatch.driver, { id: "driver-1", name: "Ali" });
  assert.equal(lastPatch.meta.driverName, "Ali");
  assert.equal(lastPatch.history.at(-1).by, "Ali");
  const serialized = JSON.stringify(payload);
  assert.equal(serialized.includes("private@example.test"), false);
  assert.equal(serialized.includes("pi_secret"), false);
  assert.equal(serialized.includes("plaintext"), false);
  assert.equal(serialized.includes("Spoof"), false);

  row = freshRow("payment_pending");
  updateCount = 0;
  const pending = await route.POST(request({ driver: { id: "driver-1", name: "Ali" } }));
  assert.equal(pending.status, 409);
  assert.equal((await pending.json()).error, "not_claimable");
  assert.equal(updateCount, 0);

  row = freshRow();
  const deletedDriver = await route.POST(request({}, "driver-deleted"));
  assert.equal(deletedDriver.status, 403);
  assert.equal((await deletedDriver.json()).error, "driver_identity_unknown");

  console.log("Order claim identity route tests passed.");
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
