alter table public.profiles
  add column if not exists instagram_inbox_cleanup_started_at timestamptz;

alter table public.profiles
  add column if not exists instagram_inbox_cleanup_last_run_at timestamptz;

alter table public.profiles
  add column if not exists instagram_inbox_cleanup_last_repair_at timestamptz;

alter table public.profiles
  add column if not exists instagram_inbox_cleanup_last_error text;
