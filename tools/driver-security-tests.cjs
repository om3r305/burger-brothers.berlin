const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { NextRequest } = require("next/server");

const root = process.cwd();
const originalLoad = Module._load;
const originalResolveFilename = Module._resolveFilename;
const originalTsLoader = require.extensions[".ts"];

const state = {
  value: [
    {
      id: "driver-1",
      name: "Ali",
      password: "1234",
      role: "fahrer",
    },
  ],
};

const settingApi = {
  findFirst: async () => ({ id: "setting-1", value: state.value }),
  update: async ({ data }) => {
    state.value = data.value;
    return { id: "setting-1", value: state.value };
  },
  deleteMany: async () => ({ count: 0 }),
  create: async ({ data }) => {
    state.value = data.value;
    return { id: "setting-1", value: state.value };
  },
};

const prisma = {
  setting: settingApi,
  $transaction: async (callback) =>
    callback({
      setting: settingApi,
    }),
};

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

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "@/lib/db") {
    return {
      prisma,
      getTenantId: async () => "tenant-1",
    };
  }

  if (request === "@/lib/server/session") {
    return {
      createSessionToken: async (role) => `${role}:signed-test-token`,
      verifySessionToken: async (token, role) =>
        token === "valid-admin-token" && role === "admin",
    };
  }

  return originalLoad.call(this, request, parent, isMain);
};

async function responseJson(response) {
  return response.json();
}

async function main() {
  const route = require(path.join(root, "app/api/drivers/route.ts"));

  const unauthorizedGet = await route.GET(
    new Request("https://example.test/api/drivers"),
  );
  assert.equal(unauthorizedGet.status, 401);

  const getResponse = await route.GET(
    new Request("https://example.test/api/drivers", {
      headers: { cookie: "bb_admin_sess=valid-admin-token" },
    }),
  );
  assert.equal(getResponse.status, 200);
  const getPayload = await responseJson(getResponse);
  assert.equal(getPayload.items.length, 1);
  assert.equal(getPayload.items[0].name, "Ali");
  assert.equal(getPayload.items[0].password, "");
  assert.equal("passwordHash" in getPayload.items[0], false);
  assert.match(state.value[0].passwordHash, /^scrypt\$/);
  assert.equal("password" in state.value[0], false);

  const loginResponse = await route.POST(
    new Request("https://example.test/api/drivers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "login",
        name: "Ali",
        password: "1234",
        remember: true,
      }),
    }),
  );
  assert.equal(loginResponse.status, 200);
  assert.match(loginResponse.headers.get("set-cookie") || "", /bb_driver_sess=/);

  const badLoginResponse = await route.POST(
    new Request("https://example.test/api/drivers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "login",
        name: "Ali",
        password: "wrong",
      }),
    }),
  );
  assert.equal(badLoginResponse.status, 401);

  const unauthorizedPut = await route.PUT(
    new NextRequest("https://example.test/api/drivers", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [] }),
    }),
  );
  assert.equal(unauthorizedPut.status, 401);

  const oldHash = state.value[0].passwordHash;
  const authorizedPut = await route.PUT(
    new NextRequest("https://example.test/api/drivers", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: "bb_admin_sess=valid-admin-token",
      },
      body: JSON.stringify({
        items: [
          {
            id: "driver-1",
            name: "Ali",
            password: "",
            role: "fahrer",
          },
        ],
      }),
    }),
  );
  assert.equal(authorizedPut.status, 200);
  assert.equal(state.value[0].passwordHash, oldHash);

  const weakPasswordPut = await route.PUT(
    new NextRequest("https://example.test/api/drivers", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: "bb_admin_sess=valid-admin-token",
      },
      body: JSON.stringify({
        items: [
          { id: "driver-1", name: "Ali", password: "", role: "fahrer" },
          { id: "driver-2", name: "Veli", password: "1", role: "fahrer" },
        ],
      }),
    }),
  );
  assert.equal(weakPasswordPut.status, 400);
  assert.equal((await responseJson(weakPasswordPut)).error, "driver_password_weak");
  assert.equal(state.value.length, 1);

  const strongPasswordPut = await route.PUT(
    new NextRequest("https://example.test/api/drivers", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        cookie: "bb_admin_sess=valid-admin-token",
      },
      body: JSON.stringify({
        items: [
          { id: "driver-1", name: "Ali", password: "", role: "fahrer" },
          { id: "driver-2", name: "Veli", password: "Strong123", role: "fahrer" },
        ],
      }),
    }),
  );
  assert.equal(strongPasswordPut.status, 200);
  assert.equal(state.value.length, 2);
  assert.match(state.value[1].passwordHash, /^scrypt\$/);
  assert.equal("password" in state.value[1], false);

  const logoutResponse = await route.DELETE(
    new Request("https://example.test/api/drivers", { method: "DELETE" }),
  );
  assert.equal(logoutResponse.status, 200);
  assert.match(
    logoutResponse.headers.get("set-cookie") || "",
    /bb_driver_sess=.*Max-Age=0/i,
  );

  console.log("Driver password and session tests passed.");
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
