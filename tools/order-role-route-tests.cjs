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
let refundCount = 0;

function freshRow() {
  return {
    id: "ORDER-1",
    tenantId: "tenant-1",
    mode: "delivery",
    channel: "web",
    status: "out_for_delivery",
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
      statusManual: "out_for_delivery",
      driver: { id: "driver-1", name: "Ali" },
      driverId: "driver-1",
      paymentMethod: "online",
      paymentIntentId: "pi_secret",
      payment: { method: "online", status: "paid", paymentIntentId: "pi_secret" },
      history: [],
    },
    driver: { id: "driver-1", name: "Ali" },
    history: [],
    print: null,
    ts: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

let row = freshRow();

const prisma = {
  order: {
    findFirst: async () => row,
    update: async ({ data }) => {
      updateCount += 1;
      row = { ...row, ...data, updatedAt: new Date() };
      return row;
    },
  },
  $queryRaw: async () => [],
};

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
    return { prisma, getTenantId: async () => "tenant-1" };
  }
  if (request === "@/lib/server/payment-refund") {
    return {
      refundOrderPayments: async () => {
        refundCount += 1;
        return {
          attempted: true,
          ok: true,
          skipped: false,
          reason: null,
          status: "refunded",
          paymentIntentIds: ["pi_secret"],
          refunds: [],
          at: new Date().toISOString(),
        };
      },
    };
  }
  if (request === "@/lib/server/request-security") {
    return {
      hasSessionRole: async (req, role) => req.headers.get("x-test-role") === role,
      getSessionSubject: async (req, role) =>
        role === "driver" ? req.headers.get("x-test-driver") || "" : "",
      requireMutationRole: async () => null,
      requireAnySessionRole: async () => null,
      securityJson: (payload, status = 200) => NextResponse.json(payload, { status }),
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function request(role, body, driver = "") {
  return new Request("https://example.test/api/orders/status", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-role": role,
      ...(driver ? { "x-test-driver": driver } : {}),
    },
    body: JSON.stringify({ id: "ORDER-1", ...body }),
  });
}

async function main() {
  const route = require(path.join(root, "app/api/orders/status/route.ts"));

  row = freshRow();
  updateCount = 0;
  refundCount = 0;
  const driverCancel = await route.POST(
    request("driver", { status: "cancelled", by: "admin" }, "driver-1"),
  );
  assert.equal(driverCancel.status, 403);
  assert.equal((await driverCancel.json()).error, "order_cancellation_requires_admin");
  assert.equal(updateCount, 0);
  assert.equal(refundCount, 0);

  row = freshRow();
  const driverEta = await route.POST(
    request("driver", { etaAdjustMin: 99 }, "driver-1"),
  );
  assert.equal(driverEta.status, 403);
  assert.equal((await driverEta.json()).error, "driver_status_transition_not_allowed");

  row = freshRow();
  const driverDone = await route.POST(
    request(
      "driver",
      {
        status: "done",
        by: "admin",
        driver: { id: "driver-1", name: "Spoof", password: "plaintext" },
      },
      "driver-1",
    ),
  );
  assert.equal(driverDone.status, 200);
  const driverDonePayload = await driverDone.json();
  assert.equal(driverDonePayload.status, "done");
  assert.equal(JSON.stringify(driverDonePayload).includes("private@example.test"), false);
  assert.equal(JSON.stringify(driverDonePayload).includes("pi_secret"), false);
  assert.equal(JSON.stringify(driverDonePayload).includes("plaintext"), false);
  assert.equal(row.history.at(-1).by, "Ali");

  row = freshRow();
  const tvCancel = await route.POST(request("tv", { status: "cancelled" }));
  assert.equal(tvCancel.status, 403);
  assert.equal(refundCount, 0);

  row = freshRow();
  const adminCancel = await route.POST(
    request("admin", { status: "cancelled", by: "dashboard" }),
  );
  assert.equal(adminCancel.status, 200);
  assert.equal(refundCount, 1);
  assert.equal(row.status, "cancelled");

  console.log("Order role transition route tests passed.");
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
