delete from public.automation_ai_credentials
where provider is distinct from 'openai';

update public.automation_ai_credentials
set
  provider = 'openai',
  model = 'gpt-4o-mini',
  updated_at = timezone('utc'::text, now())
where provider = 'openai';

alter table public.automation_ai_credentials
  alter column provider set default 'openai',
  alter column model set default 'gpt-4o-mini';

alter table public.automation_ai_credentials
  drop constraint if exists automation_ai_credentials_provider_check;

alter table public.automation_ai_credentials
  add constraint automation_ai_credentials_provider_check
  check (provider = 'openai');

notify pgrst, 'reload schema';
