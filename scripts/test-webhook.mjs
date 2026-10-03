// Signed local smoke test for /api/webhooks/dodo.
// Usage: node scripts/test-webhook.mjs <baseUrl> <whsecKey>
import { Webhook } from 'standardwebhooks';

const baseUrl = process.argv[2] || 'http://127.0.0.1:3111';
const secret = process.argv[3];
if (!secret) {
  console.error('missing webhook secret');
  process.exit(1);
}

const wh = new Webhook(secret);

const events = [
  {
    id: 'msg_payment_succeeded_1',
    payload: {
      type: 'payment.succeeded',
      data: {
        payload_type: 'Payment',
        payment_id: 'pay_test_1',
        status: 'succeeded',
        total_amount: 1900,
        currency: 'AUD',
        customer: { customer_id: 'cus_test_1', email: 'buyer@example.com' },
      },
    },
  },
  {
    id: 'msg_subscription_active_1',
    payload: {
      type: 'subscription.active',
      data: {
        subscription_id: 'sub_test_1',
        product_id: 'pdt_test_1',
        next_billing_date: '2026-11-02T00:00:00.000Z',
        metadata: { plan: 'creator' },
        customer: { customer_id: 'cus_test_1', email: 'buyer@example.com' },
      },
    },
  },
  {
    id: 'msg_subscription_renewed_1',
    payload: {
      type: 'subscription.renewed',
      data: {
        subscription_id: 'sub_test_1',
        next_billing_date: '2026-12-02T00:00:00.000Z',
        customer: { customer_id: 'cus_test_1', email: 'buyer@example.com' },
      },
    },
  },
  { id: 'msg_subscription_on_hold_1', payload: { type: 'subscription.on_hold', data: { subscription_id: 'sub_test_1', customer: { customer_id: 'cus_test_1', email: 'buyer@example.com' } } } },
  { id: 'msg_subscription_cancelled_1', payload: { type: 'subscription.cancelled', data: { subscription_id: 'sub_test_1', cancel_at_next_billing_date: true, next_billing_date: '2026-12-02T00:00:00.000Z', customer: { customer_id: 'cus_test_1', email: 'buyer@example.com' } } } },
  { id: 'msg_subscription_expired_1', payload: { type: 'subscription.expired', data: { subscription_id: 'sub_test_1', customer: { customer_id: 'cus_test_1', email: 'buyer@example.com' } } } },
  { id: 'msg_payment_failed_1', payload: { type: 'payment.failed', data: { payment_id: 'pay_test_2', status: 'failed', customer: { customer_id: 'cus_test_1', email: 'buyer@example.com' } } } },
  { id: 'msg_refund_succeeded_1', payload: { type: 'refund.succeeded', data: { payment_id: 'pay_test_1', customer: { customer_id: 'cus_test_1', email: 'buyer@example.com' } } } },
  { id: 'msg_dispute_opened_1', payload: { type: 'dispute.opened', data: { dispute_id: 'dsp_test_1', amount: 1900, customer: { customer_id: 'cus_test_1', email: 'buyer@example.com' } } } },
  { id: 'msg_dispute_lost_1', payload: { type: 'dispute.lost', data: { dispute_id: 'dsp_test_1', customer: { customer_id: 'cus_test_1', email: 'buyer@example.com' } } } },
  { id: 'msg_license_key_created_1', payload: { type: 'license_key.created', data: { license_key_id: 'lk_test_1', name: 'Challenge-Me Pro', customer: { customer_id: 'cus_test_1', email: 'buyer@example.com' } } } },
  { id: 'msg_unknown_1', payload: { type: 'some.future.event', data: { hello: 'world' } } },
];

async function post(id, payload, { bad = false, text } = {}) {
  const raw = text ?? JSON.stringify(payload);
  const ts = new Date();
  const sig = bad ? `v1,${'A'.repeat(43)}` : wh.sign(id, ts, raw);
  const res = await fetch(`${baseUrl}/api/webhooks/dodo`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(Math.floor(ts.getTime() / 1000)),
      'webhook-signature': sig,
    },
    body: raw,
  });
  const body = await res.text();
  console.log(`${res.status}  ${bad ? '[bad-sig] ' : ''}${id}  ->  ${body.slice(0, 120)}`);
  return res.status;
}

let failures = 0;
for (const e of events) {
  const status = await post(e.id, e.payload);
  if (status !== 200) failures++;
}

// idempotency: same webhook-id twice -> second must still be 200
await post(events[1].id, events[1].payload);

// unsigned / tampered payload must be rejected
const status = await post('msg_bad_1', {}, { bad: true });
if (status !== 401) failures++;

console.log(failures === 0 ? '\nALL WEBHOOK TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);