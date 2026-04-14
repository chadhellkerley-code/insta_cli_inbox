begin;

alter table public.instagram_accounts
  add column if not exists page_id text,
  add column if not exists webhook_subscribed_at timestamptz,
  add column if not exists webhook_status text,
  add column if not exists messaging_status text,
  add column if not exists last_webhook_check_at timestamptz,
  add column if not exists webhook_subscription_error text;

alter table public.instagram_accounts
  alter column status set default 'oauth_connected';

alter table public.instagram_accounts
  alter column webhook_status set default 'pending';

alter table public.instagram_accounts
  alter column messaging_status set default 'pending';

update public.instagram_accounts
set
  webhook_status = coalesce(webhook_status, case when last_webhook_at is not null then 'ready' else 'pending' end),
  messaging_status = coalesce(messaging_status, case when last_webhook_at is not null then 'ready' else 'pending' end),
  webhook_subscribed_at = coalesce(webhook_subscribed_at, last_webhook_at),
  last_webhook_check_at = coalesce(last_webhook_check_at, last_webhook_at),
  status = case
    when status = 'connected' and last_webhook_at is not null then 'messaging_ready'
    when status = 'connected' then 'oauth_connected'
    else status
  end
where
  webhook_status is null
  or messaging_status is null
  or webhook_subscribed_at is null
  or last_webhook_check_at is null
  or status = 'connected';

commit;
