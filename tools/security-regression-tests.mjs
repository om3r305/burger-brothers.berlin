import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { NextRequest } = require("next/server");

const root = process.cwd();
const originalResolveFilename = Module._resolveFilename;
const originalTsLoader = require.extensions[".ts"];
const previousSecret = process.env.SESSION_SECRET;
const previousVercel = process.env.VERCEL;
const previousVercelEnv = process.env.VERCEL_ENV;

function resolveAlias(request) {
  if (!request.startsWith("@/")) return null;

  const base = path.join(root, request.slice(2));
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
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
        .map((diagnostic) =>
          ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
        )
        .join("\n"),
    );
  }

  module._compile(output.outputText, filename);
};

Module._resolveFilename = function patchedResolve(
  request,
  parent,
  isMain,
  options,
) {
  const alias = resolveAlias(request);
  if (alias) return alias;
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

function request(pathname, options = {}) {
  return new NextRequest(`https://www.burger-brothers.berlin${pathname}`, {
    method: options.method || "GET",
    headers: options.cookie ? { cookie: options.cookie } : undefined,
  });
}

async function expectAllowed(middleware, req) {
  const response = await middleware(req);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-middleware-next"), "1");
}

async function expectUnauthorized(middleware, req) {
  const response = await middleware(req);
  assert.equal(response.status, 401);
  const payload = await response.json();
  assert.equal(payload.error, "unauthorized");
}

async function main() {
  process.env.SESSION_SECRET = "test-session-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  const {
    createSessionToken,
    readSessionToken,
    verifySessionToken,
  } = require(path.join(root, "lib/server/session.ts"));
  const {
    mayUseLocalTvPinFallback,
    isLoopbackTvHost,
  } = require(path.join(root, "lib/server/tv-pin-policy.ts"));
  const { contentSecurityPolicy, middleware } = require(
    path.join(root, "middleware.ts"),
  );

  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;

  assert.equal(isLoopbackTvHost("localhost"), true);
  assert.equal(isLoopbackTvHost("127.0.0.1"), true);
  assert.equal(isLoopbackTvHost("::1"), true);
  assert.equal(isLoopbackTvHost("www.burger-brothers.berlin"), false);

  for (const [url, environment] of [
    ["http://localhost:3000/api/tv/login", "production"],
    ["http://127.0.0.1:3000/api/tv/login", "production"],
    ["https://www.burger-brothers.berlin/api/tv/login", "production"],
    ["https://www.burger-brothers.berlin/api/tv/login", "development"],
  ]) {
    assert.equal(
      mayUseLocalTvPinFallback(new Request(url), environment),
      false,
    );
  }

  process.env.VERCEL = "1";
  assert.equal(
    mayUseLocalTvPinFallback(
      new Request("http://localhost:3000/api/tv/login"),
      "production",
    ),
    false,
  );
  delete process.env.VERCEL;

  const adminToken = await createSessionToken("admin", 3600);
  const tvToken = await createSessionToken("tv", 3600);
  const driverToken = await createSessionToken("driver", 3600, "driver-1");

  const nodeEnvBeforeCspTest = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const defaultCsp = contentSecurityPolicy("default-test-nonce");
  const tvCsp = contentSecurityPolicy("tv-test-nonce", {
    allowLocalPrintProxy: true,
  });
  if (nodeEnvBeforeCspTest === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = nodeEnvBeforeCspTest;
  assert.equal(defaultCsp.includes("http://127.0.0.1:7777"), false);
  assert.equal(tvCsp.includes("http://127.0.0.1:7777"), true);
  assert.equal(defaultCsp.includes("upgrade-insecure-requests"), true);
  assert.equal(tvCsp.includes("upgrade-insecure-requests"), false);

  assert.equal(await verifySessionToken(adminToken, "admin"), true);
  assert.equal(await verifySessionToken(adminToken, "tv"), false);
  assert.equal(await verifySessionToken(driverToken, "driver"), true);
  assert.equal((await readSessionToken(driverToken, "driver"))?.sub, "driver-1");
  assert.equal(
    await verifySessionToken(`${adminToken.slice(0, -1)}x`, "admin"),
    false,
  );

  const expiredToken = await createSessionToken("admin", -1);
  assert.equal(await verifySessionToken(expiredToken, "admin"), false);

  await expectUnauthorized(
    middleware,
    request("/api/admin/orders", { cookie: "bb_admin_sess=ok:forged" }),
  );
  await expectAllowed(
    middleware,
    request("/api/admin/orders", {
      cookie: `bb_admin_sess=${encodeURIComponent(adminToken)}`,
    }),
  );

  await expectUnauthorized(middleware, request("/api/orders/list"));
  await expectAllowed(
    middleware,
    request("/api/orders/list", {
      cookie: `bb_driver_sess=${encodeURIComponent(driverToken)}`,
    }),
  );
  await expectAllowed(
    middleware,
    request("/api/orders/list", {
      cookie: `bb_tv_auth=${encodeURIComponent(tvToken)}`,
    }),
  );

  const tvPageResponse = await middleware(
    request("/tv", {
      cookie: `bb_tv_auth=${encodeURIComponent(tvToken)}`,
    }),
  );
  assert.equal(tvPageResponse.status, 200);
  assert.match(
    tvPageResponse.headers.get("content-security-policy") || "",
    /connect-src[^;]*http:\/\/127\.0\.0\.1:7777/,
  );

  const adminPageResponse = await middleware(
    request("/admin", {
      cookie: `bb_admin_sess=${encodeURIComponent(adminToken)}`,
    }),
  );
  assert.equal(adminPageResponse.status, 200);
  assert.equal(
    (adminPageResponse.headers.get("content-security-policy") || "").includes(
      "http://127.0.0.1:7777",
    ),
    false,
  );

  await expectUnauthorized(middleware, request("/api/orders?id=ABC123"));
  await expectUnauthorized(
    middleware,
    request("/api/orders", { method: "POST" }),
  );
  await expectUnauthorized(
    middleware,
    request("/api/orders", { method: "PUT" }),
  );
  await expectAllowed(
    middleware,
    request("/api/orders/create", { method: "POST" }),
  );
  await expectUnauthorized(
    middleware,
    request("/api/products", {
      method: "PUT",
      cookie: "bb_admin_sess=ok:forged",
    }),
  );
  await expectAllowed(
    middleware,
    request("/api/products", {
      method: "PUT",
      cookie: `bb_admin_sess=${encodeURIComponent(adminToken)}`,
    }),
  );
  for (const path of [
    "/api/coupons",
    "/api/catalog",
    "/api/groups",
    "/api/bootstrap",
  ]) {
    await expectUnauthorized(
      middleware,
      request(path, {
        method: "POST",
        cookie: "bb_admin_sess=ok:forged",
      }),
    );
  }

  await expectUnauthorized(
    middleware,
    request("/api/pause", { method: "POST" }),
  );
  await expectUnauthorized(
    middleware,
    request("/api/track/session-1", { method: "POST" }),
  );
  await expectUnauthorized(
    middleware,
    request("/api/print/test", { method: "POST" }),
  );
  await expectUnauthorized(
    middleware,
    request("/api/brian/learn", { method: "POST" }),
  );
  await expectAllowed(
    middleware,
    request("/api/track/lookup?trackingToken=test"),
  );
  await expectAllowed(middleware, request("/api/settings"));

  for (const [path, method] of [
    ["/api/payments/profile", "GET"],
    ["/api/payments/profile", "POST"],
    ["/api/payments/profile", "DELETE"],
    ["/api/payments/share", "GET"],
    ["/api/payments/share", "POST"],
    ["/api/tv/logout", "GET"],
    ["/api/tv/logout", "POST"],
    ["/api/drivers", "POST"],
    ["/api/drivers", "DELETE"],
  ]) {
    await expectAllowed(middleware, request(path, { method }));
  }

  await expectUnauthorized(middleware, request("/api/drivers"));
  await expectUnauthorized(
    middleware,
    request("/api/private/file.js", { method: "POST" }),
  );

  await expectUnauthorized(
    middleware,
    request("/api/not-classified-mutation", { method: "POST" }),
  );
  await expectUnauthorized(
    middleware,
    request("/api/orders/claim", {
      cookie: `bb_tv_auth=${encodeURIComponent(tvToken)}`,
      method: "POST",
    }),
  );
  await expectAllowed(
    middleware,
    request("/api/orders/claim", {
      cookie: `bb_driver_sess=${encodeURIComponent(driverToken)}`,
      method: "POST",
    }),
  );

  console.log("Session and API authorization tests passed.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    Module._resolveFilename = originalResolveFilename;
    if (originalTsLoader) require.extensions[".ts"] = originalTsLoader;
    else delete require.extensions[".ts"];

    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;

    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;

    if (previousVercelEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousVercelEnv;
  });