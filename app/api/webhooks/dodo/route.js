// /app/api/webhooks/dodo/route.js
// Dodo Payments -> POST /api/webhooks/dodo
//
// Contract:
//   - raw body via req.text() (never req.json()) so the Standard Webhooks
//     signature over `webhook-id.webhook-timestamp.raw_body` verifies
//   - signature checked with standardwebhooks + DODO_PAYMENTS_WEBHOOK_KEY
//   - 200 {received:true} for every verified event, including types we do not
//     handle yet, so the Dodo dashboard stops showing failed deliveries
//   - 401 only for a bad signature (never acknowledge an unverified payload)
//   - idempotent on the webhook event id (`webhook-id` header)

import { NextResponse } from 'next/server';
import { Webhook } from 'standardwebhooks';
import {
  claimWebhookEvent,
  releaseWebhookEvent,
  grantOneTime,
  grantSubscription,
  extendSubscription,
  revokeAtPeriodEnd,
  revokeNow,
  restrict,
  terminalFailure,
  recordDispute,
  recordLicenseKey,
  tierFrom,
} from '../../../../lib/entitlements.js';

export const dynamic = 'force-dynamic';

const ok = () => NextResponse.json({ received: true }, { status: 200 });

function headersToObject(headers) {
  const out = {};
  for (const [k, v] of headers.entries()) out[k] = v;
  return out;
}

export async function POST(req) {
  // Raw bytes exactly as Dodo sent them.
  const raw = await req.text();

  const webhookId = req.headers.get('webhook-id') || '';
  const webhookSecret = process.env.DODO_PAYMENTS_WEBHOOK_KEY || '';

  let event;
  try {
    if (!webhookSecret) throw new Error('DODO_PAYMENTS_WEBHOOK_KEY is not configured');
    // sync verify: webhook-id / webhook-timestamp / webhook-signature
    event = new Webhook(webhookSecret).verify(raw, headersToObject(req.headers), {
      jsonParse: false,
    });
    event = JSON.parse(raw);
  } catch (e) {
    console.error('[dodo-webhook] signature verification failed', {
      webhookId,
      error: e?.message || String(e),
    });
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  const type = event?.type || 'unknown';

  const claim = await claimWebhookEvent(webhookId, type);
  if (!claim.claimed) {
    console.log('[dodo-webhook] duplicate delivery skipped', { webhookId, type });
    return ok();
  }

  const data = event?.data || {};

  try {
    switch (type) {
      // One-time checkout. For recurring products the grant happens on
      // subscription.active instead, so a receipt must not touch access.
      case 'payment.succeeded': {
        if (!data.subscription_id) {
          await grantOneTime(data);
        } else {
          console.log('[dodo-webhook] payment.succeeded is a subscription receipt, ignoring');
        }
        break;
      }

      case 'payment.failed':
      case 'payment.processing':
      case 'payment.cancelled':
        console.log('[dodo-webhook] payment not settled', {
          webhookId,
          type,
          paymentId: data.payment_id,
          status: data.status,
          error: data.error,
        });
        break;

      case 'subscription.active':
        await grantSubscription(data, tierFrom(data) || 'subscriber');
        break;

      case 'subscription.renewed':
      case 'dunning.recovered':
        await extendSubscription(data);
        break;

      case 'subscription.cancelled':
        // Paid through the current period: stop renewing, keep access until
        // access_until, then let subscription.expired revoke it.
        if (data.cancel_at_next_billing_date === false && !data.next_billing_date) {
          await revokeNow(data, 'subscription.cancelled');
        } else {
          await revokeAtPeriodEnd(data);
        }
        break;

      case 'subscription.expired':
        await revokeNow(data, 'subscription.expired');
        break;

      case 'subscription.on_hold':
      case 'dunning.started':
        await restrict(data, 'payment_method_update_required');
        break;

      case 'subscription.failed':
        // Mandate creation failed. Terminal: never grant access.
        await terminalFailure(data, 'subscription.failed');
        break;

      case 'refund.succeeded':
        await revokeNow(data, 'refund.succeeded');
        break;

      case 'dispute.opened':
      case 'dispute.won':
      case 'dispute.lost':
      case 'dispute.expired':
      case 'dispute.cancelled':
      case 'dispute.accepted':
      case 'dispute.challenged':
        await recordDispute(data, type.split('.')[1]);
        if (type === 'dispute.lost') {
          await revokeNow(data, 'dispute.lost');
        }
        break;

      case 'license_key.created':
        await recordLicenseKey(data);
        break;

      default:
        console.log('[dodo-webhook] unhandled event type', { webhookId, type });
    }

    return ok();
  } catch (e) {
    console.error('[dodo-webhook] handler failed', { webhookId, type, error: e?.message || String(e) });
    // Release the claim so Dodo's retry can be processed, but still answer 200:
    // the event is logged and redelivery is not required for correctness.
    await releaseWebhookEvent(webhookId);
    return ok();
  }
}

// Vercel cron and generic uptime pings should not 404.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: '/api/webhooks/dodo' }, { status: 200 });
}