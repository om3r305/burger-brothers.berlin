const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http2 = require("node:http2");
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
  const output = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      strict: true,
    },
    fileName: filename,
  });
  module._compile(output.outputText, filename);
};

Module._resolveFilename = function patchedResolve(request, parent, isMain, options) {
  return resolveAlias(request) || originalResolveFilename.call(this, request, parent, isMain, options);
};

const TOKEN = "a".repeat(64);
const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const savedEnv = { ...process.env };

function withServer(handler) {
  return new Promise((resolve) => {
    const server = http2.createServer();
    server.on("stream", handler);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  const apns = require(path.join(root, "lib/server/apns.ts"));

  // Token and endpoint handling.
  assert.equal(apns.normalizeApnsToken(TOKEN.toUpperCase()), TOKEN);
  assert.equal(apns.normalizeApnsToken("xyz"), null);
  assert.equal(apns.normalizeApnsToken("ab".repeat(10)), null);
  assert.equal(apns.apnsEndpointForToken(TOKEN), `apns://${TOKEN}`);
  assert.equal(apns.isApnsEndpoint(`apns://${TOKEN}`), true);
  assert.equal(apns.isApnsEndpoint("https://web.push.apple.com/x"), false);

  // Unconfigured: never attempts a request.
  delete process.env.APNS_KEY_ID;
  delete process.env.APNS_TEAM_ID;
  delete process.env.APNS_PRIVATE_KEY;
  assert.equal(apns.isApnsConfigured(), false);
  const skipped = await apns.sendApnsAlert(`apns://${TOKEN}`, { title: "t", body: "b" });
  assert.equal(skipped.attempted, false);
  assert.equal(skipped.ok, false);

  // Configured with a PEM key (raw, then base64 encoded).
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  process.env.APNS_KEY_ID = "ABC123DEFG";
  process.env.APNS_TEAM_ID = "TEAM123456";
  process.env.APNS_PRIVATE_KEY = Buffer.from(pem).toString("base64");
  assert.equal(apns.isApnsConfigured(), true);
  process.env.APNS_PRIVATE_KEY = pem;
  const config = apns.getApnsConfig();
  assert.equal(config.configured, true);
  assert.equal(config.bundleId, "berlin.burgerbrothers.app");
  assert.equal(config.host, "https://api.push.apple.com");

  // Provider token is a valid ES256 JWT for the team/key.
  const jwt = apns.providerToken(config);
  const [h, c, sig] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url")), { alg: "ES256", kid: "ABC123DEFG" });
  assert.equal(JSON.parse(Buffer.from(c, "base64url")).iss, "TEAM123456");
  assert.equal(
    crypto.verify("SHA256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")),
    true,
  );
  assert.equal(apns.providerToken(config), jwt, "provider token is cached");

  // Payload carries the alert and the site-relative URL for the tap handler.
  const payload = apns.buildApnsPayload({ title: "Bestellung", body: "Unterwegs", url: "/track/x", type: "order_status" });
  assert.equal(payload.aps.alert.title, "Bestellung");
  assert.equal(payload.aps.alert.body, "Unterwegs");
  assert.equal(payload.url, "/track/x");

  // Real HTTP/2 round trip against a local server.
  let seen = null;
  const okServer = await withServer((stream, headers) => {
    let body = "";
    stream.on("data", (chunk) => (body += chunk));
    stream.on("end", () => {
      seen = { headers, body: JSON.parse(body) };
      stream.respond({ ":status": 200 });
      stream.end();
    });
  });
  const okResult = await apns.sendApnsAlert(
    `apns://${TOKEN}`,
    { title: "Hallo", body: "Fertig", url: "/track/abc" },
    4_000,
    `http://127.0.0.1:${okServer.address().port}`,
  );
  okServer.close();
  assert.equal(okResult.ok, true);
  assert.equal(seen.headers[":path"], `/3/device/${TOKEN}`);
  assert.equal(seen.headers["apns-topic"], "berlin.burgerbrothers.app");
  assert.equal(seen.headers["apns-push-type"], "alert");
  assert.equal(seen.headers.authorization, `bearer ${jwt}`);
  assert.equal(seen.body.aps.alert.body, "Fertig");
  assert.equal(seen.body.url, "/track/abc");

  // 410 / Unregistered marks the device as expired.
  const goneServer = await withServer((stream) => {
    stream.respond({ ":status": 410 });
    stream.end(JSON.stringify({ reason: "Unregistered" }));
  });
  const gone = await apns.sendApnsAlert(`apns://${TOKEN}`, { title: "t", body: "b" }, 4_000, `http://127.0.0.1:${goneServer.address().port}`);
  goneServer.close();
  assert.equal(gone.ok, false);
  assert.equal(gone.expired, true);
  assert.equal(gone.error, "Unregistered");

  // A temporary APNs error is not treated as an expired device.
  const busyServer = await withServer((stream) => {
    stream.respond({ ":status": 503 });
    stream.end(JSON.stringify({ reason: "ServiceUnavailable" }));
  });
  const busy = await apns.sendApnsAlert(`apns://${TOKEN}`, { title: "t", body: "b" }, 4_000, `http://127.0.0.1:${busyServer.address().port}`);
  busyServer.close();
  assert.equal(busy.ok, false);
  assert.equal(busy.expired, false);

  // Wiring: general push routes APNs endpoints to sendApnsAlert and accepts native devices.
  const generalPush = fs.readFileSync(path.join(root, "lib/server/general-push.ts"), "utf8");
  assert.match(generalPush, /isApnsEndpoint\(event\.subscription\.endpoint\)/);
  assert.match(generalPush, /nativeConfigured: enabled && isApnsConfigured\(\)/);
  const route = fs.readFileSync(path.join(root, "app/api/push/route.ts"), "utf8");
  assert.match(route, /body\?\.native/);
  const client = fs.readFileSync(path.join(root, "lib/client/general-push.ts"), "utf8");
  assert.match(client, /BurgerBrothers-iOS\\\/main/);
  assert.match(client, /bb:nativePushPermission/);
  for (const app of ["Main", "Schnell", "Driver"]) {
    const swift = fs.readFileSync(path.join(root, `ios/BurgerBrothers${app}/App/WebView.swift`), "utf8");
    assert(swift.includes("bb:nativePushPermission"), `${app} reports the permission answer`);
    assert(swift.includes("window.BurgerBrothersNative.pushToken"), `${app} exposes the push token`);
  }

  console.log("APNs native push tests passed (config, ES256 token, payload, HTTP/2 send, expiry, wiring).");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.env = savedEnv;
    Module._resolveFilename = originalResolveFilename;
    if (originalTsLoader) require.extensions[".ts"] = originalTsLoader;
    else delete require.extensions[".ts"];
  });
