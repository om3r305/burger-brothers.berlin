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

function formRequest(origin) {
  return new Request(`${origin}/api/tv/login`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ pin: "19051905", next: "/tv" }),
    redirect: "manual",
  });
}

async function main() {
  process.env.NODE_ENV = "production";
  process.env.SESSION_SECRET = "route-test-session-secret-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  delete process.env.TV_PIN;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;

  const route = require(path.join(root, "app/api/tv/login/route.ts"));

  const local = await route.POST(formRequest("http://localhost:3000"));
  assert.equal(local.status, 303);
  assert.equal(new URL(local.headers.get("location")).pathname, "/tv");
  assert.match(local.headers.get("set-cookie") || "", /bb_tv_auth=/);

  const live = await route.POST(formRequest("https://www.burger-brothers.berlin"));
  assert.equal(live.status, 303);
  const liveLocation = new URL(live.headers.get("location"));
  assert.equal(liveLocation.pathname, "/tv/login");
  assert.equal(liveLocation.searchParams.get("reason"), "server_error");

  process.env.VERCEL = "1";
  const vercelSpoof = await route.POST(formRequest("http://localhost:3000"));
  assert.equal(vercelSpoof.status, 303);
  const vercelLocation = new URL(vercelSpoof.headers.get("location"));
  assert.equal(vercelLocation.pathname, "/tv/login");
  assert.equal(vercelLocation.searchParams.get("reason"), "server_error");

  console.log("TV login route localhost/production policy tests passed.");
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
