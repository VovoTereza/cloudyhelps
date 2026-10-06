create table if not exists public.gateway_credentials (
  provider text primary key,
  encrypted_config text not null,
  environment text not null default 'unconfigured',
  configured_fields jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

alter table public.gateway_credentials enable row level security;

revoke all on public.gateway_credentials from anon, authenticated;

comment on table public.gateway_credentials is
  'Server-only encrypted payment gateway credentials. Access is restricted to service_role.';
