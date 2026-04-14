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
  page_id text,
  instagram_user_id text,
  instagram_account_id text not null unique,
  instagram_app_user_id text,
  username text not null,
  name text,
  account_type text,
  profile_picture_url text,
  access_token text not null,
  token_obtained_at timestamptz,
  expires_in integer,
  expires_at timestamptz,
  token_expires_at timestamptz,
  token_lifecycle text,
  last_token_refresh_at timestamptz,
  scopes text[] not null default '{}'::text[],
  status text not null default 'oauth_connected',
  webhook_subscribed_at timestamptz,
  webhook_status text default 'pending',
  messaging_status text default 'pending',
  last_webhook_check_at timestamptz,
  webhook_subscription_error text,
  connected_at timestamptz not null default timezone('utc'::text, now()),
  last_oauth_at timestamptz,
  last_webhook_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table public.instagram_accounts
  add column if not exists page_id text;

alter table public.instagram_accounts
  add column if not exists instagram_user_id text;

alter table public.instagram_accounts
  add column if not exists token_obtained_at timestamptz;

alter table public.instagram_accounts
  add column if not exists expires_in integer;

alter table public.instagram_accounts
  add column if not exists expires_at timestamptz;

alter table public.instagram_accounts
  add column if not exists token_lifecycle text;

alter table public.instagram_accounts
  add column if not exists last_token_refresh_at timestamptz;

alter table public.instagram_accounts
  add column if not exists last_oauth_at timestamptz;

alter table public.instagram_accounts
  add column if not exists webhook_subscribed_at timestamptz;

alter table public.instagram_accounts
  add column if not exists webhook_status text;

alter table public.instagram_accounts
  add column if not exists messaging_status text;

alter table public.instagram_accounts
  add column if not exists last_webhook_check_at timestamptz;

alter table public.instagram_accounts
  add column if not exists webhook_subscription_error text;

alter table public.instagram_accounts
  alter column status set default 'oauth_connected';

alter table public.instagram_accounts
  alter column webhook_status set default 'pending';

alter table public.instagram_accounts
  alter column messaging_status set default 'pending';

update public.instagram_accounts
set
  instagram_user_id = coalesce(instagram_user_id, instagram_account_id),
  token_obtained_at = coalesce(token_obtained_at, last_oauth_at, connected_at, created_at),
  expires_at = coalesce(expires_at, token_expires_at)
where
  instagram_user_id is null
  or token_obtained_at is null
  or expires_at is null;

update public.instagram_accounts
set
  webhook_status = coalesce(webhook_status, case when last_webhook_at is not null then 'ready' else 'pending' end),
  messaging_status = coalesce(messaging_status, case when last_webhook_at is not null then 'ready' else 'pending' end),
  webhook_subscribed_at = coalesce(webhook_subscribed_at, last_webhook_at),
  last_webhook_check_at = coalesce(last_webhook_check_at, last_webhook_at),
  status = case
    when status = 'connected' and last_webhook_at is not null then 'messaging_ready'
    when status = 'connected' then 'oauth_connected'
    else status
  end
where
  webhook_status is null
  or messaging_status is null
  or webhook_subscribed_at is null
  or last_webhook_check_at is null
  or status = 'connected';

create table if not exists public.instagram_account_identifiers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  identifier text not null unique,
  identifier_type text not null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint instagram_account_identifiers_account_identifier_unique
    unique (account_id, identifier)
);

insert into public.instagram_account_identifiers (account_id, identifier, identifier_type)
select id, instagram_user_id, 'instagram_user_id'
from public.instagram_accounts
where instagram_user_id is not null
on conflict (identifier) do nothing;

insert into public.instagram_account_identifiers (account_id, identifier, identifier_type)
select id, instagram_account_id, 'instagram_account_id'
from public.instagram_accounts
where instagram_account_id is not null
on conflict (identifier) do nothing;

insert into public.instagram_account_identifiers (account_id, identifier, identifier_type)
select id, instagram_app_user_id, 'instagram_app_user_id'
from public.instagram_accounts
where instagram_app_user_id is not null
on conflict (identifier) do nothing;

create table if not exists public.instagram_webhook_events_debug (
  id uuid primary key default gen_random_uuid(),
  matched_account_id uuid references public.instagram_accounts(id) on delete set null,
  reason text not null,
  body_object text,
  entry_id text,
  sender_id text,
  recipient_id text,
  message_mid text,
  payload jsonb not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

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

create index if not exists instagram_account_identifiers_account_idx
  on public.instagram_account_identifiers (account_id);

create index if not exists instagram_account_identifiers_type_idx
  on public.instagram_account_identifiers (identifier_type, created_at desc);

create index if not exists instagram_conversations_owner_last_message_idx
  on public.instagram_conversations (owner_id, last_message_at desc nulls last);

create index if not exists instagram_conversations_account_contact_idx
  on public.instagram_conversations (account_id, contact_igsid);

create index if not exists instagram_contacts_owner_contact_idx
  on public.instagram_contacts (owner_id, contact_igsid);

create index if not exists instagram_messages_conversation_created_idx
  on public.instagram_messages (conversation_id, created_at asc);

create index if not exists instagram_messages_owner_created_idx
  on public.instagram_messages (owner_id, created_at desc);

create index if not exists instagram_webhook_events_debug_reason_idx
  on public.instagram_webhook_events_debug (reason, created_at desc);

create index if not exists instagram_reminders_owner_status_idx
  on public.instagram_reminders (owner_id, status, remind_at asc);

create index if not exists instagram_reminders_conversation_idx
  on public.instagram_reminders (conversation_id, remind_at asc);

drop trigger if exists set_instagram_accounts_updated_at on public.instagram_accounts;
create trigger set_instagram_accounts_updated_at
before update on public.instagram_accounts
for each row
execute function public.set_instagram_updated_at();

drop trigger if exists set_instagram_account_identifiers_updated_at
on public.instagram_account_identifiers;
create trigger set_instagram_account_identifiers_updated_at
before update on public.instagram_account_identifiers
for each row
execute function public.set_instagram_updated_at();

drop trigger if exists set_instagram_conversations_updated_at on public.instagram_conversations;
create trigger set_instagram_conversations_updated_at
before update on public.instagram_conversations
for each row
execute function public.set_instagram_updated_at();

drop trigger if exists set_instagram_contacts_updated_at on public.instagram_contacts;
create trigger set_instagram_contacts_updated_at
before update on public.instagram_contacts
for each row
execute function public.set_instagram_updated_at();

drop trigger if exists set_instagram_reminders_updated_at on public.instagram_reminders;
create trigger set_instagram_reminders_updated_at
before update on public.instagram_reminders
for each row
execute function public.set_instagram_updated_at();

alter table public.instagram_accounts enable row level security;
alter table public.instagram_account_identifiers enable row level security;
alter table public.instagram_conversations enable row level security;
alter table public.instagram_contacts enable row level security;
alter table public.instagram_messages enable row level security;
alter table public.instagram_reminders enable row level security;
alter table public.instagram_webhook_events_debug enable row level security;

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
