do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'instagram_reminders'
  ) then
    alter publication supabase_realtime drop table public.instagram_reminders;
  end if;
end
$$;

drop table if exists public.instagram_reminders cascade;
