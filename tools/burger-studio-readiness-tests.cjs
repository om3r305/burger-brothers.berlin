const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const originalLoad = Module._load;
const originalTs = require.extensions['.ts'];
let unauthorized = false;
let failSettings = false;
let transactions = 0;
let products = [];
let setting = { menu: { keep: true }, payments: { online: true } };
const db = {
  product: {
    findMany: async () => structuredClone(products),
    update: async ({ where, data }) => Object.assign(products.find(p => p.id === where.id), data),
    create: async ({ data }) => products.push({ id: 'scratch', ...data }),
  },
  setting: { upsert: async () => { if (failSettings) throw new Error('settings unavailable'); } },
  $executeRaw: async (strings, ...values) => {
    if (strings.join('').includes("'{menu}'")) {
      setting.menu = { ...setting.menu, burgerStudio: JSON.parse(values[0]) };
    }
    return 1;
  },
  $transaction: async (run) => {
    transactions++;
    const beforeProducts = structuredClone(products);
    const beforeSetting = structuredClone(setting);
    try { return await run(db); }
    catch (error) { products = beforeProducts; setting = beforeSetting; throw error; }
  },
};
require.extensions['.ts'] = (mod, filename) => mod._compile(ts.transpileModule(
  fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText, filename);
Module._load = function(request, parent, isMain) {
  if (request === 'next/server') return { NextResponse: { json: (body, options) => Response.json(body, options) } };
  if (request === '@prisma/client') return { Prisma: { Decimal: class { constructor(value) { this.value = value; } }, JsonNull: null } };
  if (request === '@/lib/db') return { prisma: db, getTenantId: async () => 'tenant' };
  if (request === '@/lib/server/request-security') return {
    requireMutationRole: async () => unauthorized ? Response.json({ error: 'unauthorized' }, { status: 401 }) : null,
  };
  if (request.startsWith('@/')) return originalLoad.call(this, path.join(process.cwd(), request.slice(2) + '.ts'), parent, isMain);
  return originalLoad.call(this, request, parent, isMain);
};
const { POST } = require('../app/api/admin/burger-studio/sync/route.ts');
const { createDefaultBurgerStudioV2Config } = require('../lib/burger-studio-v2.ts');
const { planBurgerStudioV2Order } = require('../lib/burger-studio-v2-order-plan.ts');
const { validateBurgerStudioCanonicalSelection } = require('../lib/server/burger-studio-order-guard.ts');
function request(body) {
  return new Request('https://burger-brothers.berlin/api/admin/burger-studio/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
async function main() {
  const config = createDefaultBurgerStudioV2Config();
  config.enabled = true;
  config.scratchEnabled = true;
  config.templates = [];
  config.scratchBasePrice = 3.5;
  unauthorized = true;
  assert.equal((await POST(request({ config }))).status, 401);
  assert.equal(transactions, 0, 'unauthorized callers must never mutate data');
  unauthorized = false;
  for (const body of [null, {}, { config: [] }, { config: {} }]) {
    assert.equal((await POST(request(body))).status, 400);
  }
  assert.equal(transactions, 0);
  assert.equal((await POST(request({ config: { ...config, maxIngredients: 1 } }))).status, 400);
  products = [{ id: 'scratch', sku: 'BSTUDIO-SCRATCH-BASE', price: 99, extrasJson: [] }];
  failSettings = true;
  const oldError = console.error;
  console.error = () => {};
  const failed = await POST(request({ config }));
  console.error = oldError;
  assert.equal(failed.status, 500);
  assert.equal(products[0].price, 99, 'failed settings save rolls back product pricing');
  assert.deepEqual(setting, { menu: { keep: true }, payments: { online: true } });
  failSettings = false;
  const saved = await POST(request({ config }));
  assert.equal(saved.status, 200);
  assert.equal(setting.menu.burgerStudio.enabled, true);
  assert.equal(setting.menu.keep, true);
  assert.equal(setting.payments.online, true);
  const scratch = products[0];
  const canonical = new Map(scratch.extrasJson.map(extra => [extra.id, extra]));
  const bun = config.ingredients.find(i => i.active && i.group === 'bun');
  const beef = config.ingredients.find(i => i.id === 'beef');
  for (const id of ['black-angus', 'chicken-breast', 'farmers-market']) {
    const ingredient = config.ingredients.find(i => i.id === id);
    const recipe = { version: 1, templateId: null, ingredients: {
      [bun.id]: 1, [id]: 1, ...(ingredient.group === 'topping' ? { [beef.id]: 1 } : {}),
    } };
    const plan = planBurgerStudioV2Order({ config, recipe });
    assert.equal(plan.total, 3.5 + ingredient.addPrice + (ingredient.group === 'topping' ? beef.addPrice : 0));
    const resolvedExtras = plan.add.map(extra => {
      const match = canonical.get(extra.id);
      assert(match, `${id} must resolve to a real canonical catalog extra`);
      assert.equal(match.price, extra.price);
      return match;
    });
    assert.deepEqual(validateBurgerStudioCanonicalSelection({ rawItem: {}, catalogSku: scratch.sku,
      resolvedExtras, settings: { menu: { burgerStudio: config } }, mode: 'pickup' }), { ok: true });
  }
  const invalidTemplate = { id: 'broken', productRef: 'BURGER', active: true, name: 'Broken', recipe: { [beef.id]: 1 } };
  assert.equal((await POST(request({ config: { ...config, templates: [invalidTemplate] } }))).status, 400);
  const missingTemplate = { ...invalidTemplate, recipe: { [bun.id]: 1, [beef.id]: 1 } };
  assert.equal((await POST(request({ config: { ...config, templates: [missingTemplate] } }))).status, 409);
  console.log('Burger Studio readiness: atomic rollback, auth, canonical premium recipes and template validation passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => {
  Module._load = originalLoad;
  if (originalTs) require.extensions['.ts'] = originalTs;
  else delete require.extensions['.ts'];
});
