import { redirect } from "next/navigation";

import { RealtimeStatus } from "@/components/realtime-status";
import { SidebarNav } from "@/components/sidebar-nav";
import {
  getDisplayName,
  loadOwnerAgents,
  loadLatestAgentPresence,
  requireUserContext,
} from "@/lib/app-data";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user, profile } = await requireUserContext();
  const ownerAgents = await loadOwnerAgents(supabase, user.id);
  const initialPresence = await loadLatestAgentPresence(supabase, user.id);

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
          <strong>CRM dark mode</strong>
          <p>Negro, gris y violeta para operar conversaciones en vivo.</p>
        </div>

        <RealtimeStatus
          agentIds={ownerAgents.map((agent) => agent.agent_id)}
          initialPresence={initialPresence}
        />
        <SidebarNav />

        <div className="sidebar-user">
          <span>{profile?.role ?? "user"}</span>
          <strong>{getDisplayName(user, profile)}</strong>
          <p>{user.email}</p>

          <form action={logoutAction} className="form-stack">
            <button type="submit" className="button button-secondary">
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <main className="dashboard-content">{children}</main>
    </div>
  );
}
