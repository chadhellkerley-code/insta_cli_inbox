"use client";

import { useEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

type StatusTone = "online" | "pending" | "offline";

export function RealtimeStatus() {
  const clientRef = useRef<ReturnType<typeof createClient>>();
  const [label, setLabel] = useState("Conectando");
  const [tone, setTone] = useState<StatusTone>("pending");
  const [lastHeartbeat, setLastHeartbeat] = useState("Esperando latido");

  if (!clientRef.current) {
    clientRef.current = createClient();
  }

  useEffect(() => {
    const supabase = clientRef.current!;
    const channel = supabase
      .channel("server-status")
      .on("broadcast", { event: "heartbeat" }, () => {
        setLabel("Servidor online");
        setTone("online");
        setLastHeartbeat("Heartbeat recibido");
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setLabel("Realtime online");
          setTone("online");
          setLastHeartbeat("Canal sincronizado");
          return;
        }

        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setLabel("Reconectando");
          setTone("pending");
          setLastHeartbeat("Se perdió la conexión");
          return;
        }

        setLabel("Sin conexión");
        setTone("offline");
        setLastHeartbeat("Canal cerrado");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

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
