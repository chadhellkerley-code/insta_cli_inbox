alter table public.automation_agent_stages
  add column if not exists auto_schedule_enabled boolean not null default false;

alter table public.automation_jobs
  drop constraint if exists automation_jobs_job_type_check;

alter table public.automation_jobs
  add constraint automation_jobs_job_type_check
  check (job_type in ('stage_message', 'followup', 'ai_reply', 'calendly_schedule'));

create index if not exists automation_jobs_calendly_schedule_idx
  on public.automation_jobs (owner_id, status, scheduled_for asc)
  where job_type = 'calendly_schedule';

notify pgrst, 'reload schema';
