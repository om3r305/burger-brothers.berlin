const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
function load(file, deps = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, Buffer, process, Date, Set, console, fetch: deps.fetch,
    require: name => { if (!(name in deps)) throw Error(`Unexpected dependency ${name}`); return deps[name]; } });
  return exports;
}
process.env.PAYMENT_FINALIZE_SECRET = 'local-security-test-secret-never-used-in-production';
const signature = load('lib/server/payment-signature.ts', { crypto });
const { refundOutcome } = load('lib/server/refund-outcome.ts');
function fixture(change = () => {}, checkoutFlow = false) {
  const metadata = { burger_payment_session: 'PAY-test', burger_order_id: 'FINAL', share_index: '0' };
  const intent = { id: 'pi_test', currency: 'eur', amount: 1200, amount_received: 1200,
    status: 'succeeded', livemode: false, metadata };
  const checkout = { id: 'cs_test', currency: 'eur', amount_total: 1200, livemode: false,
    status: 'complete', payment_status: 'paid', metadata: { ...metadata }, payment_intent: intent };
  let pending = { id: 'PAY-test', status: 'payment_pending', meta: {
    pendingOrder: { total: 12, items: [{ id: 'burger', qty: 1, price: 12 }] },
    paymentSession: { finalOrderId: 'FINAL', kind: 'online', stripeMode: 'test',
      orderTotal: 12, serviceFeeTotal: 0, collectedTotal: 12,
      shares: [{ index: 0, amount: 12, ...(checkoutFlow ? { checkoutSessionId: checkout.id } : { paymentIntentId: intent.id }) }] },
  } };
  const calls = { create: 0, refund: 0 };
  const stripe = { paymentIntents: { retrieve: async () => intent },
    checkout: { sessions: { retrieve: async () => checkout } },
    refunds: { create: async () => { calls.refund++; return { id: 're_test', status: 'succeeded', amount: 1200 }; } } };
  change({ intent, checkout, pending, stripe });
  const deps = {
    '@/lib/db': { getTenantId: async () => 'tenant', prisma: { order: {
      findFirst: async ({ where }) => where.id === 'PAY-test' ? pending : null,
      update: async ({ data }) => { pending = { ...pending, ...data }; return pending; },
    } } },
    '@/lib/server/public-order': { readOrderTrackingToken: () => '' },
    '@/lib/server/stripe-client': { getStripeClient: () => stripe, resolveBaseUrl: () => 'https://test.invalid' },
    '@/lib/server/payment-signature': signature,
    '@/lib/server/refund-outcome': { refundOutcome },
    fetch: async (_url, init) => {
      calls.create++;
      const order = JSON.parse(init.body).order;
      assert(signature.verifyPaymentFinalizeSignature('PAY-test', 'FINAL', init.headers['x-bb-payment-finalize'], order));
      return { ok: true, json: async () => ({ ok: true, order }) };
    },
  };
  return { ...load('lib/server/payment-finalize.ts', deps), calls };
}
(async () => {
  const order = { id: 'FINAL', total: 12, items: [{ id: 'burger', qty: 1, price: 12 }],
    customer: { name: 'Test' }, meta: { payment: { status: 'paid', shares: ['pi_test'] } } };
  const signed = signature.signPaymentFinalize('PAY-test', 'FINAL', order);
  assert(signature.verifyPaymentFinalizeSignature('PAY-test', 'FINAL', signed, JSON.parse(JSON.stringify(order))));
  assert(signature.verifyPaymentFinalizeSignature('PAY-test', 'FINAL', signed, { meta: order.meta, customer: order.customer, items: order.items, total: 12, id: 'FINAL' }));
  for (const alter of [o => o.total = 0, o => o.items[0].qty = 100, o => o.items[0].price = 0,
    o => o.customer.name = 'Changed', o => o.meta.payment.shares.push('pi_other'), o => o.id = 'OTHER']) {
    const changed = structuredClone(order); alter(changed);
    assert.equal(signature.verifyPaymentFinalizeSignature('PAY-test', 'FINAL', signed, changed), false);
  }
  for (let i = 0; i < 1000; i++) {
    assert.equal(signature.verifyPaymentFinalizeSignature('PAY-test', 'FINAL', crypto.randomBytes(32).toString('hex'), order), false);
  }
  const negative = [
    ['processing', ({ intent }) => intent.status = 'processing'],
    ['3DS required', ({ intent }) => intent.status = 'requires_action'],
    ['unpaid', ({ intent }) => intent.status = 'requires_payment_method'],
    ['amount altered', ({ intent }) => intent.amount = 1],
    ['not fully collected', ({ intent }) => intent.amount_received = 1],
    ['wrong currency', ({ intent }) => intent.currency = 'usd'],
    ['another order', ({ intent }) => intent.metadata.burger_order_id = 'OTHER'],
    ['another share', ({ intent }) => intent.metadata.share_index = '1'],
    ['another Stripe mode', ({ intent }) => intent.livemode = true],
    ['another provider ID', ({ intent }) => intent.id = 'pi_other'],
    ['incomplete split', ({ pending }) => pending.meta.paymentSession.shares.push({ index: 1, amount: 6 })],
    ['duplicate payment', ({ pending }) => pending.meta.paymentSession.shares.push({ ...pending.meta.paymentSession.shares[0] })],
    ['underpayment total', ({ pending }) => pending.meta.pendingOrder.total = 24],
    ['fee mismatch', ({ pending }) => pending.meta.paymentSession.serviceFeeTotal = 2],
    ['provider unavailable', ({ stripe }) => stripe.paymentIntents.retrieve = async () => { throw Error('network'); }],
  ];
  for (const [name, change] of negative) {
    const f = fixture(change); const result = await f.finalizePaymentSession('PAY-test');
    assert.equal(result.finalized, false, name); assert.equal(f.calls.create, 0, name);
  }
  for (const [name, change] of [
    ['checkout unpaid', ({ checkout }) => checkout.payment_status = 'unpaid'],
    ['checkout forged paid with pending intent', ({ intent }) => intent.status = 'processing'],
    ['checkout intent underpaid', ({ intent }) => intent.amount_received = 1],
    ['checkout another mode', ({ checkout }) => checkout.livemode = true],
    ['checkout another ID', ({ checkout }) => checkout.id = 'cs_other'],
  ]) {
    const f = fixture(change, true); const result = await f.finalizePaymentSession('PAY-test');
    assert.equal(result.finalized, false, name); assert.equal(f.calls.create, 0, name);
  }
  for (const flow of [false, true]) {
    const f = fixture(undefined, flow);
    assert.equal((await f.finalizePaymentSession('PAY-test')).finalized, true);
    assert.equal(f.calls.create, 1); assert.equal(f.calls.refund, 0);
  }
  // Two distinct paid shares must complete a split including its service fee.
  const split = fixture(({ pending, stripe, intent }) => {
    const second = { ...intent, id: 'pi_second', amount: 700, amount_received: 700,
      metadata: { ...intent.metadata, share_index: '1' } };
    intent.amount = intent.amount_received = 600;
    pending.meta.paymentSession.serviceFeeTotal = 1;
    pending.meta.paymentSession.collectedTotal = 13;
    pending.meta.paymentSession.shares = [{ index: 0, amount: 6, paymentIntentId: intent.id }, { index: 1, amount: 7, paymentIntentId: second.id }];
    stripe.paymentIntents.retrieve = async id => id === intent.id ? intent : second;
  });
  assert.equal((await split.finalizePaymentSession('PAY-test')).finalized, true);
  assert.equal(split.calls.create, 1);
  console.log('Payment integrity: PASS (20 blocked provider/split cases, valid direct/checkout/split flows, payload tampering, 1000 forged signatures)');
})().catch(error => { console.error(error); process.exitCode = 1; });
