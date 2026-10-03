// /lib/entitlements.js
// Durable-ish entitlement + webhook idempotency store for Dodo Payments events.
//
// Persistence is Supabase PostgREST when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
// are set (see supabase/schema.sql). Without them the store degrades to an
// in-memory map so the webhook still verifies, deduplicates within one runtime
// instance and logs every grant instead of throwing.
//
// Every function is failure tolerant on purpose: the webhook must always answer
// 200 so Dodo stops marking deliveries as failed.

const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export function isDurable() {
  return Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);
}

// globalThis keeps the fallback store alive across dev HMR reloads.
const mem = (globalThis.__challengeMeStore ??= {
  events: new Map(),
  entitlements: new Map(),
  disputes: new Map(),
  licenseKeys: new Map(),
});

async function rest(path, { method = 'POST', body, query, prefer } = {}) {
  const url = new URL(`${SUPABASE_URL}/rest/v1/${path}`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    method,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });

  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`supabase ${method} ${path} ${res.status}: ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

// Supabase/PostgREST returns 23505 for a unique violation: duplicate delivery.
function isUniqueViolation(e) {
  return e?.status === 409 || /23505|duplicate key/i.test(e?.body || e?.message || '');
}

/**
 * Idempotency claim keyed on the webhook event id (`webhook-id` header).
 * Returns { claimed: true } the first time, { claimed: false } on every
 * redelivery of the same event.
 */
export async function claimWebhookEvent(webhookId, eventType) {
  if (!webhookId) return { claimed: true, durable: isDurable(), reason: 'no-event-id' };

  if (isDurable()) {
    try {
      await rest('webhook_events', {
        method: 'POST',
        body: { webhook_id: webhookId, event_type: eventType },
        prefer: 'return=minimal',
      });
      return { claimed: true, durable: true };
    } catch (e) {
      if (isUniqueViolation(e)) return { claimed: false, durable: true, reason: 'duplicate' };
      console.error('[entitlements] claim failed, treating as claimed', e);
      return { claimed: true, durable: false, reason: 'claim-error' };
    }
  }

  if (mem.events.has(webhookId)) return { claimed: false, durable: false, reason: 'duplicate' };
  mem.events.set(webhookId, eventType);
  return { claimed: true, durable: false };
}

/** Release a claim so a failed delivery can be retried by Dodo. */
export async function releaseWebhookEvent(webhookId) {
  if (!webhookId) return;
  try {
    if (isDurable()) {
      await rest('webhook_events', {
        method: 'DELETE',
        query: { webhook_id: `eq.${webhookId}` },
        prefer: 'return=minimal',
      });
    } else {
      mem.events.delete(webhookId);
    }
  } catch (e) {
    console.error('[entitlements] release failed', e);
  }
}

function mergeEntitlement(prev, patch) {
  return {
    ...(prev || {}),
    ...patch,
    updated_at: new Date().toISOString(),
  };
}

async function upsertEntitlement(row) {
  const key = row.customer_id || row.email;
  if (!key) {
    console.warn('[entitlements] skipping upsert without customer_id/email', row);
    return false;
  }

  const current = isDurable()
    ? await readEntitlement(key)
    : mem.entitlements.get(key) || null;
  const next = mergeEntitlement(current, row);

  try {
    if (isDurable()) {
      await rest('entitlements', {
        method: 'POST',
        body: next,
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
    } else {
      mem.entitlements.set(key, next);
    }
    console.log('[entitlements]', JSON.stringify(next));
    return true;
  } catch (e) {
    console.error('[entitlements] upsert failed', e);
    return false;
  }
}

async function readEntitlement(key) {
  const column = key.includes('@') ? 'email' : 'customer_id';
  try {
    const rows = await rest('entitlements', {
      method: 'GET',
      query: { [column]: `eq.${key}`, select: '*', limit: '1' },
    });
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch (e) {
    console.error('[entitlements] read failed', e);
    return null;
  }
}

const base = (data) => ({
  customer_id: data.customer?.customer_id || data.customer_id || null,
  email: data.customer?.email || data.email || null,
});

/** payment.succeeded for a non-subscription checkout -> lifetime access. */
export function grantOneTime(data) {
  return upsertEntitlement({
    ...base(data),
    payment_id: data.payment_id || null,
    access: 'lifetime',
    status: 'active',
    plan: 'one_time',
    amount: data.total_amount ?? null,
    currency: data.currency || null,
    access_until: null,
  });
}

/** subscription.active -> the authoritative grant for recurring products. */
export function grantSubscription(data, tier) {
  return upsertEntitlement({
    ...base(data),
    subscription_id: data.subscription_id || null,
    product_id: data.product_id || null,
    access: 'subscription',
    status: 'active',
    plan: tier,
    current_period_end: data.current_period_end || data.next_billing_date || null,
    access_until: data.current_period_end || data.next_billing_date || null,
    prompt_card_update: false,
  });
}

/** subscription.renewed -> push the paid-through date forward. */
export function extendSubscription(data) {
  const tier = tierFrom(data);
  return upsertEntitlement({
    ...base(data),
    ...(tier ? { plan: tier } : {}),
    subscription_id: data.subscription_id || null,
    access: 'subscription',
    status: 'active',
    current_period_end: data.current_period_end || data.next_billing_date || null,
    access_until: data.current_period_end || data.next_billing_date || null,
    prompt_card_update: false,
  });
}

/** subscription.cancelled -> keep access until the already-paid period ends. */
export function revokeAtPeriodEnd(data) {
  const periodEnd = data.current_period_end || data.next_billing_date || null;
  return upsertEntitlement({
    ...base(data),
    subscription_id: data.subscription_id || null,
    access: 'subscription',
    status: 'cancelled',
    cancel_at_period_end: true,
    prompt_card_update: false,
    access_until: periodEnd,
  });
}

/** subscription.expired / refund.succeeded / dispute.lost -> revoke now. */
export function revokeNow(data, reason) {
  return upsertEntitlement({
    ...base(data),
    subscription_id: data.subscription_id || null,
    status: 'revoked',
    cancel_at_period_end: false,
    access: 'none',
    access_until: null,
    revoked_reason: reason,
  });
}

/** subscription.on_hold -> restrict and tell the customer to update the card. */
export function restrict(data, reason) {
  return upsertEntitlement({
    ...base(data),
    subscription_id: data.subscription_id || null,
    status: 'on_hold',
    access: 'restricted',
    prompt_card_update: true,
    revoked_reason: reason,
  });
}

/** subscription.failed is terminal: never grant, never retry-grant. */
export function terminalFailure(data, reason) {
  return upsertEntitlement({
    ...base(data),
    subscription_id: data.subscription_id || null,
    status: 'failed',
    access: 'none',
    access_until: null,
    terminal: true,
    revoked_reason: reason,
  });
}

export async function recordDispute(data, status) {
  const row = {
    dispute_id: data.dispute_id || data.id || null,
    customer_id: base(data).customer_id,
    status,
    amount: data.amount ?? null,
    reason: data.reason || null,
    updated_at: new Date().toISOString(),
  };
  try {
    if (isDurable()) {
      await rest('disputes', {
        method: 'POST',
        body: row,
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
    } else {
      mem.disputes.set(row.dispute_id || row.customer_id, row);
    }
    console.log('[entitlements] dispute', JSON.stringify(row));
  } catch (e) {
    console.error('[entitlements] dispute write failed', e);
  }
}

export async function recordLicenseKey(data) {
  const row = {
    license_key_id: data.license_key_id || data.id || null,
    name: data.name || null,
    customer_id: base(data).customer_id,
    email: base(data).email,
    key_preview: data.key ? `${String(data.key).slice(0, 6)}...` : null,
    expires_at: data.expires_at || null,
    updated_at: new Date().toISOString(),
  };
  try {
    if (isDurable()) {
      await rest('license_keys', {
        method: 'POST',
        body: row,
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
    } else {
      mem.licenseKeys.set(row.license_key_id || row.email, row);
    }
    console.log('[entitlements] license_key', JSON.stringify(row));
  } catch (e) {
    console.error('[entitlements] license_key write failed', e);
  }
}

/** Plan/tier resolution: metadata first, then product-id -> env mapping. */
export function tierFrom(data) {
  const meta = data.metadata || {};
  const fromMeta = meta.plan || meta.tier || meta.product;
  if (fromMeta) return String(fromMeta);

  const productId = data.product_id || null;
  if (productId && productId === process.env.DODO_PRODUCT_LIFETIME) return 'lifetime';
  if (productId && productId === process.env.DODO_PRODUCT_CREATOR) return 'creator';
  if (productId && productId === process.env.DODO_PRODUCT_AGENCY) return 'agency';
  return null;
}