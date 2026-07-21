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

const TOKEN = "6kSOCDFu9ranDzGazLZCPGvbMwr4MKh1_J6Vvf2Fpgw";
const ORDER_ID = "7UK8P3";
const TENANT_ID = "tenant-1";

const order = {
  id: ORDER_ID,
  tenantId: TENANT_ID,
  mode: "delivery",
  channel: "web",
  status: "preparing",
  merchandise: 17.5,
  discount: 0.7,
  surcharges: 2,
  total: 18.8,
  coupon: null,
  couponDiscount: 0,
  customer: {
    name: "Ömer yıldırım",
    phone: "12345678912",
    email: "private@example.test",
    address: "Wickeder Straße 8a | 13507 Berlin",
  },
  items: [{ name: "All American", qty: 1, price: 9.5 }],
  meta: {
    trackingToken: TOKEN,
    paymentMethod: "online",
    paymentStatus: "paid",
    privateValue: "must-not-leak",
  },
  driver: { id: "driver-1", name: "Ali" },
  ts: new Date(),
  updatedAt: new Date(),
};

const trackingSession = {
  id: "tracking-session-1",
  tenantId: TENANT_ID,
  active: true,
  driverId: "driver-1",
  orderIds: [ORDER_ID],
  last: { lat: 52.58, lng: 13.29, ts: Date.now() },
  history: [{ lat: 52.57, lng: 13.28, ts: Date.now() - 1000 }],
  createdAt: new Date(),
  updatedAt: new Date(),
};

let directOrderLookups = 0;
let tokenOrderLookups = 0;

const prisma = {
  order: {
    findFirst: async ({ where }) => {
      if (where?.meta?.path?.[0] === "trackingToken") {
        tokenOrderLookups += 1;
        return where.meta.equals === TOKEN ? order : null;
      }

      if (where?.id) {
        directOrderLookups += 1;
        if (typeof where.id === "string") return where.id === ORDER_ID ? order : null;
        if (Array.isArray(where.id?.in)) {
          return where.id.in.includes(ORDER_ID) ? order : null;
        }
      }

      return null;
    },
  },
  trackingSession: {
    findFirst: async ({ where }) => {
      const requestedOrderId = where?.orderIds?.has;
      if (requestedOrderId && requestedOrderId !== ORDER_ID) return null;
      return trackingSession;
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
  if (request === "@prisma/client") {
    class Decimal {
      constructor(value) {
        this.value = Number(value || 0);
      }
      toNumber() {
        return this.value;
      }
    }
    return { Prisma: { Decimal } };
  }

  if (request === "@/lib/db") {
    return { prisma, getTenantId: async () => TENANT_ID };
  }

  if (request === "@/lib/server/request-security") {
    return {
      enforceRateLimit: async () => null,
      hasAnySessionRole: async (req, roles) => {
        const role = req.headers.get("x-test-role") || "";
        return roles.includes(role);
      },
      getSessionSubject: async (req, role) =>
        role === "driver" ? req.headers.get("x-test-driver") || "" : "",
      securityJson: (payload, status = 200) => NextResponse.json(payload, { status }),
    };
  }

  if (request === "@/lib/server/driver-order") {
    return { orderAssignedToDriver: () => true };
  }

  return originalLoad.call(this, request, parent, isMain);
};

function getRequest(url, role = "") {
  return new Request(url, {
    method: "GET",
    headers: role ? { "x-test-role": role } : undefined,
  });
}

async function main() {
  const lookupRoute = require(path.join(root, "app/api/track/lookup/route.ts"));
  const byOrderRoute = require(
    path.join(root, "app/api/track/by-order/[orderId]/route.ts"),
  );

  // Regression: a TV cookie must not turn a customer token into an Order.id lookup.
  directOrderLookups = 0;
  tokenOrderLookups = 0;
  const tokenResponseWithTv = await lookupRoute.GET(
    getRequest(
      `https://example.test/api/track/lookup?trackingToken=${encodeURIComponent(TOKEN)}`,
      "tv",
    ),
  );
  assert.equal(tokenResponseWithTv.status, 200);
  const tokenPayloadWithTv = await tokenResponseWithTv.json();
  assert.equal(tokenPayloadWithTv.ok, true);
  assert.equal(tokenPayloadWithTv.order.id, ORDER_ID);
  assert.equal(tokenPayloadWithTv.order.customer, undefined);
  assert.equal(JSON.stringify(tokenPayloadWithTv).includes("private@example.test"), false);
  assert.equal(JSON.stringify(tokenPayloadWithTv).includes("must-not-leak"), false);
  assert.equal(directOrderLookups, 0);
  assert.equal(tokenOrderLookups, 1);

  // Existing TV operation remains unchanged when no customer token is supplied.
  directOrderLookups = 0;
  tokenOrderLookups = 0;
  const operationalResponse = await lookupRoute.GET(
    getRequest(`https://example.test/api/track/lookup?id=${ORDER_ID}`, "tv"),
  );
  assert.equal(operationalResponse.status, 200);
  const operationalPayload = await operationalResponse.json();
  assert.equal(operationalPayload.order.id, ORDER_ID);
  assert.equal(directOrderLookups, 1);
  assert.equal(tokenOrderLookups, 0);

  // The live-position endpoint must obey the same token precedence rule.
  directOrderLookups = 0;
  tokenOrderLookups = 0;
  const positionResponseWithTv = await byOrderRoute.GET(
    getRequest(
      `https://example.test/api/track/by-order/${encodeURIComponent(TOKEN)}?trackingToken=${encodeURIComponent(TOKEN)}`,
      "tv",
    ),
    { params: { orderId: TOKEN } },
  );
  assert.equal(positionResponseWithTv.status, 200);
  const positionPayloadWithTv = await positionResponseWithTv.json();
  assert.equal(positionPayloadWithTv.ok, true);
  assert.equal(positionPayloadWithTv.session.id, undefined);
  assert.equal(positionPayloadWithTv.session.driverId, undefined);
  assert.equal(positionPayloadWithTv.session.history, undefined);
  assert.equal(typeof positionPayloadWithTv.session.last?.lat, "number");
  assert.equal(directOrderLookups, 0);
  assert.equal(tokenOrderLookups, 1);

  // Direct TV order-id access to the live session is still available.
  directOrderLookups = 0;
  tokenOrderLookups = 0;
  const operationalPosition = await byOrderRoute.GET(
    getRequest(`https://example.test/api/track/by-order/${ORDER_ID}`, "tv"),
    { params: { orderId: ORDER_ID } },
  );
  assert.equal(operationalPosition.status, 200);
  const operationalPositionPayload = await operationalPosition.json();
  assert.equal(operationalPositionPayload.session.id, trackingSession.id);
  assert.equal(operationalPositionPayload.session.driverId, "driver-1");
  assert.equal(directOrderLookups, 1);
  assert.equal(tokenOrderLookups, 0);

  console.log("Tracking token/session-role regression tests passed.");
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
