// tools/scan-dynamic-routes.mjs
import fs from "fs";
import path from "path";

const root = "app";
const dynRx = /\[(.+?)\]/g;

const map = new Map(); // parentPath => Set(paramNames)
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const p = path.join(dir, ent.name);
    const m = [...ent.name.matchAll(dynRx)].map(x => x[1]);
    const parent = path.dirname(p);
    if (m.length) {
      const key = parent.replaceAll("\\", "/");
      const set = map.get(key) ?? new Set();
      m.forEach(s => set.add(s));
      map.set(key, set);
    }
    walk(p);
  }
}
walk(root);

let conflict = false;
for (const [parent, set] of map.entries()) {
  if (set.size > 1) {
    conflict = true;
    console.log("⚠️ Conflict in:", parent);
    console.log("   Params at same level:", [...set].join(", "));
  }
}
if (!conflict) console.log("✅ No dynamic param name conflicts found.");
