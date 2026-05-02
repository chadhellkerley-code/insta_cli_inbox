create table if not exists public.automation_inbound_stage_claims (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  run_id uuid not null references public.automation_runs(id) on delete cascade,
  agent_id uuid not null references public.automation_agents(id) on delete cascade,
  conversation_id uuid not null references public.instagram_conversations(id) on delete cascade,
  inbound_message_id text not null,
  stage_order integer not null check (stage_order >= 1),
  created_at timestamptz not null default timezone('utc'::text, now()),
  constraint automation_inbound_stage_claims_unique unique (run_id, inbound_message_id)
);

create index if not exists automation_inbound_stage_claims_run_stage_idx
on public.automation_inbound_stage_claims (run_id, stage_order);

create index if not exists automation_inbound_stage_claims_owner_created_idx
on public.automation_inbound_stage_claims (owner_id, created_at desc);
