import { InboxRealtimeShell } from "@/components/inbox-realtime-shell";
import {
  buildThreadSummaries,
  loadOwnedAccounts,
  loadRecentChatsForAccounts,
  loadThreadMessages,
  requireUserContext,
} from "@/lib/app-data";

export default async function InboxPage() {
  const { supabase, user } = await requireUserContext();
  const accounts = await loadOwnedAccounts(supabase, user.id);
  const recentChats = await loadRecentChatsForAccounts(
    supabase,
    accounts.map((account) => account.id),
  );
  const threads = buildThreadSummaries(recentChats, accounts);
  const initialThread = threads[0] ?? null;
  const initialMessages = initialThread
    ? await loadThreadMessages(
        supabase,
        initialThread.accountId,
        initialThread.threadId,
      )
    : [];

  return (
    <InboxRealtimeShell
      userId={user.id}
      initialAccounts={accounts}
      initialThreads={threads}
      initialMessages={initialMessages}
      initialSelectedThreadKey={initialThread?.threadKey ?? null}
    />
  );
}
