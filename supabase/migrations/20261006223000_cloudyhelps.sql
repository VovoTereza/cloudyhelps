create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.campaign_content (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint campaign_content_main_only check (id = 'main')
);

alter table public.app_admins enable row level security;
alter table public.campaign_content enable row level security;

create or replace function public.is_campaign_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.app_admins
    where user_id = auth.uid()
  );
$$;

revoke all on function public.is_campaign_admin() from public;
grant execute on function public.is_campaign_admin() to authenticated;

drop policy if exists "Campaign content is publicly readable" on public.campaign_content;
create policy "Campaign content is publicly readable"
on public.campaign_content
for select
to anon, authenticated
using (id = 'main');

drop policy if exists "Admins can update campaign content" on public.campaign_content;
create policy "Admins can update campaign content"
on public.campaign_content
for update
to authenticated
using (public.is_campaign_admin())
with check (public.is_campaign_admin() and id = 'main');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'campaign-media',
  'campaign-media',
  true,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Campaign media is publicly readable" on storage.objects;
create policy "Campaign media is publicly readable"
on storage.objects
for select
to public
using (bucket_id = 'campaign-media');

drop policy if exists "Admins can upload campaign media" on storage.objects;
create policy "Admins can upload campaign media"
on storage.objects
for insert
to authenticated
with check (bucket_id = 'campaign-media' and public.is_campaign_admin());

drop policy if exists "Admins can update campaign media" on storage.objects;
create policy "Admins can update campaign media"
on storage.objects
for update
to authenticated
using (bucket_id = 'campaign-media' and public.is_campaign_admin())
with check (bucket_id = 'campaign-media' and public.is_campaign_admin());

drop policy if exists "Admins can delete campaign media" on storage.objects;
create policy "Admins can delete campaign media"
on storage.objects
for delete
to authenticated
using (bucket_id = 'campaign-media' and public.is_campaign_admin());
