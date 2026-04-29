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
