const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { Prisma } = require('@prisma/client');
function load(file, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Date, Intl, URL, Request, Response, console, process,
    require: (name) => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name) }, { filename: file });
  return module.exports;
}
const helpers = load('lib/reporting.ts');
const { reportRange, berlinDateKey, isCustomerAnalyticsPath, summarizePaymentRows } = helpers;
const plain = (x) => JSON.parse(JSON.stringify(x));
assert.equal(berlinDateKey(new Date('2026-10-12T22:30:00Z')), '2026-10-13');
for (const [date, hours] of [['2026-03-29', 23], ['2026-10-25', 25], ['2026-10-12', 24]]) {
  const r = reportRange('day', date); assert.equal((r.to - r.from) / 3600000, hours);
}
const week = reportRange('week', '2026-10-12');
assert.equal(week.startDate, '2026-10-12'); assert.equal(week.endDate, '2026-10-19');
assert.equal(reportRange('week', '2026-10-11').startDate, '2026-10-05');
assert.equal(reportRange('year', '2024-02-29').endDate, '2025-01-01');
assert.throws(() => reportRange('day', '2026-02-30'));
assert.throws(() => reportRange('other', '2026-10-12'));
for (const p of ['/admin', '/tv/orders', '/driver', '/showcase/window', '/dashboard', '/print/kitchen', '/api/orders']) assert.equal(isCustomerAnalyticsPath(p), false);
for (const p of ['/', '/menu', '/schnellbestellung', '/checkout']) assert.equal(isCustomerAnalyticsPath(p), true);
const fixture = [
  { type: 'charge', amount: 2300, fee: 97, net: 2203 },
  { type: 'refund', amount: -500, fee: -10, net: -490 },
  { type: 'stripe_fee', amount: -20, fee: 0, net: -20 },
  { type: 'adjustment', amount: -50, fee: 0, net: -50 },
  { type: 'payout', amount: -1000, fee: 0, net: -1000 },
  { type: 'payout_failure', amount: 1000, fee: 0, net: 1000 },
];
const totals = summarizePaymentRows(fixture);
assert.deepEqual(plain(totals), { payments: 1, gross: 2300, refunds: 500, fees: 107, other: -50, net: 1643, payouts: 0 });
assert.equal(totals.net, totals.gross - totals.refunds - totals.fees + totals.other);

(async () => {
  let auth = null, calls = 0, captured;
  const dependencies = {
    '@/lib/reporting': helpers,
    '@/lib/server/request-security': { requireSessionRole: async () => auth },
    '@/lib/server/stripe-client': { stripeModeLabel: () => 'test', getStripeClient: () => ({ balanceTransactions: {
      list: async (params) => { calls++; captured = params; return { has_more: true, data: [{
        id: 'txn_demo', created: 1791800000, type: 'charge', amount: 2300, fee: 97, net: 2203,
        status: 'pending', source: { object: 'charge', id: 'ch_demo', billing_details: { email: 'private@example.com' },
          payment_method_details: { type: 'card', card: { wallet: { type: 'apple_pay' } } } },
      }] }; },
    } }) },
  };
  const api = load('app/api/admin/reports/payments/route.ts', dependencies);
  auth = new Response(null, { status: 401 });
  assert.equal((await api.GET(new Request('https://example.com/api/admin/reports/payments'))).status, 401);
  assert.equal(calls, 0);
  auth = null;
  assert.equal((await api.GET(new Request('https://example.com/api/admin/reports/payments?date=invalid'))).status, 400);
  assert.equal((await api.GET(new Request('https://example.com/api/admin/reports/payments?cursor=invalid'))).status, 400);
  const response = await api.GET(new Request('https://example.com/api/admin/reports/payments?period=week&date=2026-10-12&cursor=txn_previous'));
  const data = await response.json();
  assert.equal(data.mode, 'test'); assert.equal(data.nextCursor, 'txn_demo');
  assert.equal(data.rows[0].method, 'apple_pay'); assert.equal(data.rows[0].fee, 97);
  assert.equal(JSON.stringify(data).includes('private@example.com'), false);
  assert.equal(captured.starting_after, 'txn_previous'); assert.equal(captured.currency, 'eur');
  assert.equal(captured.created.gte, Math.floor(week.from.getTime() / 1000));
  assert.equal(captured.created.lt, Math.floor(week.to.getTime() / 1000));
  assert.equal(response.headers.get('Cache-Control'), 'no-store');

  const queries = [];
  const db = { getTenantId: async () => 'tenant-test', prisma: {
    $queryRaw: async (query) => { queries.push(query); return [{ tenantId: 'tenant-test', day: {
      date: '2026-10-12', views: 4, sessions: 2, webViews: 3, appViews: 1, unknownViews: 0, unidentifiedViews: 0, paths: [],
    } }]; },
    setting: { findMany: async () => [
      { value: { date: '2026-10-11', views: 3 } },
      { value: { date: '2026-10-12', views: 100 } },
      { value: { date: '2025-10-10', views: 999 } },
    ] },
  } };
  const visitor = load('lib/server/analytics-report.ts', { '@/lib/db': db, '@/lib/reporting': helpers });
  const days = await visitor.visitorReport('tenant-test', helpers.berlinMidnight('2026-10-11'), helpers.berlinMidnight('2026-10-13'));
  assert.deepEqual(plain(days.map((d) => d.views)), [3, 4]);
  const overview = load('app/api/admin/reports/overview/route.ts', {
    '@/lib/db': db, '@/lib/reporting': helpers, '@/lib/server/analytics-report': { visitorReport: async () => days },
    '@/lib/server/request-security': { requireSessionRole: async () => null },
  });
  await overview.GET(new Request('https://example.com/api/admin/reports/overview?period=year&date=2026-10-12'));
  assert.equal(queries[1].text.includes('LIMIT'), false);
  assert.equal(queries[1].text.includes('paymentSession'), true);
  assert.equal(queries[1].values.includes('tenant-test'), true);
  const previousSessionSecret = process.env.SESSION_SECRET;
  const previousAnalyticsSecret = process.env.ANALYTICS_IP_SECRET;
  process.env.SESSION_SECRET = 'test-session-secret-32-characters-only';
  delete process.env.ANALYTICS_IP_SECRET;
  let savedEvent;
  const collector = load('app/api/analytics/collect/route.ts', {
    '@/lib/db': { getTenantId: async () => 'tenant-test', prisma: { analyticsEvent: {
      create: async ({ data }) => { savedEvent = data; },
    } } },
    '@/lib/reporting': helpers,
    '@/lib/server/request-security': { hasTrustedMutationOrigin: () => true, enforceRateLimit: async () => null },
  });
  const collect = (path) => collector.POST(new Request('https://example.com/api/analytics/collect', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path, event: 'page_view', sessionId: 'browser-session-demo', consentVersion: 'analytics-v1', props: { source: 'app' } }),
  }));
  assert.equal((await collect('/menu')).status, 200);
  assert.equal(savedEvent.sessionHash.length, 32);
  assert.equal(JSON.stringify(savedEvent).includes('browser-session-demo'), false);
  assert.equal(savedEvent.props.source, 'app');
  savedEvent = null;
  assert.equal((await (await collect('/driver')).json()).saved, 0);
  assert.equal(savedEvent, null);
  if (previousSessionSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previousSessionSecret;
  if (previousAnalyticsSecret === undefined) delete process.env.ANALYTICS_IP_SECRET; else process.env.ANALYTICS_IP_SECRET = previousAnalyticsSecret;
  if (process.env.BB_REPORT_SQL_OUTPUT) fs.writeFileSync(process.env.BB_REPORT_SQL_OUTPUT,
    JSON.stringify(queries.map((q) => ({ text: q.text, values: q.values })), null, 2));
  console.log('Admin reports: Berlin DST, periods, totals, refunds, fees, payout reversals, auth, privacy, paging and daily snapshot merge passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
