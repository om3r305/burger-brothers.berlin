const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = process.cwd();
const originalTsLoader = require.extensions[".ts"];

require.extensions[".ts"] = (module, filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      esModuleInterop: true,
      strict: true,
    },
    reportDiagnostics: true,
  });

  const errors = (output.diagnostics || []).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.equal(
    errors.length,
    0,
    errors
      .map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      )
      .join("\n"),
  );
  module._compile(output.outputText, filename);
};

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function requireTs(relative) {
  return require(path.join(root, relative));
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function waitForProxy(child) {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => {
      reject(new Error(`print proxy startup timeout: ${output}`));
    }, 10_000);

    const receive = (chunk) => {
      output += chunk.toString();
      if (output.includes("print-proxy up")) {
        clearTimeout(timeout);
        resolve();
      }
    };

    child.stdout.on("data", receive);
    child.stderr.on("data", receive);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`print proxy exited early (${code}): ${output}`));
    });
  });
}

async function testPrintProxyAuthentication() {
  const port = await availablePort();
  const token = "hardening-test-token-0123456789-abcdef";
  const child = childProcess.spawn(
    process.execPath,
    [path.join(root, "print-proxy/index.cjs")],
    {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(port),
        PRINT_PROXY_HOST: "127.0.0.1",
        PRINT_PROXY_TOKEN: token,
        FISCAL_OPERATION_MODE: "webshop_only",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  try {
    await waitForProxy(child);
    const endpoint = `http://127.0.0.1:${port}/health`;
    const denied = await fetch(endpoint);
    assert.equal(denied.status, 401);
    assert.deepEqual(await denied.json(), { ok: false, error: "unauthorized" });

    const allowed = await fetch(endpoint, {
      headers: { "x-print-proxy-token": token },
    });
    assert.equal(allowed.status, 200);
    const payload = await allowed.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.fiscalOperationMode, "webshop_only");
    assert.equal(payload.legacyTaxFallback, false);
  } finally {
    child.kill("SIGTERM");
  }
}

async function main() {
  const availability = requireTs("lib/availability.ts");
  const summer = availability.zonedDateTimeToDate(
    { year: 2026, month: 7, day: 27, hour: 11, minute: 30 },
    "Europe/Berlin",
  );
  const winter = availability.zonedDateTimeToDate(
    { year: 2026, month: 1, day: 15, hour: 11, minute: 30 },
    "Europe/Berlin",
  );
  assert.equal(summer.toISOString(), "2026-07-27T09:30:00.000Z");
  assert.equal(winter.toISOString(), "2026-01-15T10:30:00.000Z");
  assert.equal(
    availability.isoDateInTZ(
      new Date("2026-07-27T22:30:00.000Z"),
      "Europe/Berlin",
    ),
    "2026-07-28",
  );

  const { decideOrderStatusTransition } = requireTs(
    "lib/server/order-status-policy.ts",
  );
  assert.equal(
    decideOrderStatusTransition({
      current: "ready",
      next: "cancelled",
      role: "tv",
      mode: "delivery",
    }).allowed,
    false,
  );
  assert.equal(
    decideOrderStatusTransition({
      current: "ready",
      next: "out_for_delivery",
      role: "admin",
      mode: "pickup",
    }).allowed,
    false,
  );
  assert.deepEqual(
    decideOrderStatusTransition({
      current: "cancelled",
      next: "preparing",
      role: "admin",
      mode: "delivery",
    }),
    {
      allowed: false,
      requiresOverrideReason: true,
      error: "status_override_reason_required",
    },
  );
  assert.equal(
    decideOrderStatusTransition({
      current: "cancelled",
      next: "preparing",
      role: "admin",
      mode: "delivery",
      overrideReason: "Müşteri yeniden onayladı",
    }).allowed,
    true,
  );
  assert.equal(
    decideOrderStatusTransition({
      current: "out_for_delivery",
      next: "done",
      role: "driver",
      mode: "delivery",
    }).allowed,
    true,
  );
  assert.equal(
    decideOrderStatusTransition({
      current: "new",
      next: "done",
      role: "driver",
      mode: "delivery",
    }).allowed,
    false,
  );

  const { verifyTotp } = requireTs("lib/server/totp.ts");
  const rfcSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  assert.equal(verifyTotp("287082", rfcSecret, 59_000), true);
  assert.equal(verifyTotp("287083", rfcSecret, 59_000), false);
  assert.equal(verifyTotp("287082", "invalid", 59_000), false);

  process.env.BACKUP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.BACKUP_ENCRYPTION_KEY_ID = "hardening-test";
  const backup = requireTs("lib/server/backup-crypto.ts");
  const sourcePayload = {
    tenant: "test-tenant",
    order: { id: "order-1", customer: "sensitive-example" },
  };
  const envelope = backup.encryptBackupPayload(sourcePayload);
  assert.equal(backup.isEncryptedBackupEnvelope(envelope), true);
  assert.deepEqual(backup.decryptBackupPayload(envelope), sourcePayload);
  assert.equal(JSON.stringify(envelope).includes("sensitive-example"), false);
  assert.throws(() =>
    backup.decryptBackupPayload({
      ...envelope,
      authTag: Buffer.alloc(16, 0).toString("base64"),
    }),
  );

  assert.equal(fs.existsSync(path.join(root, "middleware.ts")), true);
  assert.equal(fs.existsSync(path.join(root, "public/middleware.ts")), false);

  const proxy = read("print-proxy/index.cjs");
  assert.match(proxy, /PRINT_PROXY_HOST \|\| '127\.0\.0\.1'/);
  assert.match(proxy, /timingSafeEqual/);
  assert.match(proxy, /url_resolution_disabled/);
  assert.doesNotMatch(proxy, /function\s+resolveOrderFromUrl/);
  assert.match(proxy, /function sanitizePrinterText/);
  assert.ok(proxy.includes("\\u0000-\\u001F"));

  const agent = read("print-agent/agent.mjs");
  assert.doesNotMatch(agent, /fileCfg\.printProxyToken \|\|\s*fileCfg\.token/);
  assert.match(agent, /PRINT_AGENT_TOKEN ve PRINT_PROXY_TOKEN farklı olmalı/);

  assert.match(read("lib/server/payment-signature.ts"), /PAYMENT_FINALIZE_SECRET/);
  assert.match(read("lib/server/payment-share-token.ts"), /PAYMENT_SHARE_SECRET/);
  assert.doesNotMatch(read("lib/server/payment-signature.ts"), /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(read("lib/server/payment-share-token.ts"), /STRIPE_SECRET_KEY/);

  const schema = read("prisma/schema.prisma");
  assert.match(schema, /idempotencyKey\s+String\?/);
  assert.match(schema, /@@unique\(\[tenantId,\s*idempotencyKey\]/);
  assert.match(schema, /model AnalyticsEvent/);
  assert.match(schema, /taxRate\s+Int\s+@default\(7\)/);

  const analyticsRoute = read("app/api/analytics/collect/route.ts");
  assert.match(analyticsRoute, /analytics-v1/);
  assert.match(analyticsRoute, /prisma\.analyticsEvent\.create/);
  assert.doesNotMatch(analyticsRoute, /headers\.get\(["']user-agent/);
  assert.doesNotMatch(analyticsRoute, /new URL\(req\.url\)\.searchParams/);
  assert.match(read("components/PrivacyConsent.tsx"), /Statistik erlauben/);

  const orderCreate = read("app/api/orders/create/route.ts");
  assert.match(orderCreate, /idempotency-key/);
  assert.match(orderCreate, /CUSTOMER_BLOCKED/);
  assert.match(orderCreate, /requestHash/);
  assert.match(orderCreate, /Customer upsert failed after order creation/);
  assert.match(orderCreate, /try \{[\s\S]*upsertCustomerFromOrder/);

  const allTimezoneSources = [
    "lib/availability.ts",
    "lib/order-validation.ts",
    "app/checkout/page.tsx",
  ]
    .filter((relative) => fs.existsSync(path.join(root, relative)))
    .map(read)
    .join("\n");
  assert.doesNotMatch(allTimezoneSources, /new Date\([^\\n]*GMT/);

  await testPrintProxyAuthentication();
  console.log("Hardening regression tests: OK");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (originalTsLoader) require.extensions[".ts"] = originalTsLoader;
    else delete require.extensions[".ts"];
  });
