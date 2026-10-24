const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = fs.readFileSync(path.join(__dirname, "../hooks/use-dialog-viewport.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;

function mount(open, visual = true) {
  const browser = new EventTarget();
  browser.innerHeight = 800;
  if (visual) {
    browser.visualViewport = new EventTarget();
    Object.assign(browser.visualViewport, { height: 800, offsetTop: 0 });
  }
  let style;
  let cleanup;
  const exports = {};
  vm.runInNewContext(code, {
    exports, window: browser,
    require: () => ({
      useState: () => [{}, (next) => { style = next; }],
      useEffect: (effect) => { cleanup = effect(); },
    }),
  });
  exports.useDialogViewport(open);
  return { browser, current: () => style, unmount: () => cleanup?.() };
}

// Keyboard shrinks visual viewport while the layout viewport stays at 800px.
const dialog = mount(true);
assert.equal(dialog.current()["--bb-dialog-height"], "800px");
Object.assign(dialog.browser.visualViewport, { height: 300, offsetTop: 40 });
dialog.browser.visualViewport.dispatchEvent(new Event("resize"));
assert.equal(dialog.browser.innerHeight, 800);
assert.equal(dialog.current()["--bb-dialog-height"], "300px");
assert.equal(dialog.current()["--bb-dialog-top"], "40px");
dialog.browser.visualViewport.offsetTop = 80;
dialog.browser.visualViewport.dispatchEvent(new Event("scroll"));
assert.equal(dialog.current()["--bb-dialog-top"], "80px");
dialog.unmount();
const last = dialog.current();
dialog.browser.visualViewport.height = 600;
dialog.browser.visualViewport.dispatchEvent(new Event("resize"));
dialog.browser.dispatchEvent(new Event("resize"));
assert.equal(dialog.current(), last, "closed dialogs must remove viewport listeners");

const fallback = mount(true, false);
fallback.browser.innerHeight = 400;
fallback.browser.dispatchEvent(new Event("resize"));
assert.equal(fallback.current()["--bb-dialog-height"], "400px");
fallback.unmount();
assert.equal(mount(false).current(), undefined);

// Public certificates read from Play Console on 2026-10-24, including key rotation.
const links = JSON.parse(fs.readFileSync(path.join(__dirname, "../public/.well-known/assetlinks.json"), "utf8"));
const app = links.find((entry) => entry.target.package_name === "berlin.burgerbrothers.app");
for (const fingerprint of [
  "CC:F7:15:FC:D1:53:21:90:88:0D:E0:D1:B6:E6:9D:C3:A9:49:C4:A8:1A:94:23:9D:E8:18:E8:DA:0E:7D:A0:F1",
  "CE:76:26:D9:8E:40:47:D6:CE:B9:5A:44:80:76:D7:1B:0E:4C:AE:92:FD:F5:87:B7:D3:B0:16:6D:7E:9F:8D:85",
  "90:1B:30:E2:EF:EA:43:90:46:A1:7A:50:3B:5C:64:7A:72:7D:59:E1:0A:17:DC:06:63:52:DB:40:30:37:0D:E5",
]) assert.ok(app.target.sha256_cert_fingerprints.includes(fingerprint));
assert.ok(app.relation.includes("delegate_permission/common.handle_all_urls"));
console.log("Dialog viewport (keyboard, pan, fallback, cleanup) + Play signing rotation: OK");
