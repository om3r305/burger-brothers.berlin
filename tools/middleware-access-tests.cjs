const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const root = process.cwd();
const originalResolveFilename = Module._resolveFilename;
const originalTsLoader = require.extensions[".ts"];

function resolveAlias(request) {
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

try {
  const {
    apiAccess,
    publicAsset,
    contentSecurityPolicy,
  } = require(path.join(root, "middleware.ts"));

  const matrix = [
    ["/api/payments/profile", "GET", "public"],
    ["/api/payments/profile", "POST", "public"],
    ["/api/payments/profile", "DELETE", "public"],
    ["/api/payments/share", "GET", "public"],
    ["/api/payments/share", "POST", "public"],
    ["/api/tv/logout", "GET", "public"],
    ["/api/tv/logout", "POST", "public"],
    ["/api/drivers", "GET", "admin"],
    ["/api/drivers", "POST", "public"],
    ["/api/drivers", "DELETE", "public"],
    ["/api/drivers", "PUT", "admin"],
    ["/api/private/file.js", "POST", "admin"],
    ["/api/not-classified-mutation", "POST", "admin"],
  ];

  for (const [route, method, expected] of matrix) {
    assert.equal(apiAccess(route, method), expected, `${method} ${route}`);
  }

  assert.equal(publicAsset("/api/private/file.js"), false);
  assert.equal(publicAsset("/images/burger.webp"), true);
  assert.equal(publicAsset("/admin/private.js"), false);

  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  const csp = contentSecurityPolicy("testnonce");
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;

  assert.match(csp, /script-src[^;]*'nonce-testnonce'/);
  assert.match(csp, /script-src[^;]*'strict-dynamic'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-eval'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);

  console.log("Middleware access matrix and CSP tests passed.");
} finally {
  Module._resolveFilename = originalResolveFilename;
  if (originalTsLoader) require.extensions[".ts"] = originalTsLoader;
  else delete require.extensions[".ts"];
}
