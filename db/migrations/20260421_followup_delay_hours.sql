do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'automation_agent_stages'
      and column_name = 'followup_delay_minutes'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'automation_agent_stages'
      and column_name = 'followup_delay_hours'
  ) then
    alter table public.automation_agent_stages
      rename column followup_delay_minutes to followup_delay_hours;
  end if;
end
$$;

alter table public.automation_agent_stages
  alter column followup_delay_hours set default 0;

alter table public.automation_agent_stages
  drop constraint if exists automation_agent_stages_followup_delay_minutes_check;

alter table public.automation_agent_stages
  drop constraint if exists automation_agent_stages_followup_delay_hours_check;

alter table public.automation_agent_stages
  add constraint automation_agent_stages_followup_delay_hours_check
  check (followup_delay_hours >= 0);
