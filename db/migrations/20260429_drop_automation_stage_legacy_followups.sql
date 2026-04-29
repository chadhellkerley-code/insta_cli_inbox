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

alter table public.automation_agent_stages
  drop column if exists followup_enabled,
  drop column if exists followup_delay_hours,
  drop column if exists followup_message;
