const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const source = fs.readFileSync(
  "mobile/android/webview-suite/app/src/main/java/berlin/burgerbrothers/shell/DialogBackScript.java",
  "utf8",
);
const script = JSON.parse(source.match(/SCRIPT = (".*");/)[1]);
let clicks = 0,
  escapes = 0;
const button = (marked, text, visible = true, disabled = false) => ({
  marked,
  textContent: text,
  disabled,
  getClientRects: () => (visible ? [{}] : []),
  click: () => clicks++,
});
const dialog = (buttons, visible = true) => ({
  getClientRects: () => (visible ? [{}] : []),
  querySelectorAll: (q) =>
    q === "button" ? buttons : buttons.filter((b) => b.marked),
});
function run(dialogs) {
  return vm.runInNewContext(script, {
    document: { querySelectorAll: () => dialogs },
    window: {
      dispatchEvent: (e) => {
        assert.equal(e.key, "Escape");
        escapes++;
      },
    },
    KeyboardEvent: function (type, options) {
      Object.assign(this, { type }, options);
    },
  });
}
assert.equal(run([]), false, "No modal delegates to native history");
assert.equal(
  run([dialog([button(true, "Different translated caption")])]),
  true,
);
assert.equal(clicks, 1, "Data attribute closes regardless of text");
assert.equal(
  run([
    dialog([
      button(true, "hidden", false),
      button(true, "disabled", true, true),
      button(true, "Close"),
    ]),
  ]),
  true,
);
assert.equal(clicks, 2);
const lower = button(true, "lower");
lower.click = () => {
  throw Error("Must not close underlying modal");
};
assert.equal(run([dialog([lower]), dialog([button(true, "top")])]), true);
assert.equal(clicks, 3);
assert.equal(
  run([dialog([lower], false)]),
  false,
  "Hidden overlays do not consume Back",
);
assert.equal(run([dialog([button(false, "Schließen")])]), true);
assert.equal(clicks, 4, "Older deployed web keeps fallback compatibility");
assert.equal(run([dialog([])]), true);
assert.equal(
  escapes,
  1,
  "Modal consumes Back while Escape handler settles, without navigating underneath it",
);
console.log(
  "Native dialog Back: PASS (actual Java-shipped script, translated close action, topmost modal, hidden/disabled controls, legacy web, Escape containment)",
);
