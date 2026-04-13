alter table public.instagram_accounts
  add column if not exists token_obtained_at timestamptz,
  add column if not exists expires_in integer,
  add column if not exists expires_at timestamptz,
  add column if not exists token_expires_at timestamptz,
  add column if not exists token_lifecycle text,
  add column if not exists last_token_refresh_at timestamptz,
  add column if not exists last_oauth_at timestamptz;

update public.instagram_accounts
set
  token_obtained_at = coalesce(token_obtained_at, last_oauth_at, connected_at, created_at),
  expires_at = coalesce(expires_at, token_expires_at),
  token_expires_at = coalesce(token_expires_at, expires_at),
  last_token_refresh_at = coalesce(last_token_refresh_at, token_obtained_at, last_oauth_at),
  last_oauth_at = coalesce(last_oauth_at, token_obtained_at, connected_at, created_at)
where
  token_obtained_at is null
  or expires_at is null
  or token_expires_at is null
  or last_token_refresh_at is null
  or last_oauth_at is null;
