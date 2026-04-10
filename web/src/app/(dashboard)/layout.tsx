import { redirect } from "next/navigation";

import { RealtimeStatus } from "@/components/realtime-status";
import { SidebarNav } from "@/components/sidebar-nav";
import {
  getDisplayName,
  loadDueReminders,
  loadOwnedAccounts,
  requireUserContext,
} from "@/lib/app-data";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, supabase } = await requireUserContext();
  const [accounts, dueReminders] = await Promise.all([
    loadOwnedAccounts(supabase, user.id),
    loadDueReminders(supabase, user.id),
  ]);

  const recentWebhookAt =
    accounts
      .map((account) => account.last_webhook_at)
      .filter(Boolean)
      .sort((left, right) => {
        return new Date(right as string).getTime() - new Date(left as string).getTime();
      })[0] ?? null;

  async function logoutAction() {
    "use server";

    const supabase = createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="sidebar-brand">
          <span>Insta CLI Inbox</span>
          <strong>Instagram Graph CRM</strong>
          <p>Inbox unificado en tiempo real con Meta y Supabase.</p>
        </div>

        <RealtimeStatus
          userId={user.id}
          initialConnectedAccounts={accounts.length}
          initialDueReminders={dueReminders.length}
          initialRecentWebhookAt={recentWebhookAt}
        />
        <SidebarNav />

        <div className="sidebar-user">
          <span>{profile?.role ?? "user"}</span>
          <strong>{getDisplayName(user, profile)}</strong>
          <p>{user.email}</p>

          <form action={logoutAction} className="form-stack">
            <button type="submit" className="button button-secondary">
              Cerrar sesion
            </button>
          </form>
        </div>
      </aside>

      <main className="dashboard-content">{children}</main>
    </div>
  );
}
