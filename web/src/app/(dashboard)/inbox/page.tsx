import { InboxRealtimeShell } from "@/components/inbox-realtime-shell";
import {
  enrichConversationsWithAccounts,
  loadConversationMessages,
  loadConversations,
  loadOwnedAccounts,
  requireUserContext,
} from "@/lib/app-data";

export default async function InboxPage() {
  const { supabase, user } = await requireUserContext();
  const [accounts, conversations] = await Promise.all([
    loadOwnedAccounts(supabase, user.id),
    loadConversations(supabase, user.id),
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
      initialSelectedConversationId={initialConversation?.id ?? null}
    />
  );
}
