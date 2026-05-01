alter table public.automation_stage_messages
  add column if not exists generation_prompt text;

alter table public.automation_stage_messages
  drop constraint if exists automation_stage_messages_message_type_check;

alter table public.automation_stage_messages
  add constraint automation_stage_messages_message_type_check
  check (message_type in ('text', 'audio', 'smart_text'));

alter table public.automation_stage_messages
  drop constraint if exists automation_stage_messages_content_check;

alter table public.automation_stage_messages
  add constraint automation_stage_messages_content_check
  check (
    (message_type = 'text' and nullif(btrim(coalesce(text_content, '')), '') is not null)
    or
    (message_type = 'audio' and nullif(btrim(coalesce(media_url, '')), '') is not null)
    or
    (message_type = 'smart_text' and nullif(btrim(coalesce(generation_prompt, '')), '') is not null)
  );
