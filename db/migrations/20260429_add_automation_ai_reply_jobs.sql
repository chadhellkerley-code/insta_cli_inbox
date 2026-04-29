alter table public.automation_jobs
  drop constraint if exists automation_jobs_job_type_check;

alter table public.automation_jobs
  add constraint automation_jobs_job_type_check
  check (job_type in ('stage_message', 'followup', 'ai_reply'));

create index if not exists automation_jobs_due_dispatch_idx
  on public.automation_jobs (status, job_type, scheduled_for asc);

notify pgrst, 'reload schema';
