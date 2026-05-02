-- Audit before applying in production:
--
-- Conversations whose owner_id does not match their account owner:
-- select c.id, c.account_id, c.owner_id as conversation_owner_id, a.owner_id as account_owner_id
-- from public.instagram_conversations c
-- join public.instagram_accounts a on a.id = c.account_id
-- where c.owner_id <> a.owner_id;
--
-- Messages whose owner_id does not match their account owner:
-- select m.id, m.account_id, m.owner_id as message_owner_id, a.owner_id as account_owner_id
-- from public.instagram_messages m
-- join public.instagram_accounts a on a.id = m.account_id
-- where m.owner_id <> a.owner_id;
--
-- Messages whose conversation does not belong to the same account and owner:
-- select
--   m.id,
--   m.conversation_id,
--   m.account_id as message_account_id,
--   c.account_id as conversation_account_id,
--   m.owner_id as message_owner_id,
--   c.owner_id as conversation_owner_id
-- from public.instagram_messages m
-- join public.instagram_conversations c on c.id = m.conversation_id
-- where m.account_id <> c.account_id or m.owner_id <> c.owner_id;

create unique index if not exists instagram_accounts_id_owner_id_unique_idx
  on public.instagram_accounts (id, owner_id);

create unique index if not exists instagram_conversations_id_account_owner_unique_idx
  on public.instagram_conversations (id, account_id, owner_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'instagram_conversations_account_owner_fk'
      and conrelid = 'public.instagram_conversations'::regclass
  ) then
    alter table public.instagram_conversations
      add constraint instagram_conversations_account_owner_fk
      foreign key (account_id, owner_id)
      references public.instagram_accounts (id, owner_id)
      on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'instagram_messages_account_owner_fk'
      and conrelid = 'public.instagram_messages'::regclass
  ) then
    alter table public.instagram_messages
      add constraint instagram_messages_account_owner_fk
      foreign key (account_id, owner_id)
      references public.instagram_accounts (id, owner_id)
      on delete cascade;
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'instagram_messages_conversation_account_owner_fk'
      and conrelid = 'public.instagram_messages'::regclass
  ) then
    alter table public.instagram_messages
      add constraint instagram_messages_conversation_account_owner_fk
      foreign key (conversation_id, account_id, owner_id)
      references public.instagram_conversations (id, account_id, owner_id)
      on delete cascade;
  end if;
end;
$$;
