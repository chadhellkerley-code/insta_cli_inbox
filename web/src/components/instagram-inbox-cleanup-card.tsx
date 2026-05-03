"use client";

import { useEffect, useMemo, useState } from "react";

type CleanupStatus = {
  instagram_inbox_cleanup_started_at: string | null;
  instagram_inbox_cleanup_last_run_at: string | null;
  instagram_inbox_cleanup_last_repair_at: string | null;
  instagram_inbox_cleanup_last_error: string | null;
};

type CleanupStats = {
  accountsReviewed: number;
  accountsRevalidated: number;
  identifiersReset: boolean;
  conversationsScanned: number;
  actionableConversations: number;
  conversationsReassigned: number;
  conversationsMerged: number;
  conversationsDeleted: number;
  messagesMoved: number;
  messagesDeduplicated: number;
  skippedAmbiguousConversations: number;
  warnings: string[];
};

type CleanupAction = {
  conversationId: string;
  currentAccountId: string;
  currentAccountUsername: string | null;
  targetAccountId: string | null;
  targetAccountUsername: string | null;
  contactIgsid: string;
  messageCount: number;
  duplicateMessageCount: number;
  action: "reassign" | "merge" | "skip_ambiguous";
  reason: string;
};

type CleanupReport = {
  mode: "preview" | "apply";
  generatedAt: string;
  stats: CleanupStats;
  actions: CleanupAction[];
};

type CleanupPayload = {
  ok?: boolean;
  status?: CleanupStatus;
  preview?: CleanupReport;
  report?: CleanupReport;
  error?: string;
};

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Nunca";
  }

  try {
    return new Intl.DateTimeFormat("es", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function describeAction(action: CleanupAction) {
  if (action.action === "merge") {
    return `Fusionar en ${action.targetAccountUsername ? `@${action.targetAccountUsername}` : action.targetAccountId}`;
  }

  if (action.action === "reassign") {
    return `Mover a ${action.targetAccountUsername ? `@${action.targetAccountUsername}` : action.targetAccountId}`;
  }

  return "Revision manual";
}

export function InstagramInboxCleanupCard() {
  const [status, setStatus] = useState<CleanupStatus | null>(null);
  const [preview, setPreview] = useState<CleanupReport | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error">("success");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  async function loadPreview() {
    const response = await fetch("/api/instagram/inbox-cleanup", {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as CleanupPayload | null;

    if (!response.ok || !payload?.ok || !payload.preview || !payload.status) {
      throw new Error(payload?.error || "No pudimos revisar el inbox.");
    }

    setStatus(payload.status);
    setPreview(payload.preview);
  }

  async function refreshPreview() {
    setLoading(true);

    try {
      await loadPreview();
      setFeedback(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "No pudimos revisar el inbox.");
      setFeedbackTone("error");
    } finally {
      setLoading(false);
    }
  }

  async function applyCleanup() {
    const actionableConversations = preview?.stats.actionableConversations ?? 0;
    const confirmed = window.confirm(
      actionableConversations > 0
        ? `Se van a corregir ${actionableConversations} conversaciones del inbox. Esta accion reubica mensajes y puede fusionar hilos duplicados.`
        : "No hay conversaciones para corregir segun el diagnostico actual. Quieres ejecutar la limpieza igual?",
    );

    if (!confirmed) {
      return;
    }

    setRunning(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/instagram/inbox-cleanup", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as CleanupPayload | null;

      if (!response.ok || !payload?.ok || !payload.report || !payload.status) {
        throw new Error(payload?.error || "No pudimos aplicar la limpieza del inbox.");
      }

      setStatus(payload.status);
      setPreview(payload.report);
      setFeedback(
        payload.report.stats.actionableConversations > 0
          ? "Limpieza aplicada correctamente."
          : "No encontramos conversaciones para corregir.",
      );
      setFeedbackTone("success");
      await loadPreview();
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "No pudimos aplicar la limpieza del inbox.",
      );
      setFeedbackTone("error");
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    void refreshPreview();
  }, []);

  const highlightedActions = useMemo(() => (preview?.actions ?? []).slice(0, 12), [preview]);

  return (
    <section className="list-card settings-card">
      <span className="eyebrow">Inbox integrity</span>
      <h2>Limpieza profesional del inbox</h2>
      <p className="page-copy cleanup-copy">
        Diagnostica conversaciones mal enrutadas entre cuentas y corrige solo los
        casos que se pueden demostrar con identificadores canónicos.
      </p>

      {feedback ? <div className={`feedback ${feedbackTone}`}>{feedback}</div> : null}

      <div className="cleanup-summary-grid">
        <div className="cleanup-summary-card">
          <strong>Ultimo diagnostico</strong>
          <span>{preview ? formatTimestamp(preview.generatedAt) : "Pendiente"}</span>
        </div>
        <div className="cleanup-summary-card">
          <strong>Ultima ejecucion</strong>
          <span>{formatTimestamp(status?.instagram_inbox_cleanup_last_run_at ?? null)}</span>
        </div>
        <div className="cleanup-summary-card">
          <strong>Ultima reparacion</strong>
          <span>{formatTimestamp(status?.instagram_inbox_cleanup_last_repair_at ?? null)}</span>
        </div>
        <div className="cleanup-summary-card">
          <strong>Estado</strong>
          <span>
            {status?.instagram_inbox_cleanup_started_at
              ? "Limpieza en progreso"
              : preview?.stats.actionableConversations
                ? "Hay correcciones listas"
                : "Inbox consistente"}
          </span>
        </div>
      </div>

      {status?.instagram_inbox_cleanup_last_error ? (
        <div className="feedback error">{status.instagram_inbox_cleanup_last_error}</div>
      ) : null}

      <div className="stack-list">
        <div className="list-row settings-row">
          <div className="cleanup-metrics">
            <strong>
              {loading
                ? "Revisando conversaciones..."
                : `${preview?.stats.actionableConversations ?? 0} conversaciones accionables`}
            </strong>
            <p>
              {preview
                ? `${preview.stats.conversationsScanned} conversaciones revisadas, ${preview.stats.messagesMoved} mensajes a mover y ${preview.stats.messagesDeduplicated} duplicados a depurar.`
                : "Todavia no cargamos el diagnostico del inbox."}
            </p>
          </div>

          <div className="settings-actions cleanup-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={loading || running}
              onClick={refreshPreview}
            >
              {loading ? "Revisando..." : "Actualizar diagnostico"}
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={loading || running || Boolean(status?.instagram_inbox_cleanup_started_at)}
              onClick={applyCleanup}
            >
              {running ? "Aplicando..." : "Aplicar limpieza"}
            </button>
          </div>
        </div>
      </div>

      {preview ? (
        <div className="cleanup-report">
          <div className="cleanup-metric-strip">
            <span>Reasignar: {preview.stats.conversationsReassigned}</span>
            <span>Fusionar: {preview.stats.conversationsMerged}</span>
            <span>Ambiguas: {preview.stats.skippedAmbiguousConversations}</span>
            <span>Cuentas revisadas: {preview.stats.accountsReviewed}</span>
          </div>

          {highlightedActions.length > 0 ? (
            <div className="cleanup-action-list">
              {highlightedActions.map((action) => (
                <article key={action.conversationId} className="cleanup-action-card">
                  <div className="cleanup-action-head">
                    <strong>{describeAction(action)}</strong>
                    <span>{action.messageCount} mensajes</span>
                  </div>
                  <p>
                    Contacto {action.contactIgsid.slice(-6)}. Origen{" "}
                    {action.currentAccountUsername
                      ? `@${action.currentAccountUsername}`
                      : action.currentAccountId}
                    {action.targetAccountUsername || action.targetAccountId
                      ? ` -> ${
                          action.targetAccountUsername
                            ? `@${action.targetAccountUsername}`
                            : action.targetAccountId
                        }`
                      : ""}
                    .
                  </p>
                  <p>{action.reason}</p>
                  {action.duplicateMessageCount > 0 ? (
                    <p>{action.duplicateMessageCount} mensajes quedarian deduplicados.</p>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <div className="feedback success">No detectamos conversaciones mal asignadas.</div>
          )}

          {preview.stats.warnings.length > 0 ? (
            <div className="cleanup-warning-list">
              {preview.stats.warnings.slice(0, 6).map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
