"use client";

import { useEffect, useRef, useState } from "react";

import { formatRelativeTime } from "@/lib/shared-data";
import { createClient } from "@/lib/supabase/client";

type StatusTone = "online" | "pending" | "offline";

type RealtimeStatusProps = {
  userId: string;
  initialConnectedAccounts: number;
  initialDueReminders: number;
  initialRecentWebhookAt: string | null;
};

function mapStatus(
  connectedAccounts: number,
  dueReminders: number,
  recentWebhookAt: string | null,
) {
  if (connectedAccounts === 0) {
    return {
      label: "Sin cuentas conectadas",
      tone: "offline" as StatusTone,
      detail: "Conecta una cuenta Professional para activar el inbox.",
    };
  }

  if (recentWebhookAt) {
    const lastWebhookMs = new Date(recentWebhookAt).getTime();
    const ageMs = Date.now() - lastWebhookMs;

    if (ageMs < 15 * 60 * 1000) {
      return {
        label: dueReminders > 0 ? "Webhook activo con alertas" : "Webhook activo",
        tone: dueReminders > 0 ? ("pending" as StatusTone) : ("online" as StatusTone),
        detail: `${connectedAccounts} cuenta(s) conectada(s) · ultimo evento ${formatRelativeTime(recentWebhookAt)}`,
      };
    }
  }

  return {
    label: dueReminders > 0 ? "Seguimientos pendientes" : "Cuentas conectadas",
    tone: dueReminders > 0 ? ("pending" as StatusTone) : ("online" as StatusTone),
    detail:
      dueReminders > 0
        ? `${dueReminders} recordatorio(s) vencido(s) dentro de la app.`
        : `${connectedAccounts} cuenta(s) listas. Esperando nuevos mensajes de Meta.`,
  };
}

export function RealtimeStatus({
  userId,
  initialConnectedAccounts,
  initialDueReminders,
  initialRecentWebhookAt,
}: RealtimeStatusProps) {
  const clientRef = useRef<ReturnType<typeof createClient>>();
  const [connectedAccounts, setConnectedAccounts] = useState(initialConnectedAccounts);
  const [dueReminders, setDueReminders] = useState(initialDueReminders);
  const [recentWebhookAt, setRecentWebhookAt] = useState(initialRecentWebhookAt);

  if (!clientRef.current) {
    clientRef.current = createClient();
  }

  useEffect(() => {
    const supabase = clientRef.current!;

    async function refreshStatus() {
      const [accountsResult, remindersResult] = await Promise.all([
        supabase
          .from("instagram_accounts")
          .select("id, last_webhook_at")
          .eq("owner_id", userId),
        supabase
          .from("instagram_reminders")
          .select("id, remind_at, status")
          .eq("owner_id", userId)
          .eq("status", "pending"),
      ]);

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

      if (!remindersResult.error && remindersResult.data) {
        const now = Date.now();
        const totalDue = remindersResult.data.filter((reminder) => {
          return new Date(reminder.remind_at).getTime() <= now;
        }).length;

        setDueReminders(totalDue);
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

    const remindersChannel = supabase
      .channel(`sidebar-reminders-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "instagram_reminders",
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
      void supabase.removeChannel(remindersChannel);
    };
  }, [userId]);

  const status = mapStatus(connectedAccounts, dueReminders, recentWebhookAt);

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
