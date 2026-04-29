create table if not exists public.automation_ai_credentials (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('openai', 'groq')),
  model text not null,
  api_key_ciphertext text not null,
  api_key_iv text not null,
  api_key_auth_tag text not null,
  api_key_last4 text not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint automation_ai_credentials_owner_unique unique (owner_id)
);

alter table public.automation_ai_credentials
  add column if not exists id uuid default gen_random_uuid(),
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists provider text,
  add column if not exists model text,
  add column if not exists api_key_ciphertext text,
  add column if not exists api_key_iv text,
  add column if not exists api_key_auth_tag text,
  add column if not exists api_key_last4 text,
  add column if not exists created_at timestamptz not null default timezone('utc'::text, now()),
  add column if not exists updated_at timestamptz not null default timezone('utc'::text, now());

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'automation_ai_credentials'
      and column_name = 'encrypted_api_key'
  ) then
    update public.automation_ai_credentials
    set api_key_ciphertext = coalesce(api_key_ciphertext, encrypted_api_key)
    where api_key_ciphertext is null;

    alter table public.automation_ai_credentials
      drop column encrypted_api_key;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'automation_ai_credentials_provider_check'
      and conrelid = 'public.automation_ai_credentials'::regclass
  ) then
    alter table public.automation_ai_credentials
      add constraint automation_ai_credentials_provider_check
      check (provider in ('openai', 'groq'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'automation_ai_credentials_owner_unique'
      and conrelid = 'public.automation_ai_credentials'::regclass
  ) then
    alter table public.automation_ai_credentials
      add constraint automation_ai_credentials_owner_unique unique (owner_id);
  end if;
end $$;

create index if not exists automation_ai_credentials_owner_idx
  on public.automation_ai_credentials (owner_id);

drop trigger if exists set_automation_ai_credentials_updated_at on public.automation_ai_credentials;
create trigger set_automation_ai_credentials_updated_at
before update on public.automation_ai_credentials
for each row
execute function public.set_instagram_updated_at();

alter table public.automation_ai_credentials enable row level security;

drop policy if exists "automation_ai_credentials_select_own" on public.automation_ai_credentials;
create policy "automation_ai_credentials_select_own"
on public.automation_ai_credentials
for select
using (auth.uid() = owner_id);

drop policy if exists "automation_ai_credentials_insert_own" on public.automation_ai_credentials;
create policy "automation_ai_credentials_insert_own"
on public.automation_ai_credentials
for insert
with check (auth.uid() = owner_id);

drop policy if exists "automation_ai_credentials_update_own" on public.automation_ai_credentials;
create policy "automation_ai_credentials_update_own"
on public.automation_ai_credentials
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "automation_ai_credentials_delete_own" on public.automation_ai_credentials;
create policy "automation_ai_credentials_delete_own"
on public.automation_ai_credentials
for delete
using (auth.uid() = owner_id);

notify pgrst, 'reload schema';
