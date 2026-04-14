"use client";

import { useEffect, useRef, useState } from "react";

import type {
  AutomationAgent,
  AutomationAgentInput,
  LocalAgentAiConfig,
} from "@/lib/automation/types";
import {
  createEmptyAgentDraft,
  DEFAULT_AGENT_NAME,
  getAgentStatusLabel,
} from "@/lib/automation/types";

type AutomationAgentsManagerProps = {
  initialAgents: AutomationAgent[];
};

type ModalMode = "create" | "edit";

const AI_STORAGE_KEY = "insta-cli-automation-ai";

function toAgentInput(agent: AutomationAgent): AutomationAgentInput {
  return {
    id: agent.id,
    name: agent.name,
    personality: agent.personality,
    minReplyDelaySeconds: agent.minReplyDelaySeconds,
    maxReplyDelaySeconds: agent.maxReplyDelaySeconds,
    maxMediaPerChat: agent.maxMediaPerChat,
    isActive: agent.isActive,
    aiEnabled: agent.aiEnabled,
    aiPrompt: agent.aiPrompt,
    stages: agent.stages.map((stage) => ({
      id: stage.id,
      name: stage.name,
      followupEnabled: stage.followupEnabled,
      followupDelayMinutes: stage.followupDelayMinutes,
      followupMessage: stage.followupMessage,
      messages: stage.messages.map((message) => ({
        id: message.id,
        messageType: message.messageType,
        textContent: message.textContent,
        mediaUrl: message.mediaUrl,
        delaySeconds: message.delaySeconds,
      })),
    })),
  };
}

function getAgentCardSummary(agent: AutomationAgent) {
  const totalMessages = agent.stages.reduce((sum, stage) => sum + stage.messages.length, 0);

  return `${agent.stages.length} etapas · ${totalMessages} mensajes`;
}

function readLocalAiConfig() {
  if (typeof window === "undefined") {
    return {} as Record<string, LocalAgentAiConfig>;
  }

  try {
    const raw = window.localStorage.getItem(AI_STORAGE_KEY);

    if (!raw) {
      return {} as Record<string, LocalAgentAiConfig>;
    }

    return JSON.parse(raw) as Record<string, LocalAgentAiConfig>;
  } catch {
    return {} as Record<string, LocalAgentAiConfig>;
  }
}

function writeLocalAiConfig(value: Record<string, LocalAgentAiConfig>) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AI_STORAGE_KEY, JSON.stringify(value));
}

export function AutomationAgentsManager({
  initialAgents,
}: AutomationAgentsManagerProps) {
  const [agents, setAgents] = useState(initialAgents);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    initialAgents[0]?.id ?? null,
  );
  const [flowDraft, setFlowDraft] = useState<AutomationAgentInput | null>(
    initialAgents[0] ? toAgentInput(initialAgents[0]) : null,
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>("create");
  const [modalDraft, setModalDraft] = useState<AutomationAgentInput>(createEmptyAgentDraft());
  const [localAiConfig, setLocalAiConfig] = useState<Record<string, LocalAgentAiConfig>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error">("success");
  const [savingBasic, setSavingBasic] = useState(false);
  const [savingFlow, setSavingFlow] = useState(false);
  const [processingJobs, setProcessingJobs] = useState(false);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [recordingTargetKey, setRecordingTargetKey] = useState<string | null>(null);
  const [uploadingTargetKey, setUploadingTargetKey] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);

  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const activeAgentsCount = agents.filter((agent) => agent.isActive).length;

  useEffect(() => {
    setLocalAiConfig(readLocalAiConfig());
  }, []);

  useEffect(() => {
    if (!selectedAgentId) {
      setFlowDraft(null);
      return;
    }

    const agent = agents.find((item) => item.id === selectedAgentId) ?? null;
    setFlowDraft(agent ? toAgentInput(agent) : null);
  }, [agents, selectedAgentId]);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }

      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  function showFeedback(message: string, tone: "success" | "error") {
    setFeedback(message);
    setFeedbackTone(tone);
  }

  async function refreshAgents(preferredAgentId?: string | null) {
    const response = await fetch("/api/automation/agents", {
      method: "GET",
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as
      | { agents?: AutomationAgent[]; error?: string }
      | null;

    if (!response.ok || !payload?.agents) {
      throw new Error(payload?.error || "No pudimos refrescar los agentes.");
    }

    setAgents(payload.agents);

    const nextSelectedId =
      payload.agents.find((agent) => agent.id === preferredAgentId)?.id ??
      payload.agents.find((agent) => agent.id === selectedAgentId)?.id ??
      payload.agents[0]?.id ??
      null;

    setSelectedAgentId(nextSelectedId);
  }

  function openCreateModal() {
    setModalMode("create");
    setModalDraft(createEmptyAgentDraft());
    setModalOpen(true);
  }

  function openEditModal(agent: AutomationAgent) {
    setModalMode("edit");
    setModalDraft(toAgentInput(agent));
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setModalDraft(createEmptyAgentDraft());
  }

  async function saveBasicSettings() {
    setSavingBasic(true);

    try {
      const targetUrl =
        modalMode === "edit" && modalDraft.id
          ? `/api/automation/agents/${modalDraft.id}`
          : "/api/automation/agents";
      const response = await fetch(targetUrl, {
        method: modalMode === "edit" ? "PUT" : "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(modalDraft),
      });
      const payload = (await response.json().catch(() => null)) as
        | { agent?: AutomationAgent | null; error?: string }
        | null;

      if (!response.ok || !payload?.agent) {
        throw new Error(payload?.error || "No pudimos guardar el agente.");
      }

      await refreshAgents(payload.agent.id);
      setSelectedAgentId(payload.agent.id);
      closeModal();
      showFeedback("Ajustes basicos guardados.", "success");
    } catch (error) {
      showFeedback(
        error instanceof Error ? error.message : "No pudimos guardar el agente.",
        "error",
      );
    } finally {
      setSavingBasic(false);
    }
  }

  async function saveFlow() {
    if (!selectedAgentId || !flowDraft) {
      return;
    }

    setSavingFlow(true);

    try {
      const response = await fetch(`/api/automation/agents/${selectedAgentId}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...flowDraft,
          id: selectedAgentId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { agent?: AutomationAgent | null; error?: string }
        | null;

      if (!response.ok || !payload?.agent) {
        throw new Error(payload?.error || "No pudimos guardar el flujo.");
      }

      await refreshAgents(payload.agent.id);
      showFeedback("Flujo guardado.", "success");
    } catch (error) {
      showFeedback(
        error instanceof Error ? error.message : "No pudimos guardar el flujo.",
        "error",
      );
    } finally {
      setSavingFlow(false);
    }
  }

  async function toggleAgent(agent: AutomationAgent) {
    try {
      const response = await fetch(`/api/automation/agents/${agent.id}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...toAgentInput(agent),
          isActive: !agent.isActive,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { agent?: AutomationAgent | null; error?: string }
        | null;

      if (!response.ok || !payload?.agent) {
        throw new Error(payload?.error || "No pudimos cambiar el estado del agente.");
      }

      await refreshAgents(agent.id);
      showFeedback(
        payload.agent.isActive
          ? "Agente activado. Los demas quedaron inactivos."
          : "Agente desactivado.",
        "success",
      );
    } catch (error) {
      showFeedback(
        error instanceof Error ? error.message : "No pudimos cambiar el estado del agente.",
        "error",
      );
    }
  }

  async function removeAgent(agent: AutomationAgent) {
    if (!window.confirm(`Eliminar "${agent.name}"?`)) {
      return;
    }

    setDeletingAgentId(agent.id);

    try {
      const response = await fetch(`/api/automation/agents/${agent.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "No pudimos eliminar el agente.");
      }

      const nextAiConfig = { ...localAiConfig };
      delete nextAiConfig[agent.id];
      setLocalAiConfig(nextAiConfig);
      writeLocalAiConfig(nextAiConfig);
      await refreshAgents(null);
      showFeedback("Agente eliminado.", "success");
    } catch (error) {
      showFeedback(
        error instanceof Error ? error.message : "No pudimos eliminar el agente.",
        "error",
      );
    } finally {
      setDeletingAgentId(null);
    }
  }

  async function processJobsNow() {
    setProcessingJobs(true);

    try {
      const response = await fetch("/api/automation/dispatch", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            summary?: {
              claimed: number;
              sent: number;
              skipped: number;
              cancelled: number;
              retried: number;
              failed: number;
            };
            error?: string;
          }
        | null;

      if (!response.ok || !payload?.summary) {
        throw new Error(payload?.error || "No pudimos procesar los jobs.");
      }

      showFeedback(
        `Dispatcher ejecutado. Enviados: ${payload.summary.sent}, reintentados: ${payload.summary.retried}.`,
        "success",
      );
    } catch (error) {
      showFeedback(
        error instanceof Error ? error.message : "No pudimos procesar los jobs.",
        "error",
      );
    } finally {
      setProcessingJobs(false);
    }
  }

  function updateFlowDraft(
    updater: (current: AutomationAgentInput) => AutomationAgentInput,
  ) {
    setFlowDraft((current) => (current ? updater(current) : current));
  }

  function updateStage(
    stageIndex: number,
    updater: (stage: AutomationAgentInput["stages"][number]) => AutomationAgentInput["stages"][number],
  ) {
    updateFlowDraft((current) => ({
      ...current,
      stages: current.stages.map((stage, index) =>
        index === stageIndex ? updater(stage) : stage,
      ),
    }));
  }

  function updateMessage(
    stageIndex: number,
    messageIndex: number,
    updater: (
      message: AutomationAgentInput["stages"][number]["messages"][number],
    ) => AutomationAgentInput["stages"][number]["messages"][number],
  ) {
    updateStage(stageIndex, (stage) => ({
      ...stage,
      messages: stage.messages.map((message, index) =>
        index === messageIndex ? updater(message) : message,
      ),
    }));
  }

  function addStage() {
    updateFlowDraft((current) => ({
      ...current,
      stages: [
        ...current.stages,
        {
          name: `Etapa ${current.stages.length + 1}`,
          followupEnabled: false,
          followupDelayMinutes: 120,
          followupMessage: "",
          messages: [
            {
              messageType: "text",
              textContent: "",
              mediaUrl: "",
              delaySeconds: 0,
            },
          ],
        },
      ],
    }));
  }

  function removeStage(stageIndex: number) {
    updateFlowDraft((current) => ({
      ...current,
      stages: current.stages.filter((_, index) => index !== stageIndex),
    }));
  }

  function addMessage(stageIndex: number) {
    updateStage(stageIndex, (stage) => ({
      ...stage,
      messages: [
        ...stage.messages,
        {
          messageType: "text",
          textContent: "",
          mediaUrl: "",
          delaySeconds: 0,
        },
      ],
    }));
  }

  function removeMessage(stageIndex: number, messageIndex: number) {
    updateStage(stageIndex, (stage) => ({
      ...stage,
      messages: stage.messages.filter((_, index) => index !== messageIndex),
    }));
  }

  function persistLocalAi(agentId: string, nextValue: LocalAgentAiConfig) {
    const nextConfig = {
      ...localAiConfig,
      [agentId]: nextValue,
    };
    setLocalAiConfig(nextConfig);
    writeLocalAiConfig(nextConfig);
  }

  async function uploadAudioFile(file: File, targetKey: string) {
    setUploadingTargetKey(targetKey);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/instagram/media", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;

      if (!response.ok || !payload?.url) {
        throw new Error(payload?.error || "No pudimos subir el audio.");
      }

      return payload.url;
    } finally {
      setUploadingTargetKey(null);
    }
  }

  async function startRecording(stageIndex: number, messageIndex: number) {
    const targetKey = `${stageIndex}-${messageIndex}`;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      mediaChunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      setRecordingTargetKey(targetKey);

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) {
          mediaChunksRef.current.push(event.data);
        }
      });

      recorder.addEventListener("stop", async () => {
        const blob = new Blob(mediaChunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const file = new File([blob], `automation-${Date.now()}.webm`, {
          type: blob.type || "audio/webm",
        });

        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        setRecordingTargetKey(null);

        try {
          const url = await uploadAudioFile(file, targetKey);
          updateMessage(stageIndex, messageIndex, (message) => ({
            ...message,
            messageType: "audio",
            mediaUrl: url,
            textContent: "",
          }));
          showFeedback("Audio grabado y subido.", "success");
        } catch (error) {
          showFeedback(
            error instanceof Error ? error.message : "No pudimos grabar el audio.",
            "error",
          );
        }
      });

      recorder.start();
    } catch (error) {
      showFeedback(
        error instanceof Error ? error.message : "No pudimos acceder al microfono.",
        "error",
      );
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  }

  return (
    <div className="automation-page automation-blueprint page-stack">
      <section className="page-header automation-page-header">
        <div>
          <span className="eyebrow">Automatizaciones</span>
          <h1>Automatizaciones en respuestas y followup</h1>
          <p className="page-copy">
            genera respuestas en automatico y followups para generar conversaciones
            reales con tus clientes.
          </p>
        </div>

        <div className="automation-toolbar">
          <button type="button" className="button button-secondary" onClick={processJobsNow}>
            {processingJobs ? "Procesando..." : "Procesar ahora"}
          </button>
          <button type="button" className="button button-primary" onClick={openCreateModal}>
            Crear agente
          </button>
        </div>
      </section>

      <section className="automation-workspace surface">
        <div className="automation-workspace-top">
          <article className="automation-intro">
            <div>
              <strong>Un solo agente activo a la vez</strong>
              <p>
                Puedes crear todos los agentes que quieras, pero el backend solo deja uno
                activo para evitar cruces, duplicados y mensajes fuera de flujo.
              </p>
            </div>
          </article>

          <div className="automation-stats">
            <article className="automation-stat">
              <strong>{agents.length}</strong>
              <span>agentes</span>
            </article>
            <article className="automation-stat">
              <strong>{activeAgentsCount}</strong>
              <span>activos</span>
            </article>
          </div>
        </div>

        {feedback ? (
          <div className={`feedback ${feedbackTone}`}>{feedback}</div>
        ) : null}

        {agents.length === 0 ? (
          <div className="automation-empty-canvas">
            <div className="automation-empty-icon" aria-hidden="true">
              AI
            </div>
            <h2>Crea tu primer agente</h2>
            <p>
              Los agentes responden mensajes de Instagram automaticamente y siguen el
              flujo que configures por etapas, tiempos y followups.
            </p>
            <button type="button" className="button button-primary" onClick={openCreateModal}>
              Crear agente
            </button>
          </div>
        ) : (
          <div className="automation-workspace-body">
            <aside className="automation-agents-pane">
              <div className="automation-pane-header">
                <div>
                  <span className="eyebrow">Agentes</span>
                  <h2>Selecciona un agente</h2>
                  <p>Elige uno para editar su flujo, mensajes, audios y followups.</p>
                </div>
              </div>

              <div className="agent-grid">
                {agents.map((agent) => (
                  <article
                    key={agent.id}
                    className={selectedAgentId === agent.id ? "agent-card selected" : "agent-card"}
                  >
                    <div className="agent-card-top">
                      <div>
                        <h2>{agent.name || DEFAULT_AGENT_NAME}</h2>
                        <p>{getAgentCardSummary(agent)}</p>
                      </div>
                      <span
                        className={
                          agent.isActive ? "agent-status active" : "agent-status inactive"
                        }
                      >
                        {getAgentStatusLabel(agent)}
                      </span>
                    </div>

                    <p className="agent-card-copy">
                      {agent.personality || "Sin personalidad definida todavia."}
                    </p>

                    <div className="agent-card-actions">
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => setSelectedAgentId(agent.id)}
                      >
                        Abrir flujo
                      </button>
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => openEditModal(agent)}
                      >
                        Ajustes
                      </button>
                      <button
                        type="button"
                        className={agent.isActive ? "agent-toggle active" : "agent-toggle inactive"}
                        onClick={() => toggleAgent(agent)}
                      >
                        {agent.isActive ? "Desactivar" : "Activar"}
                      </button>
                      <button
                        type="button"
                        className="button button-danger"
                        onClick={() => removeAgent(agent)}
                        disabled={deletingAgentId === agent.id}
                      >
                        {deletingAgentId === agent.id ? "Eliminando..." : "Eliminar"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </aside>

            <section className="automation-flow-shell">
              {!selectedAgent || !flowDraft ? (
                <div className="automation-editor-empty">
                  <h2>Selecciona un agente</h2>
                  <p>
                    Abre el flujo de un agente para editar etapas, mensajes, audios y
                    followups.
                  </p>
                </div>
              ) : (
                <>
                  <div className="automation-flow-header">
                    <div>
                      <span className="eyebrow">Flujo</span>
                      <h2>{selectedAgent.name}</h2>
                      <p>
                        Cada respuesta inbound entra a la siguiente etapa pendiente del
                        agente activo y queda marcada para no repetir la misma etapa.
                      </p>
                    </div>

                    <div className="automation-flow-actions">
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={() => openEditModal(selectedAgent)}
                      >
                        Ajustes del agente
                      </button>
                      <button type="button" className="button button-primary" onClick={saveFlow}>
                        {savingFlow ? "Guardando..." : "Guardar flujo"}
                      </button>
                    </div>
                  </div>

                  <div className="stage-stack">
                    {flowDraft.stages.map((stage, stageIndex) => (
                      <article key={`${selectedAgent.id}-stage-${stageIndex}`} className="stage-card">
                        <div className="stage-card-top">
                          <div>
                            <span className="eyebrow">Etapa {stageIndex + 1}</span>
                            <input
                              className="text-input"
                              value={stage.name}
                              onChange={(event) =>
                                updateStage(stageIndex, (currentStage) => ({
                                  ...currentStage,
                                  name: event.target.value,
                                }))
                              }
                              placeholder={`Etapa ${stageIndex + 1}`}
                            />
                          </div>

                          <button
                            type="button"
                            className="button button-danger"
                            onClick={() => removeStage(stageIndex)}
                            disabled={flowDraft.stages.length === 1}
                          >
                            Quitar etapa
                          </button>
                        </div>

                        <div className="stage-message-stack">
                          {stage.messages.map((message, messageIndex) => {
                            const targetKey = `${stageIndex}-${messageIndex}`;
                            const isRecording = recordingTargetKey === targetKey;
                            const isUploading = uploadingTargetKey === targetKey;

                            return (
                              <article key={targetKey} className="stage-message-card">
                                <div className="stage-message-head">
                                  <strong>Mensaje {messageIndex + 1}</strong>
                                  <button
                                    type="button"
                                    className="button button-secondary"
                                    onClick={() => removeMessage(stageIndex, messageIndex)}
                                    disabled={stage.messages.length === 1}
                                  >
                                    Quitar
                                  </button>
                                </div>

                                <div className="stage-message-options">
                                  <button
                                    type="button"
                                    className={
                                      message.messageType === "text" ? "chip active" : "chip"
                                    }
                                    onClick={() =>
                                      updateMessage(stageIndex, messageIndex, (currentMessage) => ({
                                        ...currentMessage,
                                        messageType: "text",
                                        mediaUrl: "",
                                      }))
                                    }
                                  >
                                    Texto
                                  </button>
                                  <button
                                    type="button"
                                    className={
                                      message.messageType === "audio" ? "chip active" : "chip"
                                    }
                                    onClick={() =>
                                      updateMessage(stageIndex, messageIndex, (currentMessage) => ({
                                        ...currentMessage,
                                        messageType: "audio",
                                        textContent: "",
                                      }))
                                    }
                                  >
                                    Audio
                                  </button>
                                </div>

                                {message.messageType === "text" ? (
                                  <textarea
                                    className="text-area"
                                    value={message.textContent}
                                    onChange={(event) =>
                                      updateMessage(stageIndex, messageIndex, (currentMessage) => ({
                                        ...currentMessage,
                                        textContent: event.target.value,
                                      }))
                                    }
                                    placeholder="Escribe el mensaje de esta etapa"
                                  />
                                ) : (
                                  <div className="audio-builder">
                                    <div className="audio-builder-actions">
                                      <button
                                        type="button"
                                        className="button button-secondary"
                                        onClick={() =>
                                          isRecording
                                            ? stopRecording()
                                            : startRecording(stageIndex, messageIndex)
                                        }
                                      >
                                        {isRecording ? "Detener grabacion" : "Grabar audio"}
                                      </button>
                                      <label className="button button-secondary">
                                        Subir archivo
                                        <input
                                          type="file"
                                          accept="audio/*"
                                          className="visually-hidden"
                                          onChange={async (event) => {
                                            const file = event.target.files?.[0];

                                            if (!file) {
                                              return;
                                            }

                                            try {
                                              const url = await uploadAudioFile(file, targetKey);
                                              updateMessage(
                                                stageIndex,
                                                messageIndex,
                                                (currentMessage) => ({
                                                  ...currentMessage,
                                                  messageType: "audio",
                                                  mediaUrl: url,
                                                  textContent: "",
                                                }),
                                              );
                                              showFeedback("Audio subido.", "success");
                                            } catch (error) {
                                              showFeedback(
                                                error instanceof Error
                                                  ? error.message
                                                  : "No pudimos subir el audio.",
                                                "error",
                                              );
                                            } finally {
                                              event.target.value = "";
                                            }
                                          }}
                                        />
                                      </label>
                                    </div>

                                    <input
                                      className="text-input"
                                      value={message.mediaUrl}
                                      onChange={(event) =>
                                        updateMessage(stageIndex, messageIndex, (currentMessage) => ({
                                          ...currentMessage,
                                          mediaUrl: event.target.value,
                                        }))
                                      }
                                      placeholder="URL del audio subido"
                                    />
                                    <p className="muted">
                                      {isUploading
                                        ? "Subiendo audio..."
                                        : message.mediaUrl
                                          ? "Audio listo para enviarse en esta etapa."
                                          : "Puedes grabar o subir un audio para esta etapa."}
                                    </p>
                                  </div>
                                )}

                                <div className="field">
                                  <span className="field-label">
                                    Delay despues de este mensaje (segundos)
                                  </span>
                                  <input
                                    className="text-input"
                                    type="number"
                                    min={0}
                                    value={message.delaySeconds}
                                    onChange={(event) =>
                                      updateMessage(stageIndex, messageIndex, (currentMessage) => ({
                                        ...currentMessage,
                                        delaySeconds: Number(event.target.value || 0),
                                      }))
                                    }
                                  />
                                </div>
                              </article>
                            );
                          })}
                        </div>

                        <div className="stage-footer-actions">
                          <button
                            type="button"
                            className="button button-secondary"
                            onClick={() => addMessage(stageIndex)}
                          >
                            Agregar mensaje
                          </button>
                        </div>

                        <div className="stage-followup">
                          <div className="stage-followup-top">
                            <strong>Followup</strong>
                            <button
                              type="button"
                              className={
                                stage.followupEnabled ? "agent-toggle active" : "agent-toggle inactive"
                              }
                              onClick={() =>
                                updateStage(stageIndex, (currentStage) => ({
                                  ...currentStage,
                                  followupEnabled: !currentStage.followupEnabled,
                                }))
                              }
                            >
                              {stage.followupEnabled ? "Activo" : "Inactivo"}
                            </button>
                          </div>

                          <div className="stage-followup-grid">
                            <div className="field">
                              <span className="field-label">
                                Enviar followup si pasan estos minutos sin respuesta
                              </span>
                              <input
                                className="text-input"
                                type="number"
                                min={0}
                                value={stage.followupDelayMinutes}
                                onChange={(event) =>
                                  updateStage(stageIndex, (currentStage) => ({
                                    ...currentStage,
                                    followupDelayMinutes: Number(event.target.value || 0),
                                  }))
                                }
                              />
                            </div>

                            <div className="field">
                              <span className="field-label">Mensaje de followup</span>
                              <textarea
                                className="text-area"
                                value={stage.followupMessage}
                                onChange={(event) =>
                                  updateStage(stageIndex, (currentStage) => ({
                                    ...currentStage,
                                    followupMessage: event.target.value,
                                  }))
                                }
                                placeholder="Mensaje de followup para esta etapa"
                              />
                            </div>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>

                  <div className="stage-footer-actions">
                    <button type="button" className="button button-secondary" onClick={addStage}>
                      Agregar etapa
                    </button>
                  </div>

                  <article className="ai-card">
                    <div className="stage-followup-top">
                      <div>
                        <span className="eyebrow">Activar IA</span>
                        <h3>Prompt y clave local por navegador</h3>
                      </div>
                      <button
                        type="button"
                        className={
                          flowDraft.aiEnabled ? "agent-toggle active" : "agent-toggle inactive"
                        }
                        onClick={() =>
                          updateFlowDraft((current) => ({
                            ...current,
                            aiEnabled: !current.aiEnabled,
                          }))
                        }
                      >
                        {flowDraft.aiEnabled ? "Activa" : "Inactiva"}
                      </button>
                    </div>

                    {flowDraft.aiEnabled ? (
                      <div className="stage-followup-grid">
                        <div className="field">
                          <span className="field-label">API key local</span>
                          <input
                            className="text-input"
                            type="password"
                            value={localAiConfig[selectedAgent.id]?.apiKey ?? ""}
                            onChange={(event) =>
                              persistLocalAi(selectedAgent.id, {
                                apiKey: event.target.value,
                              })
                            }
                            placeholder="Se guarda en este navegador"
                          />
                          <p className="muted">
                            Esta clave queda guardada en el browser del usuario actual, no en
                            la base de datos del proyecto.
                          </p>
                        </div>

                        <div className="field">
                          <span className="field-label">Prompt del agente</span>
                          <textarea
                            className="text-area"
                            value={flowDraft.aiPrompt}
                            onChange={(event) =>
                              updateFlowDraft((current) => ({
                                ...current,
                                aiPrompt: event.target.value,
                              }))
                            }
                            placeholder="Prompt para guiar las respuestas con IA"
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="muted">
                        Activa IA si quieres dejar listo un prompt propio y una API key local
                        para este navegador.
                      </p>
                    )}
                  </article>
                </>
              )}
            </section>
          </div>
        )}
      </section>

      {modalOpen ? (
        <div className="automation-modal-backdrop" role="presentation">
          <div className="automation-modal surface" role="dialog" aria-modal="true">
            <div className="automation-modal-header">
              <div>
                <span className="eyebrow">
                  {modalMode === "create" ? "Nuevo agente" : "Editar agente"}
                </span>
                <h2>
                  {modalMode === "create"
                    ? "Configurar agente"
                    : modalDraft.name || DEFAULT_AGENT_NAME}
                </h2>
              </div>
            </div>

            <div className="automation-modal-grid">
              <div className="field">
                <span className="field-label">Nombre</span>
                <input
                  className="text-input"
                  value={modalDraft.name}
                  onChange={(event) =>
                    setModalDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="Nombre del agente"
                />
              </div>

              <div className="field">
                <span className="field-label">Personalidad</span>
                <textarea
                  className="text-area"
                  value={modalDraft.personality}
                  onChange={(event) =>
                    setModalDraft((current) => ({
                      ...current,
                      personality: event.target.value,
                    }))
                  }
                  placeholder="Describe como debe responder este agente"
                />
              </div>

              <div className="field">
                <span className="field-label">Retraso minimo de respuesta (segundos)</span>
                <input
                  className="text-input"
                  type="number"
                  min={0}
                  value={modalDraft.minReplyDelaySeconds}
                  onChange={(event) =>
                    setModalDraft((current) => ({
                      ...current,
                      minReplyDelaySeconds: Number(event.target.value || 0),
                    }))
                  }
                />
              </div>

              <div className="field">
                <span className="field-label">Retraso maximo de respuesta (segundos)</span>
                <input
                  className="text-input"
                  type="number"
                  min={0}
                  value={modalDraft.maxReplyDelaySeconds}
                  onChange={(event) =>
                    setModalDraft((current) => ({
                      ...current,
                      maxReplyDelaySeconds: Number(event.target.value || 0),
                    }))
                  }
                />
              </div>

              <div className="field">
                <span className="field-label">Maximo de contenido multimedia por chat</span>
                <input
                  className="text-input"
                  type="number"
                  min={0}
                  value={modalDraft.maxMediaPerChat}
                  onChange={(event) =>
                    setModalDraft((current) => ({
                      ...current,
                      maxMediaPerChat: Number(event.target.value || 0),
                    }))
                  }
                />
              </div>
            </div>

            <div className="automation-modal-actions">
              <button type="button" className="button button-secondary" onClick={closeModal}>
                Cerrar
              </button>
              <button type="button" className="button button-primary" onClick={saveBasicSettings}>
                {savingBasic ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
