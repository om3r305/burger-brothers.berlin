const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = process.cwd();
const originalResolveFilename = Module._resolveFilename;
const originalTsLoader = require.extensions[".ts"];
const previous = {
  NODE_ENV: process.env.NODE_ENV,
  SESSION_SECRET: process.env.SESSION_SECRET,
  TV_PIN: process.env.TV_PIN,
  VERCEL: process.env.VERCEL,
  VERCEL_ENV: process.env.VERCEL_ENV,
};

const dbStub = path.join(root, "tools", ".tv-login-db-stub.cjs");
fs.writeFileSync(
  dbStub,
  `module.exports = {\n  getTenantId: async () => "tenant-test",\n  prisma: { setting: { findMany: async () => [] } },\n};\n`,
);

function resolveAlias(request) {
  if (request === "@/lib/db") return dbStub;
  if (!request.startsWith("@/")) return null;

  const base = path.join(root, request.slice(2));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
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
      errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")).join("\n"),
    );
  }

  module._compile(output.outputText, filename);
};

Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  const alias = resolveAlias(request);
  if (alias) return alias;
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

function formRequest(origin, pin = "736492") {
  return new Request(`${origin}/api/tv/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ pin, next: "/tv" }),
    redirect: "manual",
  });
}

async function main() {
  process.env.NODE_ENV = "production";
  process.env.SESSION_SECRET = "route-test-session-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  process.env.TV_PIN = "736492";
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;

  const route = require(path.join(root, "app/api/tv/login/route.ts"));

  for (const origin of [
    "http://localhost:3000",
    "https://www.burger-brothers.berlin",
  ]) {
    const response = await route.POST(formRequest(origin));
    assert.equal(response.status, 303);
    assert.equal(new URL(response.headers.get("location")).pathname, "/tv");
    assert.match(response.headers.get("set-cookie") || "", /bb_tv_auth=/);
  }

  const fixedFallback = await route.POST(
    formRequest("http://localhost:3000", "19051905"),
  );
  assert.equal(fixedFallback.status, 303);
  const fixedLocation = new URL(fixedFallback.headers.get("location"));
  assert.equal(fixedLocation.pathname, "/tv/login");
  assert.equal(fixedLocation.searchParams.get("reason"), "invalid_pin");

  delete process.env.TV_PIN;
  const missingConfiguration = await route.POST(
    formRequest("http://localhost:3000", "736492"),
  );
  assert.equal(missingConfiguration.status, 303);
  const missingLocation = new URL(missingConfiguration.headers.get("location"));
  assert.equal(missingLocation.pathname, "/tv/login");
  assert.equal(missingLocation.searchParams.get("reason"), "server_error");

  console.log("TV login route configured-PIN policy tests passed.");
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
    fs.rmSync(dbStub, { force: true });

    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
