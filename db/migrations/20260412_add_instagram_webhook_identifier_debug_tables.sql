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

create index if not exists instagram_account_identifiers_account_idx
  on public.instagram_account_identifiers (account_id);

create index if not exists instagram_account_identifiers_type_idx
  on public.instagram_account_identifiers (identifier_type, created_at desc);

drop trigger if exists set_instagram_account_identifiers_updated_at
on public.instagram_account_identifiers;
create trigger set_instagram_account_identifiers_updated_at
before update on public.instagram_account_identifiers
for each row
execute function public.set_instagram_updated_at();

alter table public.instagram_account_identifiers enable row level security;

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

create index if not exists instagram_webhook_events_debug_reason_idx
  on public.instagram_webhook_events_debug (reason, created_at desc);

alter table public.instagram_webhook_events_debug enable row level security;
