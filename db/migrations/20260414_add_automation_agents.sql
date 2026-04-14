create table if not exists public.automation_agents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  personality text,
  min_reply_delay_seconds integer not null default 30 check (min_reply_delay_seconds >= 0),
  max_reply_delay_seconds integer not null default 90 check (max_reply_delay_seconds >= min_reply_delay_seconds),
  max_media_per_chat integer not null default 1 check (max_media_per_chat >= 0),
  is_active boolean not null default false,
  ai_enabled boolean not null default false,
  ai_prompt text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.automation_agent_stages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null references public.automation_agents(id) on delete cascade,
  stage_order integer not null check (stage_order >= 1),
  name text not null,
  followup_enabled boolean not null default false,
  followup_delay_minutes integer not null default 0 check (followup_delay_minutes >= 0),
  followup_message text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint automation_agent_stages_agent_stage_order_unique unique (agent_id, stage_order)
);

create table if not exists public.automation_stage_messages (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  stage_id uuid not null references public.automation_agent_stages(id) on delete cascade,
  message_order integer not null check (message_order >= 1),
  message_type text not null check (message_type in ('text', 'audio')),
  text_content text,
  media_url text,
  delay_seconds integer not null default 0 check (delay_seconds >= 0),
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint automation_stage_messages_stage_message_order_unique unique (stage_id, message_order),
  constraint automation_stage_messages_content_check check (
    (message_type = 'text' and nullif(btrim(coalesce(text_content, '')), '') is not null)
    or
    (message_type = 'audio' and nullif(btrim(coalesce(media_url, '')), '') is not null)
  )
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null references public.automation_agents(id) on delete cascade,
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  conversation_id uuid not null references public.instagram_conversations(id) on delete cascade,
  last_completed_stage_order integer not null default 0 check (last_completed_stage_order >= 0),
  active_stage_order integer check (active_stage_order is null or active_stage_order >= 1),
  last_inbound_at timestamptz,
  last_stage_scheduled_at timestamptz,
  last_stage_completed_at timestamptz,
  status text not null default 'active',
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint automation_runs_agent_conversation_unique unique (agent_id, conversation_id)
);

create table if not exists public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  agent_id uuid not null references public.automation_agents(id) on delete cascade,
  account_id uuid not null references public.instagram_accounts(id) on delete cascade,
  conversation_id uuid not null references public.instagram_conversations(id) on delete cascade,
  run_id uuid not null references public.automation_runs(id) on delete cascade,
  stage_id uuid not null references public.automation_agent_stages(id) on delete cascade,
  stage_message_id uuid references public.automation_stage_messages(id) on delete set null,
  job_type text not null check (job_type in ('stage_message', 'followup')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'skipped', 'failed', 'cancelled')),
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create unique index if not exists automation_agents_owner_active_unique
  on public.automation_agents (owner_id)
  where is_active;

create index if not exists automation_agents_owner_created_idx
  on public.automation_agents (owner_id, created_at desc);

create index if not exists automation_agent_stages_agent_order_idx
  on public.automation_agent_stages (agent_id, stage_order asc);

create index if not exists automation_stage_messages_stage_order_idx
  on public.automation_stage_messages (stage_id, message_order asc);

create index if not exists automation_runs_owner_conversation_idx
  on public.automation_runs (owner_id, conversation_id);

create index if not exists automation_jobs_pending_idx
  on public.automation_jobs (status, scheduled_for asc);

create index if not exists automation_jobs_run_stage_idx
  on public.automation_jobs (run_id, stage_id, status);

drop trigger if exists set_automation_agents_updated_at on public.automation_agents;
create trigger set_automation_agents_updated_at
before update on public.automation_agents
for each row
execute function public.set_instagram_updated_at();

drop trigger if exists set_automation_agent_stages_updated_at on public.automation_agent_stages;
create trigger set_automation_agent_stages_updated_at
before update on public.automation_agent_stages
for each row
execute function public.set_instagram_updated_at();

drop trigger if exists set_automation_stage_messages_updated_at on public.automation_stage_messages;
create trigger set_automation_stage_messages_updated_at
before update on public.automation_stage_messages
for each row
execute function public.set_instagram_updated_at();

drop trigger if exists set_automation_runs_updated_at on public.automation_runs;
create trigger set_automation_runs_updated_at
before update on public.automation_runs
for each row
execute function public.set_instagram_updated_at();

drop trigger if exists set_automation_jobs_updated_at on public.automation_jobs;
create trigger set_automation_jobs_updated_at
before update on public.automation_jobs
for each row
execute function public.set_instagram_updated_at();

alter table public.automation_agents enable row level security;
alter table public.automation_agent_stages enable row level security;
alter table public.automation_stage_messages enable row level security;
alter table public.automation_runs enable row level security;
alter table public.automation_jobs enable row level security;

drop policy if exists "automation_agents_select_own" on public.automation_agents;
create policy "automation_agents_select_own"
on public.automation_agents
for select
using (auth.uid() = owner_id);

drop policy if exists "automation_agents_insert_own" on public.automation_agents;
create policy "automation_agents_insert_own"
on public.automation_agents
for insert
with check (auth.uid() = owner_id);

drop policy if exists "automation_agents_update_own" on public.automation_agents;
create policy "automation_agents_update_own"
on public.automation_agents
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "automation_agents_delete_own" on public.automation_agents;
create policy "automation_agents_delete_own"
on public.automation_agents
for delete
using (auth.uid() = owner_id);

drop policy if exists "automation_agent_stages_select_own" on public.automation_agent_stages;
create policy "automation_agent_stages_select_own"
on public.automation_agent_stages
for select
using (auth.uid() = owner_id);

drop policy if exists "automation_agent_stages_insert_own" on public.automation_agent_stages;
create policy "automation_agent_stages_insert_own"
on public.automation_agent_stages
for insert
with check (auth.uid() = owner_id);

drop policy if exists "automation_agent_stages_update_own" on public.automation_agent_stages;
create policy "automation_agent_stages_update_own"
on public.automation_agent_stages
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "automation_agent_stages_delete_own" on public.automation_agent_stages;
create policy "automation_agent_stages_delete_own"
on public.automation_agent_stages
for delete
using (auth.uid() = owner_id);

drop policy if exists "automation_stage_messages_select_own" on public.automation_stage_messages;
create policy "automation_stage_messages_select_own"
on public.automation_stage_messages
for select
using (auth.uid() = owner_id);

drop policy if exists "automation_stage_messages_insert_own" on public.automation_stage_messages;
create policy "automation_stage_messages_insert_own"
on public.automation_stage_messages
for insert
with check (auth.uid() = owner_id);

drop policy if exists "automation_stage_messages_update_own" on public.automation_stage_messages;
create policy "automation_stage_messages_update_own"
on public.automation_stage_messages
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "automation_stage_messages_delete_own" on public.automation_stage_messages;
create policy "automation_stage_messages_delete_own"
on public.automation_stage_messages
for delete
using (auth.uid() = owner_id);

drop policy if exists "automation_runs_select_own" on public.automation_runs;
create policy "automation_runs_select_own"
on public.automation_runs
for select
using (auth.uid() = owner_id);

drop policy if exists "automation_runs_insert_own" on public.automation_runs;
create policy "automation_runs_insert_own"
on public.automation_runs
for insert
with check (auth.uid() = owner_id);

drop policy if exists "automation_runs_update_own" on public.automation_runs;
create policy "automation_runs_update_own"
on public.automation_runs
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "automation_runs_delete_own" on public.automation_runs;
create policy "automation_runs_delete_own"
on public.automation_runs
for delete
using (auth.uid() = owner_id);

drop policy if exists "automation_jobs_select_own" on public.automation_jobs;
create policy "automation_jobs_select_own"
on public.automation_jobs
for select
using (auth.uid() = owner_id);

drop policy if exists "automation_jobs_insert_own" on public.automation_jobs;
create policy "automation_jobs_insert_own"
on public.automation_jobs
for insert
with check (auth.uid() = owner_id);

drop policy if exists "automation_jobs_update_own" on public.automation_jobs;
create policy "automation_jobs_update_own"
on public.automation_jobs
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "automation_jobs_delete_own" on public.automation_jobs;
create policy "automation_jobs_delete_own"
on public.automation_jobs
for delete
using (auth.uid() = owner_id);
