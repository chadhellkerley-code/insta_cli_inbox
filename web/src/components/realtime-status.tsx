"use client";

import { useEffect, useRef, useState } from "react";

import type { AgentPresence } from "@/lib/shared-data";
import { formatRelativeTime } from "@/lib/shared-data";
import { createClient } from "@/lib/supabase/client";

type StatusTone = "online" | "pending" | "offline";

type RealtimeStatusProps = {
  agentIds: string[];
  initialPresence: AgentPresence | null;
};

function mapPresenceToUi(
  presence: AgentPresence | null,
  hasPairedAgents: boolean,
) {
  if (!hasPairedAgents) {
    return {
      label: "Sin agente vinculado",
      tone: "offline" as StatusTone,
      lastHeartbeat: "Vincula un agent_id para operar desde tu PC",
    };
  }

  if (!presence?.last_seen_at) {
    return {
      label: "Agente offline",
      tone: "offline" as StatusTone,
      lastHeartbeat: "Sin heartbeats todavia",
    };
  }

  const ageMs = Date.now() - new Date(presence.last_seen_at).getTime();
  if (ageMs < 30_000) {
    return {
      label: `Agente ${presence.agent_id} online`,
      tone: "online" as StatusTone,
      lastHeartbeat: `Heartbeat ${formatRelativeTime(presence.last_seen_at)}`,
    };
  }

  if (ageMs < 120_000) {
    return {
      label: `Agente ${presence.agent_id} demorando`,
      tone: "pending" as StatusTone,
      lastHeartbeat: `Ultimo heartbeat ${formatRelativeTime(presence.last_seen_at)}`,
    };
  }

  return {
    label: `Agente ${presence.agent_id} offline`,
    tone: "offline" as StatusTone,
    lastHeartbeat: `Ultimo heartbeat ${formatRelativeTime(presence.last_seen_at)}`,
  };
}

export function RealtimeStatus({
  agentIds,
  initialPresence,
}: RealtimeStatusProps) {
  const clientRef = useRef<ReturnType<typeof createClient>>();
  const hasPairedAgents = agentIds.length > 0;
  const initialUi = mapPresenceToUi(initialPresence, hasPairedAgents);
  const [label, setLabel] = useState(initialUi.label);
  const [tone, setTone] = useState<StatusTone>(initialUi.tone);
  const [lastHeartbeat, setLastHeartbeat] = useState(initialUi.lastHeartbeat);

  if (!clientRef.current) {
    clientRef.current = createClient();
  }

  useEffect(() => {
    const supabase = clientRef.current!;

    if (agentIds.length === 0) {
      const nextUi = mapPresenceToUi(null, false);
      setLabel(nextUi.label);
      setTone(nextUi.tone);
      setLastHeartbeat(nextUi.lastHeartbeat);
      return;
    }

    async function refreshPresence() {
      const { data, error } = await supabase
        .from("agent_presence")
        .select("agent_id, machine_name, status, last_seen_at")
        .in("agent_id", agentIds)
        .order("last_seen_at", { ascending: false })
        .limit(1);

      if (error) {
        return;
      }

      const nextPresence = ((data as AgentPresence[] | null) ?? [])[0] ?? null;
      const nextUi = mapPresenceToUi(nextPresence, true);
      setLabel(nextUi.label);
      setTone(nextUi.tone);
      setLastHeartbeat(nextUi.lastHeartbeat);
    }

    const channel = supabase
      .channel(`agent-presence-${agentIds.join(",")}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "agent_presence",
        },
        () => {
          void refreshPresence();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void refreshPresence();
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setLabel("Reconectando agente");
          setTone("pending");
          setLastHeartbeat("Se perdio la conexion realtime");
          return;
        }

        setLabel("Agente offline");
        setTone("offline");
        setLastHeartbeat("Canal realtime cerrado");
      });

    const interval = window.setInterval(() => {
      void refreshPresence();
    }, 15_000);

    return () => {
      window.clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [agentIds]);

  return (
    <div className="status-card">
      <div className="status-row">
        <span className={`status-dot ${tone}`} aria-hidden="true" />
        <strong>{label}</strong>
      </div>
      <span className="status-copy">{lastHeartbeat}</span>
    </div>
  );
}
