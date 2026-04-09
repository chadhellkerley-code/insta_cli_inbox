create table if not exists public.agent_presence (
  agent_id text primary key,
  machine_name text,
  status text default 'offline',
  last_seen_at timestamptz default now()
);

create table if not exists public.owner_agents (
  owner_id uuid not null,
  agent_id text not null,
  label text,
  created_at timestamptz not null default now(),
  primary key (owner_id, agent_id)
);

create table if not exists public.agent_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  agent_id text not null,
  type text not null,
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  claimed_by text,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

alter table public.accounts
  add column if not exists agent_id text;

alter table public.agent_jobs
  add column if not exists agent_id text;

create index if not exists agent_jobs_owner_status_idx
  on public.agent_jobs (owner_id, status, created_at);

create index if not exists agent_jobs_agent_status_idx
  on public.agent_jobs (agent_id, status, created_at);

create index if not exists owner_agents_owner_idx
  on public.owner_agents (owner_id, created_at desc);

create index if not exists owner_agents_agent_idx
  on public.owner_agents (agent_id);

create index if not exists agent_presence_seen_idx
  on public.agent_presence (last_seen_at desc);
