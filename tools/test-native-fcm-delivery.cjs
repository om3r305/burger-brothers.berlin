// Opt-in integration test: sends six real test alerts to the separate emulator debug apps.
// Secrets/tokens remain in memory. Never save raw adb output, HTTP bodies or credentials.
const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  crypto = require("node:crypto"),
  cp = require("node:child_process"),
  ts = require("typescript");
const root = path.resolve(__dirname, "..");
const suite = path.join(root, "mobile/android/webview-suite");
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (
    !["--service-account-file", "--adb", "--serial"].includes(
      process.argv[i],
    ) ||
    !process.argv[i + 1]
  )
    throw Error("invalid_test_arguments");
  options[process.argv[i]] = process.argv[i + 1];
}
const reportFile = path.join(suite, "build/fcm-live-delivery.json");
const report = {
  date: new Date().toISOString(),
  projectId: "burger-brothers-android",
  environment: "local-emulator-debug-only",
  productionChanged: false,
  realOrdersCreated: false,
  credentialsLogged: false,
  results: [],
  diagnostics: [],
};
function fail(code) {
  throw Error(code);
}
function safeCode(value) {
  return typeof value === "string" && /^[A-Za-z0-9_:.-]{1,100}$/.test(value)
    ? value
    : "local_test_failed";
}
function execute(args) {
  const result = cp.spawnSync(
    options["--adb"],
    ["-s", options["--serial"], ...args],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60000,
      maxBuffer: 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    const reason = (result.stdout + result.stderr).match(
      /INSTALL_FAILED_[A-Z_]+/,
    )?.[0];
    fail(reason || "adb_" + String(args[0]).replace(/[^a-z]/g, "") + "_failed");
  }
  return result.stdout;
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function runPhase(fcm, app, mode) {
  const eventId = "bb-fcm-test-" + crypto.randomUUID();
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const publicKeyArgument = publicKey
    .export({ type: "spki", format: "der" })
    .toString("base64url");
  const args = [
    "-s",
    options["--serial"],
    "shell",
    "am",
    "instrument",
    "-w",
    "-r",
    "-e",
    "class",
    "berlin.burgerbrothers.shell.FcmDeliveryTest#deliveryAndTap",
    "-e",
    "bbFcmEventId",
    eventId,
    "-e",
    "bbFcmPublicKey",
    publicKeyArgument,
    "-e",
    "bbFcmMode",
    mode,
    "-e",
    "bbFcmPath",
    app.path,
    app.package + ".test/androidx.test.runner.AndroidJUnitRunner",
  ];
  execute(["shell", "am", "force-stop", app.package]);
  const child = cp.spawn(options["--adb"], args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "",
    closed = false,
    exitCode = null;
  child.stdout.on("data", (data) => {
    output = (output + data.toString()).slice(-131072);
  });
  // Do not forward stderr: only sanitized test state is reported.
  child.stderr.on("data", () => {});
  child.on("error", () => {
    closed = true;
    exitCode = -1;
  });
  child.on("close", (code) => {
    closed = true;
    exitCode = code;
  });
  try {
    const readyDeadline = Date.now() + 60000;
    while (
      !output.includes("bbFcmPhase=READY:" + eventId) &&
      Date.now() < readyDeadline &&
      !closed
    )
      await delay(100);
    if (!output.includes("bbFcmPhase=READY:" + eventId))
      fail("instrumentation_not_ready");
    const encoded = output.match(/bbFcmTokenEnvelope=([A-Za-z0-9_-]+)/)?.[1];
    if (!encoded) fail("encrypted_debug_token_missing");
    const envelope = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    );
    const aesKey = crypto.privateDecrypt(
      {
        key: privateKey,
        oaepHash: "sha256",
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      },
      Buffer.from(envelope.key, "base64url"),
    );
    const encrypted = Buffer.from(envelope.token, "base64url");
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      aesKey,
      Buffer.from(envelope.nonce, "base64url"),
    );
    decipher.setAuthTag(encrypted.subarray(-16));
    const token = Buffer.concat([
      decipher.update(encrypted.subarray(0, -16)),
      decipher.final(),
    ]).toString("utf8");
    aesKey.fill(0);
    if (!fcm.normalizeFcmToken(token)) fail("invalid_debug_token");
    const result = await fcm.sendFcmAlert(
      fcm.fcmEndpointForToken(token, app.kind),
      {
        title: "Android-Benachrichtigungstest",
        body: "Lokaler Zustelltest - keine Bestellung.",
        url: app.path,
        type: "local_delivery_test",
        eventId,
        ttlSeconds: 60,
      },
      15000,
    );
    if (!result.ok) fail(safeCode(result.error || "fcm_send_failed"));
    const finishDeadline = Date.now() + 75000;
    while (!closed && Date.now() < finishDeadline) await delay(100);
    if (!closed) fail("instrumentation_finish_timeout");
    if (
      exitCode !== 0 ||
      !output.includes("bbFcmPhase=DELIVERED_AND_TAPPED:" + eventId) ||
      !output.includes("OK (1 test)")
    ) {
      if (
        output.includes("Timed out waiting for the targeted FCM notification")
      )
        fail("device_delivery_timeout");
      if (output.includes("Wrong foreground/background notification route"))
        fail("notification_route_mismatch");
      if (output.includes("Notification tap did not return"))
        fail("notification_tap_failed");
      fail("delivery_instrumentation_assertion_failed");
    }
    const item = {
      flavor: app.flavor,
      packageId: app.package,
      mode,
      httpStatus: result.status,
      delivery: "PASS",
      notificationTap: "PASS",
      expectedRoute:
        mode === "foreground" ? "native-service" : "firebase-system-tray",
    };
    report.results.push(item);
    console.log(
      app.flavor +
        " " +
        mode +
        ": HTTP " +
        result.status +
        ", delivery + tap PASS",
    );
  } finally {
    if (!closed) child.kill();
    execute(["shell", "am", "force-stop", app.package]);
  }
}
(async () => {
  if (
    !options["--service-account-file"] ||
    !options["--adb"] ||
    !options["--serial"]
  )
    fail("missing_required_test_arguments");
  const accountFile = fs.realpathSync(options["--service-account-file"]);
  const relative = path.relative(root, accountFile);
  if (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))
    fail("service_account_must_stay_outside_repository");
  const accountText = fs.readFileSync(accountFile, "utf8");
  const account = JSON.parse(accountText);
  if (
    account.type !== "service_account" ||
    account.project_id !== report.projectId ||
    account.client_email !==
      "bb-fcm-sender@burger-brothers-android.iam.gserviceaccount.com"
  )
    fail("unexpected_service_account_metadata");
  const scopedFetch = async (...args) => {
    const response = await fetch(...args);
    if (!response.ok) {
      const payload = await response
        .clone()
        .json()
        .catch(() => ({}));
      report.diagnostics.push({
        host: new URL(args[0]).hostname,
        status: response.status,
        code: safeCode(payload.error?.status),
        reason: safeCode(
          payload.error?.details?.find((item) => item.reason)?.reason,
        ),
      });
    }
    return response;
  };
  const fcm = {};
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(path.join(root, "lib/server/fcm.ts"), "utf8"),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    {
      exports: fcm,
      require: (name) => {
        if (name === "node:crypto") return crypto;
        fail("unexpected_fcm_dependency");
      },
      process: { env: { FIREBASE_SERVICE_ACCOUNT_JSON: accountText } },
      Buffer,
      URLSearchParams,
      AbortController,
      setTimeout,
      clearTimeout,
      fetch: scopedFetch,
    },
  );
  if (!fcm.isFcmConfigured()) fail("invalid_fcm_credential_format");
  report.credentialMetadata = "PASS";
  const api = Number(
    execute(["shell", "getprop", "ro.build.version.sdk"]).trim(),
  );
  report.androidApi = api;
  for (const app of [
    {
      flavor: "customer",
      kind: "main",
      package: "berlin.burgerbrothers.app.webviewdebug",
      path: "/menu",
    },
    {
      flavor: "driver",
      kind: "driver",
      package: "berlin.burgerbrothers.driver.webviewdebug",
      path: "/driver",
    },
    {
      flavor: "schnell",
      kind: "schnell",
      package: "berlin.burgerbrothers.schnell.webviewdebug",
      path: "/schnellbestellung/enter",
    },
  ]) {
    if (!app.package.endsWith(".webviewdebug"))
      fail("production_package_forbidden");
    execute([
      "install",
      "-r",
      "-t",
      path.join(
        suite,
        `app/build/outputs/apk/${app.flavor}/debug/app-${app.flavor}-debug.apk`,
      ),
    ]);
    execute([
      "install",
      "-r",
      "-t",
      path.join(
        suite,
        `app/build/outputs/apk/androidTest/${app.flavor}/debug/app-${app.flavor}-debug-androidTest.apk`,
      ),
    ]);
    if (api >= 33)
      execute([
        "shell",
        "pm",
        "grant",
        app.package,
        "android.permission.POST_NOTIFICATIONS",
      ]);
    for (const mode of ["foreground", "background"])
      await runPhase(fcm, app, mode);
  }
  report.status = "PASS";
  console.log(
    "Live FCM delivery: PASS (six test alerts, three isolated debug apps; no production config/order changes)",
  );
})()
  .catch((error) => {
    report.status = "FAIL";
    report.error = safeCode(error.message);
    console.error("Live FCM delivery failed: " + report.error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.mkdirSync(path.dirname(reportFile), { recursive: true });
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + "\n");
  });
