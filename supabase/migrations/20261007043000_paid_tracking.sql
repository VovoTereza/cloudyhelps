alter table public.payment_leads
  add column if not exists tracking_context jsonb not null default '{}'::jsonb;

create table if not exists public.tracking_dispatches (
  external_id text not null,
  platform text not null,
  destination_id text not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (external_id, platform, destination_id),
  constraint tracking_dispatches_platform_check check (platform in ('meta', 'google', 'tiktok')),
  constraint tracking_dispatches_status_check check (status in ('pending', 'sent', 'failed'))
);

alter table public.tracking_dispatches enable row level security;
revoke all on public.tracking_dispatches from anon, authenticated;

comment on table public.tracking_dispatches is 'Server-only delivery log for paid conversion events.';
