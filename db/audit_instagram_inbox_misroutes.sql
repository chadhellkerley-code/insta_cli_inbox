-- Read-only audit queries for Instagram inbox misrouting.
-- Run them in Supabase SQL Editor before any manual data repair.

-- 1) Duplicate canonical identifiers in instagram_accounts.
select
  'instagram_account_id' as identifier_source,
  instagram_account_id as identifier,
  count(*) as account_count,
  array_agg(id order by id) as account_ids,
  array_agg(owner_id order by id) as owner_ids,
  array_agg(username order by id) as usernames
from public.instagram_accounts
where instagram_account_id is not null
group by instagram_account_id
having count(*) > 1

union all

select
  'instagram_user_id' as identifier_source,
  instagram_user_id as identifier,
  count(*) as account_count,
  array_agg(id order by id) as account_ids,
  array_agg(owner_id order by id) as owner_ids,
  array_agg(username order by id) as usernames
from public.instagram_accounts
where instagram_user_id is not null
group by instagram_user_id
having count(*) > 1

union all

select
  'instagram_app_user_id' as identifier_source,
  instagram_app_user_id as identifier,
  count(*) as account_count,
  array_agg(id order by id) as account_ids,
  array_agg(owner_id order by id) as owner_ids,
  array_agg(username order by id) as usernames
from public.instagram_accounts
where instagram_app_user_id is not null
group by instagram_app_user_id
having count(*) > 1

order by identifier_source, identifier;

-- 2) Messages whose owned identifier resolves to a different account
-- than the account_id stored on the message row.
with message_owned_identifier as (
  select
    m.id as message_id,
    m.owner_id,
    m.account_id as stored_account_id,
    m.conversation_id,
    m.direction,
    case
      when m.direction = 'out' then nullif(trim(m.sender_igsid), '')
      else nullif(trim(m.recipient_igsid), '')
    end as owned_identifier,
    m.sent_at,
    m.created_at,
    m.text_content
  from public.instagram_messages m
),
resolved_messages as (
  select
    moi.*,
    iai.account_id as resolved_account_id
  from message_owned_identifier moi
  left join public.instagram_account_identifiers iai
    on iai.identifier = moi.owned_identifier
)
select
  rm.owner_id,
  rm.message_id,
  rm.conversation_id,
  rm.direction,
  rm.owned_identifier,
  rm.stored_account_id,
  rm.resolved_account_id,
  rm.sent_at,
  rm.created_at,
  rm.text_content
from resolved_messages rm
where rm.owned_identifier is not null
  and rm.resolved_account_id is not null
  and rm.resolved_account_id <> rm.stored_account_id
order by rm.created_at desc nulls last, rm.sent_at desc nulls last;

-- 3) Conversations whose underlying messages resolve to more than one
-- candidate account, or to an account different from the stored account.
with message_owned_identifier as (
  select
    m.id as message_id,
    m.owner_id,
    m.account_id as stored_account_id,
    m.conversation_id,
    case
      when m.direction = 'out' then nullif(trim(m.sender_igsid), '')
      else nullif(trim(m.recipient_igsid), '')
    end as owned_identifier
  from public.instagram_messages m
),
resolved_messages as (
  select
    moi.*,
    iai.account_id as resolved_account_id
  from message_owned_identifier moi
  left join public.instagram_account_identifiers iai
    on iai.identifier = moi.owned_identifier
),
conversation_resolution as (
  select
    c.id as conversation_id,
    c.owner_id,
    c.account_id as stored_conversation_account_id,
    c.contact_igsid,
    count(*) filter (where rm.resolved_account_id is not null) as resolved_message_count,
    count(distinct rm.resolved_account_id) filter (where rm.resolved_account_id is not null)
      as distinct_resolved_accounts,
    array_agg(distinct rm.resolved_account_id) filter (where rm.resolved_account_id is not null)
      as resolved_account_ids
  from public.instagram_conversations c
  left join resolved_messages rm
    on rm.conversation_id = c.id
  group by c.id, c.owner_id, c.account_id, c.contact_igsid
)
select
  *
from conversation_resolution
where distinct_resolved_accounts > 1
   or (
     distinct_resolved_accounts = 1
     and resolved_account_ids[1] is distinct from stored_conversation_account_id
   )
order by owner_id, conversation_id;
