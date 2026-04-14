import { AutomationAgentsManager } from "@/components/automation-agents-manager";
import { loadAutomationAgents } from "@/lib/automation/server";
import { requireUserContext } from "@/lib/app-data";

export default async function AutomatizacionesPage() {
  const { supabase, user } = await requireUserContext();
  const agents = await loadAutomationAgents(supabase, user.id);

  return <AutomationAgentsManager initialAgents={agents} />;
}
