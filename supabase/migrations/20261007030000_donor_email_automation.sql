create table if not exists public.payment_leads (
  request_id uuid primary key,
  email text not null,
  donor_name text not null,
  amount bigint not null,
  currency text not null default 'USD',
  marketing_consent boolean not null default false,
  payment_intent_id text,
  created_at timestamptz not null default now()
);

create index if not exists payment_leads_match_idx
  on public.payment_leads (email, amount, currency, created_at desc);

create table if not exists public.donor_email_sequences (
  external_id text primary key,
  donor_email text not null,
  donor_name text not null,
  gross_amount bigint not null,
  currency text not null,
  marketing_consent boolean not null default false,
  unsubscribe_token uuid not null default gen_random_uuid() unique,
  thank_you_email_id text,
  scheduled_email_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unsubscribed_at timestamptz
);

alter table public.payment_leads enable row level security;
alter table public.donor_email_sequences enable row level security;

revoke all on public.payment_leads from anon, authenticated;
revoke all on public.donor_email_sequences from anon, authenticated;

comment on table public.payment_leads is 'Server-only checkout leads used to correlate paid webhooks and marketing consent.';
comment on table public.donor_email_sequences is 'Server-only Resend delivery state and unsubscribe controls.';
