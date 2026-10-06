const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
    return dependencies[name];
  }, Date, Set, console, fetch: dependencies.fetch });
  return exports;
}
const { refundOutcome } = load('lib/server/refund-outcome.ts');
function fixture({ cancelled = false, refundStatus = 'succeeded', refundThrows = false, state = '', expiry = false } = {}) {
  const calls = { create: 0, refund: 0, retrieve: 0, updates: 0 };
  const intent = { id: 'pi_paid', currency: 'eur', amount: 1200, amount_received: 1200, livemode: false, status: 'succeeded',
    metadata: { burger_payment_session: 'PAY-test', burger_order_id: 'FINAL', share_index: '0' } };
  let pending = { id: 'PAY-test', status: cancelled ? 'payment_cancelled' : 'payment_pending',
    meta: { pendingOrder: { total: 12 }, paymentSession: { finalOrderId: 'FINAL', kind: 'online',
      state, paidCount: 1, autoRefunds: [{ refundId: 're_existing', status: 'pending' }],
      ...(cancelled ? { cancelledAt: '2026-01-01T00:00:00Z' } : {}),
      shares: [{ index: 0, amount: 12, paymentIntentId: intent.id },
        ...(expiry ? [{ index: 1, amount: 5, shareExpiresAt: '2020-01-01T00:00:00Z' }] : [])] } } };
  const stripe = { paymentIntents: { retrieve: async () => intent }, refunds: {
    create: async () => { calls.refund++; if (refundThrows) throw new Error('provider unavailable');
      return { id: 're_new', amount: 1200, status: refundStatus }; },
    retrieve: async () => { calls.retrieve++; return { id: 're_existing', status: refundStatus }; },
  } };
  const deps = {
    '@/lib/db': { getTenantId: async () => 'tenant', prisma: { order: {
      findFirst: async ({ where }) => where.id === 'PAY-test' ? pending : null,
      update: async ({ data }) => { calls.updates++; pending = { ...pending, ...data }; return pending; },
    } } },
    '@/lib/server/public-order': { readOrderTrackingToken: () => '' },
    '@/lib/server/stripe-client': { getStripeClient: () => stripe, resolveBaseUrl: () => 'https://test.invalid' },
    '@/lib/server/payment-signature': { signPaymentFinalize: () => 'mock-signature' },
    '@/lib/server/refund-outcome': { refundOutcome },
    fetch: async () => { calls.create++; return { ok: false, status: 503, json: async () => ({ ok: false }) }; },
  };
  return { ...load('lib/server/payment-finalize.ts', deps), calls, pending: () => pending, intent };
}
(async () => {
  for (const [status, expected] of [['succeeded', 'refunded'], ['pending', 'refund_pending'],
    ['failed', 'failed'], ['canceled', 'failed'], ['requires_action', 'failed']]) {
    const f = fixture({ refundStatus: status });
    const result = await f.finalizePaymentSession('PAY-test');
    assert.equal(result.status, expected, `order failure with refund ${status}`);
    assert.equal(result.finalized, false);
    await f.finalizePaymentSession('PAY-test');
    assert.equal(f.calls.create, 1, 'a refunded/failed-refund payment must never recreate the order');
    assert.equal(f.calls.refund, 1, 'rechecking a refund must not create another refund');
  }
  for (const cancelled of [true, false]) {
    const f = fixture({ cancelled, refundThrows: true });
    const result = await f.finalizePaymentSession('PAY-test');
    assert.equal(result.status, 'failed');
    assert.equal(result.error, 'AUTO_REFUND_FAILED');
    assert.equal(f.pending().meta.paymentSession.state, 'refund_failed');
    assert(!result.message.includes('wurde zurückerstattet'));
  }
  const expired = fixture({ expiry: true, refundThrows: true });
  assert.equal((await expired.finalizePaymentSession('PAY-test')).status, 'failed');
  const late = fixture({ state: 'refunded' });
  await late.recordPaymentIntentEvent(late.intent);
  assert.equal(late.calls.updates, 0, 'late Stripe events must not reopen a refunded payment');
  assert.equal((await late.finalizePaymentSession('PAY-test')).status, 'refunded');
  assert.equal(late.calls.create, 0);
  const pending = fixture({ state: 'refund_pending', refundStatus: 'succeeded' });
  assert.equal((await pending.finalizePaymentSession('PAY-test')).status, 'refunded');
  assert.equal(pending.calls.retrieve, 1, 'pending refund should reconcile against Stripe');
  assert.equal(pending.calls.create, 0);
  assert.equal(refundOutcome([]).status, 'failed', 'missing refund results must not imply success');
  const { checkoutAttemptFingerprint } = load('lib/checkout/attempt.ts');
  const order = { mode: 'pickup', items: [{ id: 'burger', qty: 1 }], total: 12,
    customer: { name: 'Test', phone: '01234567890' }, meta: { payment: { method: 'cash' } } };
  const key = checkoutAttemptFingerprint(order);
  assert.equal(key, checkoutAttemptFingerprint({ ...order, ts: 123, meta: { ...order.meta, deliveryGeo: { validatedAt: 999 } } }));
  assert.notEqual(key, checkoutAttemptFingerprint({ ...order, total: 13 }));
  assert.notEqual(key, checkoutAttemptFingerprint({ ...order, items: [{ id: 'burger', qty: 2 }] }));
  console.log('Checkout payment failure behavior: PASS (refund status, provider failure, repeat finalization, late events, reconciliation, retry identity)');
})().catch(error => { console.error(error); process.exitCode = 1; });
