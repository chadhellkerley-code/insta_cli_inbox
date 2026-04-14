create table if not exists public.instagram_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  contact_igsid text not null,
  contact_username text,
  contact_name text,
  profile_picture_url text,
  last_profile_fetch_at timestamptz,
  last_profile_fetch_error text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint instagram_contacts_owner_contact_unique
    unique (owner_id, contact_igsid)
);

create index if not exists instagram_contacts_owner_contact_idx
  on public.instagram_contacts (owner_id, contact_igsid);

drop trigger if exists set_instagram_contacts_updated_at on public.instagram_contacts;
create trigger set_instagram_contacts_updated_at
before update on public.instagram_contacts
for each row
execute function public.set_instagram_updated_at();

alter table public.instagram_contacts enable row level security;

drop policy if exists "instagram_contacts_select_own" on public.instagram_contacts;
create policy "instagram_contacts_select_own"
on public.instagram_contacts
for select
using (auth.uid() = owner_id);

drop policy if exists "instagram_contacts_insert_own" on public.instagram_contacts;
create policy "instagram_contacts_insert_own"
on public.instagram_contacts
for insert
with check (auth.uid() = owner_id);

drop policy if exists "instagram_contacts_update_own" on public.instagram_contacts;
create policy "instagram_contacts_update_own"
on public.instagram_contacts
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "instagram_contacts_delete_own" on public.instagram_contacts;
create policy "instagram_contacts_delete_own"
on public.instagram_contacts
for delete
using (auth.uid() = owner_id);
