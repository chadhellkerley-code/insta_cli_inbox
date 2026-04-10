import { InboxRealtimeShell } from "@/components/inbox-realtime-shell";
import {
  enrichConversationsWithAccounts,
  loadConversationMessages,
  loadConversations,
  loadOwnedAccounts,
  loadReminders,
  requireUserContext,
} from "@/lib/app-data";

export default async function InboxPage() {
  const { supabase, user } = await requireUserContext();
  const [accounts, conversations, reminders] = await Promise.all([
    loadOwnedAccounts(supabase, user.id),
    loadConversations(supabase, user.id),
    loadReminders(supabase, user.id),
  ]);

  const enrichedConversations = enrichConversationsWithAccounts(conversations, accounts);
  const initialConversation = enrichedConversations[0] ?? null;
  const initialMessages = initialConversation
    ? await loadConversationMessages(supabase, initialConversation.id)
    : [];

  return (
    <InboxRealtimeShell
      userId={user.id}
      initialAccounts={accounts}
      initialConversations={enrichedConversations}
      initialMessages={initialMessages}
      initialReminders={reminders}
      initialSelectedConversationId={initialConversation?.id ?? null}
    />
  );
}
