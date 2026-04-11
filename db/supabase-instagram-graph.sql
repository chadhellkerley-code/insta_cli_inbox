create extension if not exists pgcrypto;

create or replace function public.set_instagram_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

create table if not exists public.instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  instagram_account_id text not null unique,
  instagram_app_user_id text,
  username text not null,
  name text,
  account_type text,
  profile_picture_url text,
  access_token text not null,
  token_expires_at timestamptz,
  token_lifecycle text,
  last_token_refresh_at timestamptz,
  scopes text[] not null default '{}'::text[],
  status text not null default 'connected',
  connected_at timestamptz not null default timezone('utc'::text, now()),
  last_oauth_at timestamptz,
  webhook_subscribed_at timestamptz,
  webhook_subscription_error text,
  last_webhook_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.instagram_accounts
  add column if not exists token_lifecycle text;

alter table public.instagram_accounts
  add column if not exists last_token_refresh_at timestamptz;

alter table public.instagram_accounts
  add column if not exists last_oauth_at timestamptz;

alter table public.instagram_accounts
  add column if not exists webhook_subscribed_at timestamptz;

alter table public.instagram_accounts
  add column if not exists webhook_subscription_error text;

create table if not exists public.instagram_conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  contact_igsid text not null,
  contact_username text,
  contact_name text,
  labels text[] not null default '{}'::text[],
  notes text,
  last_message_text text,
  last_message_type text,
  last_message_at timestamptz,
  unread_count integer not null default 0,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint instagram_conversations_account_contact_unique
    unique (account_id, contact_igsid)
);

create table if not exists public.instagram_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  conversation_id uuid not null references public.instagram_conversations(id) on delete cascade,
  meta_message_id text unique,
  direction text not null,
  message_type text not null,
  text_content text,
  media_url text,
  mime_type text,
  sender_igsid text,
  recipient_igsid text,
  raw_payload jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.instagram_reminders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid not null references public.instagram_conversations(id) on delete cascade,
  title text not null,
  note text,
  remind_at timestamptz not null,
  status text not null default 'pending',
  dismissed_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists instagram_accounts_owner_idx
  on public.instagram_accounts (owner_id, connected_at desc);

create index if not exists instagram_accounts_webhook_idx
  on public.instagram_accounts (last_webhook_at desc nulls last);

create index if not exists instagram_conversations_owner_last_message_idx
  on public.instagram_conversations (owner_id, last_message_at desc nulls last);

create index if not exists instagram_conversations_account_contact_idx
  on public.instagram_conversations (account_id, contact_igsid);

create index if not exists instagram_messages_conversation_created_idx
  on public.instagram_messages (conversation_id, created_at asc);

create index if not exists instagram_messages_owner_created_idx
  on public.instagram_messages (owner_id, created_at desc);

create index if not exists instagram_reminders_owner_status_idx
  on public.instagram_reminders (owner_id, status, remind_at asc);

create index if not exists instagram_reminders_conversation_idx
  on public.instagram_reminders (conversation_id, remind_at asc);

drop trigger if exists set_instagram_accounts_updated_at on public.instagram_accounts;
create trigger set_instagram_accounts_updated_at
before update on public.instagram_accounts
for each row
execute function public.set_instagram_updated_at();

drop trigger if exists set_instagram_conversations_updated_at on public.instagram_conversations;
create trigger set_instagram_conversations_updated_at
before update on public.instagram_conversations
for each row
execute function public.set_instagram_updated_at();

drop trigger if exists set_instagram_reminders_updated_at on public.instagram_reminders;
create trigger set_instagram_reminders_updated_at
before update on public.instagram_reminders
for each row
execute function public.set_instagram_updated_at();

alter table public.instagram_accounts enable row level security;
alter table public.instagram_conversations enable row level security;
alter table public.instagram_messages enable row level security;
alter table public.instagram_reminders enable row level security;

drop policy if exists "instagram_accounts_select_own" on public.instagram_accounts;
create policy "instagram_accounts_select_own"
on public.instagram_accounts
for select
using (auth.uid() = owner_id);

drop policy if exists "instagram_accounts_insert_own" on public.instagram_accounts;
create policy "instagram_accounts_insert_own"
on public.instagram_accounts
for insert
with check (auth.uid() = owner_id);

drop policy if exists "instagram_accounts_update_own" on public.instagram_accounts;
create policy "instagram_accounts_update_own"
on public.instagram_accounts
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "instagram_accounts_delete_own" on public.instagram_accounts;
create policy "instagram_accounts_delete_own"
on public.instagram_accounts
for delete
using (auth.uid() = owner_id);

drop policy if exists "instagram_conversations_select_own" on public.instagram_conversations;
create policy "instagram_conversations_select_own"
on public.instagram_conversations
for select
using (auth.uid() = owner_id);

drop policy if exists "instagram_conversations_insert_own" on public.instagram_conversations;
create policy "instagram_conversations_insert_own"
on public.instagram_conversations
for insert
with check (auth.uid() = owner_id);

drop policy if exists "instagram_conversations_update_own" on public.instagram_conversations;
create policy "instagram_conversations_update_own"
on public.instagram_conversations
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "instagram_conversations_delete_own" on public.instagram_conversations;
create policy "instagram_conversations_delete_own"
on public.instagram_conversations
for delete
using (auth.uid() = owner_id);

drop policy if exists "instagram_messages_select_own" on public.instagram_messages;
create policy "instagram_messages_select_own"
on public.instagram_messages
for select
using (auth.uid() = owner_id);

drop policy if exists "instagram_messages_insert_own" on public.instagram_messages;
create policy "instagram_messages_insert_own"
on public.instagram_messages
for insert
with check (auth.uid() = owner_id);

drop policy if exists "instagram_messages_update_own" on public.instagram_messages;
create policy "instagram_messages_update_own"
on public.instagram_messages
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "instagram_messages_delete_own" on public.instagram_messages;
create policy "instagram_messages_delete_own"
on public.instagram_messages
for delete
using (auth.uid() = owner_id);

drop policy if exists "instagram_reminders_select_own" on public.instagram_reminders;
create policy "instagram_reminders_select_own"
on public.instagram_reminders
for select
using (auth.uid() = owner_id);

drop policy if exists "instagram_reminders_insert_own" on public.instagram_reminders;
create policy "instagram_reminders_insert_own"
on public.instagram_reminders
for insert
with check (auth.uid() = owner_id);

drop policy if exists "instagram_reminders_update_own" on public.instagram_reminders;
create policy "instagram_reminders_update_own"
on public.instagram_reminders
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "instagram_reminders_delete_own" on public.instagram_reminders;
create policy "instagram_reminders_delete_own"
on public.instagram_reminders
for delete
using (auth.uid() = owner_id);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'instagram_accounts'
  ) then
    alter publication supabase_realtime add table public.instagram_accounts;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'instagram_conversations'
  ) then
    alter publication supabase_realtime add table public.instagram_conversations;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'instagram_messages'
  ) then
    alter publication supabase_realtime add table public.instagram_messages;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'instagram_reminders'
  ) then
    alter publication supabase_realtime add table public.instagram_reminders;
  end if;
end
$$;
