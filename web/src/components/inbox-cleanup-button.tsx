"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type CleanupStats = {
  conversationsReassigned: number;
  conversationsMerged: number;
  messagesMoved: number;
  messagesDeduplicated: number;
  warnings: string[];
};

export function InboxCleanupButton() {
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  async function handleCleanup() {
    const confirmed = window.confirm(
      "Esto limpiara los chats que hayan quedado en el inbox incorrecto y los movera o fusionara en la cuenta correcta. Queres continuar?",
    );

    if (!confirmed) {
      return;
    }

    setIsRunning(true);
    setFeedback(null);
    setWarnings([]);

    try {
      const response = await fetch("/api/instagram/inbox/cleanup", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            ok?: boolean;
            message?: string;
            error?: string;
            stats?: CleanupStats;
          }
        | null;

      if (!response.ok || !payload?.ok || !payload.stats) {
        throw new Error(payload?.error || "No pudimos limpiar el inbox.");
      }

      const summary = [
        payload.message ?? "Limpieza completada.",
        `Conversaciones movidas: ${payload.stats.conversationsReassigned}.`,
        `Conversaciones fusionadas: ${payload.stats.conversationsMerged}.`,
        `Mensajes movidos: ${payload.stats.messagesMoved}.`,
        `Duplicados eliminados: ${payload.stats.messagesDeduplicated}.`,
      ].join(" ");

      setFeedback(summary);
      setWarnings(payload.stats.warnings ?? []);
      router.refresh();
    } catch (error) {
      setFeedback(
        error instanceof Error ? error.message : "No pudimos limpiar el inbox.",
      );
      setWarnings([]);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="form-stack">
      <button
        type="button"
        className="button button-secondary"
        onClick={handleCleanup}
        disabled={isRunning}
      >
        {isRunning ? "Limpiando inbox..." : "Limpiar inbox contaminado"}
      </button>
      {feedback ? <span className="status-copy">{feedback}</span> : null}
      {warnings.length > 0 ? (
        <div className="feedback error">
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
