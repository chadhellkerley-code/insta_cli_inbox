create table if not exists public.automation_stage_followups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  stage_id uuid not null references public.automation_agent_stages(id) on delete cascade,
  followup_order integer not null check (followup_order >= 1),
  is_active boolean not null default true,
  delay_hours integer not null default 2 check (delay_hours >= 0),
  message text,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint automation_stage_followups_stage_order_unique unique (stage_id, followup_order),
  constraint automation_stage_followups_message_check check (
    is_active = false
    or nullif(btrim(coalesce(message, '')), '') is not null
  )
);

create index if not exists automation_stage_followups_stage_order_idx
  on public.automation_stage_followups (stage_id, followup_order asc);

drop trigger if exists set_automation_stage_followups_updated_at on public.automation_stage_followups;
create trigger set_automation_stage_followups_updated_at
before update on public.automation_stage_followups
for each row
execute function public.set_instagram_updated_at();

alter table public.automation_stage_followups enable row level security;

drop policy if exists "automation_stage_followups_select_own" on public.automation_stage_followups;
create policy "automation_stage_followups_select_own"
on public.automation_stage_followups
for select
using (auth.uid() = owner_id);

drop policy if exists "automation_stage_followups_insert_own" on public.automation_stage_followups;
create policy "automation_stage_followups_insert_own"
on public.automation_stage_followups
for insert
with check (auth.uid() = owner_id);

drop policy if exists "automation_stage_followups_update_own" on public.automation_stage_followups;
create policy "automation_stage_followups_update_own"
on public.automation_stage_followups
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "automation_stage_followups_delete_own" on public.automation_stage_followups;
create policy "automation_stage_followups_delete_own"
on public.automation_stage_followups
for delete
using (auth.uid() = owner_id);

insert into public.automation_stage_followups (
  owner_id,
  stage_id,
  followup_order,
  is_active,
  delay_hours,
  message
)
select
  stages.owner_id,
  stages.id,
  1,
  true,
  stages.followup_delay_hours,
  stages.followup_message
from public.automation_agent_stages stages
where stages.followup_enabled = true
  and nullif(btrim(coalesce(stages.followup_message, '')), '') is not null
  and not exists (
    select 1
    from public.automation_stage_followups followups
    where followups.stage_id = stages.id
  );
