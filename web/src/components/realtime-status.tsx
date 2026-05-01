"use client";

import { useEffect, useRef, useState } from "react";

import { formatRelativeTime } from "@/lib/shared-data";
import { createClient } from "@/lib/supabase/client";

type StatusTone = "online" | "pending" | "offline";

type RealtimeStatusProps = {
  userId: string;
  initialConnectedAccounts: number;
  initialRecentWebhookAt: string | null;
};

function mapStatus(connectedAccounts: number, recentWebhookAt: string | null) {
  if (connectedAccounts === 0) {
    return {
      label: "Sin cuentas conectadas",
      tone: "offline" as StatusTone,
      detail: "Conecta una cuenta Professional para usar el inbox.",
    };
  }

  if (recentWebhookAt) {
    const lastWebhookMs = new Date(recentWebhookAt).getTime();
    const ageMs = Date.now() - lastWebhookMs;

    if (ageMs < 15 * 60 * 1000) {
      return {
        label: "Webhook activo",
        tone: "online" as StatusTone,
        detail: `${connectedAccounts} cuenta(s) conectada(s) · ultimo evento ${formatRelativeTime(recentWebhookAt)}`,
      };
    }
  }

  return {
    label: "Cuentas conectadas",
    tone: "online" as StatusTone,
    detail: `${connectedAccounts} cuenta(s) conectada(s) por OAuth. Esperando trafico real de Meta.`,
  };
}

export function RealtimeStatus({
  userId,
  initialConnectedAccounts,
  initialRecentWebhookAt,
}: RealtimeStatusProps) {
  const clientRef = useRef<ReturnType<typeof createClient>>();
  const [connectedAccounts, setConnectedAccounts] = useState(initialConnectedAccounts);
  const [recentWebhookAt, setRecentWebhookAt] = useState(initialRecentWebhookAt);

  if (!clientRef.current) {
    clientRef.current = createClient();
  }

  useEffect(() => {
    const supabase = clientRef.current!;

    async function refreshStatus() {
      const accountsResult = await supabase
        .from("instagram_accounts")
        .select("id, last_webhook_at")
        .eq("owner_id", userId);

      if (!accountsResult.error && accountsResult.data) {
        setConnectedAccounts(accountsResult.data.length);

        const latestWebhook = accountsResult.data
          .map((account) => account.last_webhook_at)
          .filter(Boolean)
          .sort((left, right) => {
            return new Date(right as string).getTime() - new Date(left as string).getTime();
          })[0];

        setRecentWebhookAt((latestWebhook as string | undefined) ?? null);
      }
    }

    const accountsChannel = supabase
      .channel(`sidebar-accounts-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "instagram_accounts",
          filter: `owner_id=eq.${userId}`,
        },
        () => {
          void refreshStatus();
        },
      )
      .subscribe();

    const interval = window.setInterval(() => {
      void refreshStatus();
    }, 20_000);

    return () => {
      window.clearInterval(interval);
      void supabase.removeChannel(accountsChannel);
    };
  }, [userId]);

  const status = mapStatus(connectedAccounts, recentWebhookAt);

  return (
    <div className="status-card">
      <div className="status-row">
        <span className={`status-dot ${status.tone}`} aria-hidden="true" />
        <strong>{status.label}</strong>
      </div>
      <span className="status-copy">{status.detail}</span>
    </div>
  );
}
