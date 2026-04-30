import { redirect } from "next/navigation";

import { SidebarNav } from "@/components/sidebar-nav";
import { ThemeToggle } from "@/components/theme-toggle";
import { getDisplayName, requireUserContext } from "@/lib/app-data";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await requireUserContext();

  async function logoutAction() {
    "use server";

    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <div className="dashboard-shell">
      <ThemeToggle />

      <aside className="dashboard-sidebar">
        <div className="sidebar-brand">
          <span>Insta CLI Inbox</span>
          <strong>Inbox oficial de meta</strong>
        </div>

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
