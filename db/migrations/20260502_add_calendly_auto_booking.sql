alter table public.automation_agent_stages
  add column if not exists auto_schedule_mode text not null default 'link';

alter table public.automation_agent_stages
  drop constraint if exists automation_agent_stages_auto_schedule_mode_check;

alter table public.automation_agent_stages
  add constraint automation_agent_stages_auto_schedule_mode_check
  check (auto_schedule_mode in ('link', 'auto_booking'));

alter table public.automation_jobs
  drop constraint if exists automation_jobs_job_type_check;

alter table public.automation_jobs
  add constraint automation_jobs_job_type_check
  check (job_type in ('stage_message', 'followup', 'ai_reply', 'calendly_schedule', 'calendly_booking'));

create index if not exists automation_jobs_calendly_booking_idx
  on public.automation_jobs (owner_id, status, scheduled_for asc)
  where job_type = 'calendly_booking';

create table if not exists public.conversation_booking_intents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  conversation_id uuid not null references public.instagram_conversations(id) on delete cascade,
  run_id uuid references public.automation_runs(id) on delete set null,
  agent_id uuid references public.automation_agents(id) on delete set null,
  stage_id uuid references public.automation_agent_stages(id) on delete set null,
  job_id uuid references public.automation_jobs(id) on delete set null,
  event_type_uri text,
  wants_booking boolean,
  confirmed_time boolean not null default false,
  proposed_start_time_local text,
  timezone text,
  invitee_name text,
  invitee_email text,
  alternatives jsonb not null default '[]'::jsonb,
  status text not null default 'collecting'
    check (status in (
      'collecting',
      'awaiting_email',
      'awaiting_time',
      'awaiting_timezone',
      'awaiting_confirmation',
      'offered_alternatives',
      'booked',
      'fallback_link',
      'failed'
    )),
  last_error text,
  raw_extraction jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint conversation_booking_intents_conversation_unique unique (owner_id, conversation_id)
);

create index if not exists conversation_booking_intents_open_idx
  on public.conversation_booking_intents (owner_id, conversation_id, status, updated_at desc);

drop trigger if exists set_conversation_booking_intents_updated_at on public.conversation_booking_intents;
create trigger set_conversation_booking_intents_updated_at
before update on public.conversation_booking_intents
for each row
execute function public.set_instagram_updated_at();

alter table public.conversation_booking_intents enable row level security;

drop policy if exists "conversation_booking_intents_select_own" on public.conversation_booking_intents;
create policy "conversation_booking_intents_select_own"
on public.conversation_booking_intents
for select
using (auth.uid() = owner_id);

drop policy if exists "conversation_booking_intents_insert_own" on public.conversation_booking_intents;
create policy "conversation_booking_intents_insert_own"
on public.conversation_booking_intents
for insert
with check (auth.uid() = owner_id);

drop policy if exists "conversation_booking_intents_update_own" on public.conversation_booking_intents;
create policy "conversation_booking_intents_update_own"
on public.conversation_booking_intents
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "conversation_booking_intents_delete_own" on public.conversation_booking_intents;
create policy "conversation_booking_intents_delete_own"
on public.conversation_booking_intents
for delete
using (auth.uid() = owner_id);

create table if not exists public.calendly_bookings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  conversation_id uuid not null references public.instagram_conversations(id) on delete cascade,
  run_id uuid references public.automation_runs(id) on delete set null,
  job_id uuid references public.automation_jobs(id) on delete set null,
  event_type_uri text not null,
  event_uri text,
  invitee_uri text,
  invitee_name text,
  invitee_email text,
  timezone text,
  start_time timestamptz not null,
  cancel_url text,
  reschedule_url text,
  status text not null default 'created',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists calendly_bookings_conversation_idx
  on public.calendly_bookings (owner_id, conversation_id, created_at desc);

create index if not exists calendly_bookings_job_idx
  on public.calendly_bookings (job_id);

drop trigger if exists set_calendly_bookings_updated_at on public.calendly_bookings;
create trigger set_calendly_bookings_updated_at
before update on public.calendly_bookings
for each row
execute function public.set_instagram_updated_at();

alter table public.calendly_bookings enable row level security;

drop policy if exists "calendly_bookings_select_own" on public.calendly_bookings;
create policy "calendly_bookings_select_own"
on public.calendly_bookings
for select
using (auth.uid() = owner_id);

drop policy if exists "calendly_bookings_insert_own" on public.calendly_bookings;
create policy "calendly_bookings_insert_own"
on public.calendly_bookings
for insert
with check (auth.uid() = owner_id);

drop policy if exists "calendly_bookings_update_own" on public.calendly_bookings;
create policy "calendly_bookings_update_own"
on public.calendly_bookings
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "calendly_bookings_delete_own" on public.calendly_bookings;
create policy "calendly_bookings_delete_own"
on public.calendly_bookings
for delete
using (auth.uid() = owner_id);

notify pgrst, 'reload schema';
