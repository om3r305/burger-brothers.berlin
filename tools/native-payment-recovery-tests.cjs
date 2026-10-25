const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  ts = require("typescript"),
  vm = require("node:vm");
function compile(file, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in imports, name);
        return imports[name];
      },
      ...globals,
    },
  );
  return exports;
}
const runtime = compile("lib/checkout/runtime.ts");
const record = {
  paymentSessionId: "session_1",
  recoveryToken: "Token_ABC-123",
  manageUrl: "https://evil.test/steal",
  paymentKind: "online",
  expiresAt: "2020-01-01",
};
const raw = JSON.stringify(record),
  expected = "/payment/center?paymentSession=session_1&recovery=Token_ABC-123";
const imports = {
  "@/lib/client/android-native-bridge": { isNativeAndroidCustomer: () => true },
  "@/lib/checkout/runtime": runtime,
};
const pure = compile("lib/client/native-payment-recovery.ts", imports);
assert.equal(
  pure.nativePaymentRecoveryPath(raw),
  expected,
  "Stored manageUrl never controls navigation",
);
for (const bad of [
  null,
  "{",
  JSON.stringify({}),
  JSON.stringify({ ...record, recoveryToken: "a\nb" }),
  JSON.stringify({ ...record, paymentSessionId: "x".repeat(257) }),
  JSON.stringify({ ...record, paymentKind: "cash" }),
])
  assert.equal(pure.nativePaymentRecoveryPath(bad), null);
assert.equal(
  typeof pure.installNativePaymentRecovery(),
  "function",
  "SSR safe",
);
const flush = () => new Promise((resolve) => setImmediate(resolve));
function fixture({
  path = "/checkout",
  candidate = raw,
  native = true,
  reply = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ok: true, status: "pending" }),
  }),
} = {}) {
  const winEvents = new Map(),
    docEvents = new Map(),
    destinations = [],
    requests = [];
  let storageFails = false;
  const win = {
    location: { pathname: path, replace: (p) => destinations.push(p) },
    localStorage: {
      getItem: () => {
        if (storageFails) throw Error("storage");
        return candidate;
      },
    },
    addEventListener: (n, f) => winEvents.set(n, f),
    removeEventListener: (n) => winEvents.delete(n),
  };
  const doc = {
    visibilityState: "visible",
    addEventListener: (n, f) => docEvents.set(n, f),
    removeEventListener: (n) => docEvents.delete(n),
  };
  const code = compile(
    "lib/client/native-payment-recovery.ts",
    {
      ...imports,
      "@/lib/client/android-native-bridge": {
        isNativeAndroidCustomer: () => native,
      },
    },
    {
      window: win,
      document: doc,
      AbortController,
      URLSearchParams,
      setTimeout,
      clearTimeout,
      fetch: async (url, options) => {
        requests.push({ url, options });
        return reply(url, options);
      },
    },
  );
  return {
    win,
    doc,
    winEvents,
    docEvents,
    destinations,
    requests,
    start: () => code.installNativePaymentRecovery(),
    setCandidate: (v) => (candidate = v),
    setStorageFails: (v) => (storageFails = v),
  };
}
(async () => {
  let f = fixture({ candidate: null }),
    clean = f.start();
  await flush();
  assert.equal(f.requests.length, 0);
  f.setCandidate(raw);
  f.doc.visibilityState = "hidden";
  await f.docEvents.get("visibilitychange")();
  assert.equal(f.requests.length, 0);
  f.doc.visibilityState = "visible";
  await f.winEvents.get("bb:nativeResume")();
  assert.deepEqual(f.destinations, [expected]);
  assert.equal(
    f.requests[0].url,
    "/api/payments/session?id=session_1&recovery=Token_ABC-123",
  );
  assert.equal(f.requests[0].options.credentials, "same-origin");
  await f.winEvents.get("pageshow")();
  assert.equal(f.requests.length, 1);
  clean();
  assert.equal(f.winEvents.size + f.docEvents.size, 0);
  for (const path of [
    "/payment/center",
    "/payment/action",
    "/payment/split",
    "/driver",
    "/schnellbestellung/enter",
    "/admin/orders",
  ]) {
    f = fixture({ path });
    clean = f.start();
    await flush();
    assert.equal(f.requests.length, 0, path + " retains its own flow");
    clean();
  }
  f = fixture({ path: "/menu" });
  clean = f.start();
  await flush();
  assert.deepEqual(
    f.destinations,
    [expected],
    "Cold start validated with server",
  );
  clean();
  f = fixture({ native: false });
  clean = f.start();
  await flush();
  assert.equal(f.requests.length, 0);
  assert.equal(f.winEvents.size + f.docEvents.size, 0);
  clean();
  for (const [status, payload] of [
    [403, { ok: false, error: "PAYMENT_RECOVERY_TOKEN_INVALID" }],
    [404, { ok: false }],
    [429, { ok: false }],
    [503, { ok: false }],
    [200, { ok: true, status: "mystery" }],
    [200, { ok: false, finalized: true }],
  ]) {
    f = fixture({
      reply: async () => ({
        ok: status === 200,
        status,
        json: async () => payload,
      }),
    });
    clean = f.start();
    await flush();
    assert.equal(
      f.destinations.length,
      0,
      "Unverified/stale candidate must not hijack the current page: " + status,
    );
    clean();
  }
  f = fixture();
  f.setStorageFails(true);
  clean = f.start();
  await flush();
  assert.equal(f.requests.length, 0);
  f.setStorageFails(false);
  await f.winEvents.get("bb:nativeResume")();
  assert.equal(f.destinations.length, 1);
  clean();
  let release;
  f = fixture({ reply: () => new Promise((resolve) => (release = resolve)) });
  clean = f.start();
  await f.winEvents.get("bb:nativeResume")();
  assert.equal(f.requests.length, 1, "Single flight");
  f.setCandidate(
    JSON.stringify({ ...record, paymentSessionId: "new-session" }),
  );
  release({ ok: true, json: async () => ({ ok: true, finalized: true }) });
  await flush();
  assert.equal(
    f.destinations.length,
    0,
    "Stale response must not replace a new payment candidate",
  );
  clean();
  f = fixture({ reply: () => new Promise((resolve) => (release = resolve)) });
  clean = f.start();
  const signal = f.requests[0].options.signal;
  clean();
  assert.equal(signal.aborted, true, "Unmount aborts pending validation");
  release({ ok: true, json: async () => ({ ok: true, finalized: true }) });
  await flush();
  assert.equal(f.destinations.length, 0);
  console.log(
    "Native payment recovery: PASS (server-confirmed resume/cold start, invalid/transient access, fixed origin, single flight, candidate replacement, abort/cleanup, storage denial, browser isolation; mocked transport)",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
