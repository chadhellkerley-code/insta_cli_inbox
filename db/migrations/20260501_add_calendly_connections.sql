create table if not exists public.calendly_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  calendly_user_uri text not null,
  organization_uri text not null,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint calendly_connections_owner_unique unique (owner_id)
);

create table if not exists public.calendly_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  default_event_type_uri text,
  default_event_type_name text,
  enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists calendly_connections_owner_idx
  on public.calendly_connections (owner_id);

drop trigger if exists set_calendly_connections_updated_at on public.calendly_connections;
create trigger set_calendly_connections_updated_at
before update on public.calendly_connections
for each row
execute function public.set_instagram_updated_at();

drop trigger if exists set_calendly_settings_updated_at on public.calendly_settings;
create trigger set_calendly_settings_updated_at
before update on public.calendly_settings
for each row
execute function public.set_instagram_updated_at();

alter table public.calendly_connections enable row level security;
alter table public.calendly_settings enable row level security;

drop policy if exists "calendly_connections_select_own" on public.calendly_connections;
create policy "calendly_connections_select_own"
on public.calendly_connections
for select
using (auth.uid() = owner_id);

drop policy if exists "calendly_connections_insert_own" on public.calendly_connections;
create policy "calendly_connections_insert_own"
on public.calendly_connections
for insert
with check (auth.uid() = owner_id);

drop policy if exists "calendly_connections_update_own" on public.calendly_connections;
create policy "calendly_connections_update_own"
on public.calendly_connections
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "calendly_connections_delete_own" on public.calendly_connections;
create policy "calendly_connections_delete_own"
on public.calendly_connections
for delete
using (auth.uid() = owner_id);

drop policy if exists "calendly_settings_select_own" on public.calendly_settings;
create policy "calendly_settings_select_own"
on public.calendly_settings
for select
using (auth.uid() = owner_id);

drop policy if exists "calendly_settings_insert_own" on public.calendly_settings;
create policy "calendly_settings_insert_own"
on public.calendly_settings
for insert
with check (auth.uid() = owner_id);

drop policy if exists "calendly_settings_update_own" on public.calendly_settings;
create policy "calendly_settings_update_own"
on public.calendly_settings
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "calendly_settings_delete_own" on public.calendly_settings;
create policy "calendly_settings_delete_own"
on public.calendly_settings
for delete
using (auth.uid() = owner_id);

notify pgrst, 'reload schema';
