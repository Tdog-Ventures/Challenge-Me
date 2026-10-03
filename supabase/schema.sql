-- Challenge-Me webhook + entitlement store
-- Apply in the Supabase SQL editor. Safe to re-run.

create table if not exists webhook_events (
  webhook_id   text primary key,
  event_type   text not null,
  received_at  timestamptz not null default now()
);

create table if not exists entitlements (
  customer_id          text primary key,
  email                text,
  payment_id           text,
  subscription_id      text,
  product_id           text,
  plan                 text,
  access               text not null default 'none',
  status               text not null default 'inactive',
  terminal             boolean not null default false,
  cancel_at_period_end boolean not null default false,
  prompt_card_update   boolean not null default false,
  access_until         timestamptz,
  current_period_end   timestamptz,
  revoked_reason       text,
  amount               bigint,
  currency             text,
  updated_at           timestamptz not null default now()
);

create index if not exists entitlements_email_idx on entitlements (email);

create table if not exists disputes (
  dispute_id  text primary key,
  customer_id text,
  status      text,
  amount      bigint,
  reason      text,
  updated_at  timestamptz not null default now()
);

create table if not exists license_keys (
  license_key_id text primary key,
  name           text,
  customer_id    text,
  email          text,
  key_preview    text,
  expires_at     timestamptz,
  updated_at     timestamptz not null default now()
);