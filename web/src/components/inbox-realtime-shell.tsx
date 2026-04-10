"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type {
  ConversationRecord,
  InstagramAccountRecord,
  MessageRecord,
  ReminderRecord,
} from "@/lib/shared-data";
import {
  formatDateTime,
  formatRelativeTime,
  getConversationDisplayName,
  getConversationLabels,
  getConversationPreview,
  getMessagePreview,
} from "@/lib/shared-data";
import { createClient } from "@/lib/supabase/client";

type InboxRealtimeShellProps = {
  userId: string;
  initialAccounts: InstagramAccountRecord[];
  initialConversations: ConversationRecord[];
  initialMessages: MessageRecord[];
  initialReminders: ReminderRecord[];
  initialSelectedConversationId: string | null;
};

type SendMode = "text" | "audio";

function sortConversations(conversations: ConversationRecord[]) {
  return [...conversations].sort((left, right) => {
    const rightTimestamp =
      new Date(
        right.last_message_at ?? right.updated_at ?? right.created_at ?? 0,
      ).getTime() || 0;
    const leftTimestamp =
      new Date(
        left.last_message_at ?? left.updated_at ?? left.created_at ?? 0,
      ).getTime() || 0;

    return rightTimestamp - leftTimestamp;
  });
}

function sortMessages(messages: MessageRecord[]) {
  return [...messages].sort((left, right) => {
    const leftTimestamp = new Date(left.sent_at ?? left.created_at ?? 0).getTime() || 0;
    const rightTimestamp = new Date(right.sent_at ?? right.created_at ?? 0).getTime() || 0;

    return leftTimestamp - rightTimestamp;
  });
}

function sortReminders(reminders: ReminderRecord[]) {
  return [...reminders].sort((left, right) => {
    return new Date(left.remind_at).getTime() - new Date(right.remind_at).getTime();
  });
}

function upsertById<T extends { id: string }>(items: T[], nextItem: T) {
  const exists = items.some((item) => item.id === nextItem.id);

  if (!exists) {
    return [nextItem, ...items];
  }

  return items.map((item) => (item.id === nextItem.id ? nextItem : item));
}

function removeById<T extends { id: string }>(items: T[], id: string) {
  return items.filter((item) => item.id !== id);
}

export function InboxRealtimeShell({
  userId,
  initialAccounts,
  initialConversations,
  initialMessages,
  initialReminders,
  initialSelectedConversationId,
}: InboxRealtimeShellProps) {
  const clientRef = useRef<ReturnType<typeof createClient>>();
  const selectedConversationRef = useRef<string | null>(initialSelectedConversationId);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [conversations, setConversations] = useState(
    sortConversations(initialConversations),
  );
  const [messages, setMessages] = useState(sortMessages(initialMessages));
  const [reminders, setReminders] = useState(sortReminders(initialReminders));
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    initialSelectedConversationId,
  );
  const [search, setSearch] = useState("");
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [labelsDraft, setLabelsDraft] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [reminderTitle, setReminderTitle] = useState("");
  const [reminderAt, setReminderAt] = useState("");
  const [reminderNote, setReminderNote] = useState("");
  const [composerText, setComposerText] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [feedbackTone, setFeedbackTone] = useState<"success" | "error">("success");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [creatingReminder, setCreatingReminder] = useState(false);
  const [sendMode, setSendMode] = useState<SendMode>("text");
  const [sendingMessage, setSendingMessage] = useState(false);

  if (!clientRef.current) {
    clientRef.current = createClient();
  }

  useEffect(() => {
    selectedConversationRef.current = selectedConversationId;
  }, [selectedConversationId]);

  const selectedConversation =
    conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;
  const selectedAccount =
    accounts.find((account) => account.id === selectedConversation?.account_id) ?? null;
  const accountUsernameMap = useMemo(() => {
    return new Map(accounts.map((account) => [account.id, account.username]));
  }, [accounts]);

  useEffect(() => {
    if (!selectedConversation) {
      setLabelsDraft([]);
      setNotesDraft("");
      return;
    }

    setLabelsDraft(getConversationLabels(selectedConversation.labels));
    setNotesDraft(selectedConversation.notes ?? "");
  }, [selectedConversationId, selectedConversation]);

  useEffect(() => {
    if (!selectedConversationId) {
      setMessages([]);
      return;
    }

    if (
      selectedConversationId === initialSelectedConversationId &&
      initialMessages.length > 0
    ) {
      setMessages(sortMessages(initialMessages));
      return;
    }

    const supabase = clientRef.current!;
    let cancelled = false;

    async function loadMessages() {
      setLoadingMessages(true);

      const result = await supabase
        .from("instagram_messages")
        .select("*")
        .eq("conversation_id", selectedConversationId)
        .order("created_at", { ascending: true })
        .limit(300);

      if (cancelled) {
        return;
      }

      setLoadingMessages(false);

      if (!result.error && result.data) {
        setMessages(sortMessages(result.data as MessageRecord[]));
      }
    }

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [initialMessages, initialSelectedConversationId, selectedConversationId]);

  useEffect(() => {
    if (!selectedConversationId && conversations.length > 0) {
      setSelectedConversationId(conversations[0].id);
    }
  }, [conversations, selectedConversationId]);

  useEffect(() => {
    const supabase = clientRef.current!;

    const accountsChannel = supabase
      .channel(`instagram-accounts-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "instagram_accounts",
          filter: `owner_id=eq.${userId}`,
        },
        (payload) => {
          const account = (payload.new || payload.old) as InstagramAccountRecord | undefined;

          if (!account) {
            return;
          }

          if (payload.eventType === "DELETE") {
            setAccounts((current) => removeById(current, account.id));
            return;
          }

          setAccounts((current) => upsertById(current, account));
        },
      )
      .subscribe();

    const conversationsChannel = supabase
      .channel(`instagram-conversations-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "instagram_conversations",
          filter: `owner_id=eq.${userId}`,
        },
        (payload) => {
          const conversation = (payload.new || payload.old) as ConversationRecord | undefined;

          if (!conversation) {
            return;
          }

          if (payload.eventType === "DELETE") {
            setConversations((current) => removeById(current, conversation.id));

            if (selectedConversationRef.current === conversation.id) {
              setSelectedConversationId(null);
              setMessages([]);
            }

            return;
          }

          setConversations((current) => sortConversations(upsertById(current, conversation)));
        },
      )
      .subscribe();

    const messagesChannel = supabase
      .channel(`instagram-messages-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "instagram_messages",
          filter: `owner_id=eq.${userId}`,
        },
        (payload) => {
          const message = (payload.new || payload.old) as MessageRecord | undefined;

          if (!message || message.conversation_id !== selectedConversationRef.current) {
            return;
          }

          if (payload.eventType === "DELETE") {
            setMessages((current) => removeById(current, message.id));
            return;
          }

          setMessages((current) => sortMessages(upsertById(current, message)));
        },
      )
      .subscribe();

    const remindersChannel = supabase
      .channel(`instagram-reminders-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "instagram_reminders",
          filter: `owner_id=eq.${userId}`,
        },
        (payload) => {
          const reminder = (payload.new || payload.old) as ReminderRecord | undefined;

          if (!reminder) {
            return;
          }

          if (payload.eventType === "DELETE") {
            setReminders((current) => removeById(current, reminder.id));
            return;
          }

          setReminders((current) => sortReminders(upsertById(current, reminder)));
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(accountsChannel);
      void supabase.removeChannel(conversationsChannel);
      void supabase.removeChannel(messagesChannel);
      void supabase.removeChannel(remindersChannel);
    };
  }, [userId]);

  const allLabels = useMemo(() => {
    return Array.from(
      new Set(
        conversations.flatMap((conversation) => getConversationLabels(conversation.labels)),
      ),
    ).sort((left, right) => left.localeCompare(right));
  }, [conversations]);

  const filteredConversations = useMemo(() => {
    return conversations.filter((conversation) => {
      const displayName = getConversationDisplayName(conversation).toLowerCase();
      const accountUsername = (
        accountUsernameMap.get(conversation.account_id) ??
        conversation.account_username ??
        ""
      ).toLowerCase();
      const preview = getConversationPreview(conversation).toLowerCase();
      const searchTerm = search.trim().toLowerCase();
      const matchesSearch =
        !searchTerm ||
        displayName.includes(searchTerm) ||
        accountUsername.includes(searchTerm) ||
        preview.includes(searchTerm);
      const matchesLabel =
        !activeLabel ||
        getConversationLabels(conversation.labels).includes(activeLabel);

      return matchesSearch && matchesLabel;
    });
  }, [accountUsernameMap, activeLabel, conversations, search]);

  const selectedConversationReminders = useMemo(() => {
    if (!selectedConversation) {
      return [];
    }

    return reminders.filter((reminder) => reminder.conversation_id === selectedConversation.id);
  }, [reminders, selectedConversation]);

  const dueReminders = useMemo(() => {
    const now = Date.now();

    return reminders.filter((reminder) => {
      return reminder.status === "pending" && new Date(reminder.remind_at).getTime() <= now;
    });
  }, [reminders]);

  function showFeedback(message: string, tone: "success" | "error") {
    setFeedback(message);
    setFeedbackTone(tone);
  }

  function addLabel() {
    const nextLabel = labelInput.trim();

    if (!nextLabel) {
      return;
    }

    setLabelsDraft((current) => {
      if (current.includes(nextLabel)) {
        return current;
      }

      return [...current, nextLabel];
    });
    setLabelInput("");
  }

  async function saveConversationDetails() {
    if (!selectedConversation) {
      return;
    }

    setSavingDetails(true);
    setFeedback(null);

    try {
      const response = await fetch(
        `/api/instagram/conversations/${selectedConversation.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            labels: labelsDraft,
            notes: notesDraft,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error || "No pudimos guardar los cambios.");
      }

      setConversations((current) =>
        sortConversations(
          current.map((conversation) =>
            conversation.id === selectedConversation.id
              ? {
                  ...conversation,
                  labels: labelsDraft,
                  notes: notesDraft,
                }
              : conversation,
          ),
        ),
      );
      showFeedback("Etiquetas y notas actualizadas.", "success");
    } catch (error) {
      showFeedback(
        error instanceof Error ? error.message : "No pudimos guardar los cambios.",
        "error",
      );
    } finally {
      setSavingDetails(false);
    }
  }

  async function createReminder() {
    if (!selectedConversation || !reminderTitle.trim() || !reminderAt) {
      return;
    }

    setCreatingReminder(true);
    setFeedback(null);

    try {
      const response = await fetch("/api/instagram/reminders", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          title: reminderTitle.trim(),
          note: reminderNote.trim(),
          remindAt: new Date(reminderAt).toISOString(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error || "No pudimos crear el recordatorio.");
      }

      setReminderTitle("");
      setReminderAt("");
      setReminderNote("");
      showFeedback("Recordatorio creado.", "success");
    } catch (error) {
      showFeedback(
        error instanceof Error ? error.message : "No pudimos crear el recordatorio.",
        "error",
      );
    } finally {
      setCreatingReminder(false);
    }
  }

  async function dismissReminder(reminderId: string) {
    try {
      const response = await fetch(`/api/instagram/reminders/${reminderId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "dismissed" }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error || "No pudimos descartar el recordatorio.");
      }

      showFeedback("Recordatorio descartado.", "success");
    } catch (error) {
      showFeedback(
        error instanceof Error
          ? error.message
          : "No pudimos descartar el recordatorio.",
        "error",
      );
    }
  }

  async function sendMessage() {
    if (!selectedConversation) {
      return;
    }

    if (sendMode === "text" && !composerText.trim()) {
      return;
    }

    if (sendMode === "audio" && !audioFile) {
      return;
    }

    setSendingMessage(true);
    setFeedback(null);

    try {
      let mediaUrl: string | undefined;

      if (sendMode === "audio" && audioFile) {
        const uploadForm = new FormData();
        uploadForm.append("file", audioFile);

        const uploadResponse = await fetch("/api/instagram/media", {
          method: "POST",
          body: uploadForm,
        });
        const uploadPayload = (await uploadResponse.json().catch(() => null)) as
          | { error?: string; url?: string }
          | null;

        if (!uploadResponse.ok || !uploadPayload?.url) {
          throw new Error(uploadPayload?.error || "No pudimos subir el audio.");
        }

        mediaUrl = uploadPayload.url;
      }

      const response = await fetch("/api/instagram/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          conversationId: selectedConversation.id,
          text: sendMode === "text" ? composerText.trim() : undefined,
          messageType: sendMode,
          mediaUrl,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(payload?.error || "No pudimos enviar el mensaje.");
      }

      setComposerText("");
      setAudioFile(null);
      showFeedback(sendMode === "audio" ? "Audio enviado." : "Mensaje enviado.", "success");
    } catch (error) {
      showFeedback(
        error instanceof Error ? error.message : "No pudimos enviar el mensaje.",
        "error",
      );
    } finally {
      setSendingMessage(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <span className="eyebrow">Inbox</span>
          <h1>Inbox unificado de Instagram</h1>
          <p className="page-copy">
            Conversaciones de todas las cuentas conectadas, en tiempo real, con
            historial persistente en Supabase.
          </p>
        </div>
        <div className="surface stat-pill">
          <strong>{filteredConversations.length}</strong>
          <span>conversaciones visibles</span>
        </div>
      </section>

      {dueReminders.length > 0 ? (
        <section className="surface reminder-banner">
          <div>
            <span className="eyebrow">Notificaciones</span>
            <h2>{dueReminders.length} recordatorio(s) pendiente(s)</h2>
            <p className="page-copy">
              Estos seguimientos ya vencieron y estan visibles dentro de la app.
            </p>
          </div>
          <div className="notice-list">
            {dueReminders.slice(0, 4).map((reminder) => {
              const reminderConversation = conversations.find(
                (conversation) => conversation.id === reminder.conversation_id,
              );

              return (
                <div key={reminder.id} className="notice-item">
                  <div>
                    <strong>{reminder.title}</strong>
                    <p>
                      {reminderConversation
                        ? getConversationDisplayName(reminderConversation)
                        : "Conversacion"}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void dismissReminder(reminder.id)}
                  >
                    Descartar
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {feedback ? (
        <div className={feedbackTone === "success" ? "feedback success" : "feedback error"}>
          {feedback}
        </div>
      ) : null}

      <section className="inbox-shell">
        <aside className="surface inbox-column inbox-column-list">
          <div className="inbox-toolbar">
            <label className="field-label" htmlFor="thread-search">
              Buscar
            </label>
            <input
              id="thread-search"
              className="text-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Usuario, cuenta o mensaje"
            />
          </div>

          <div className="tag-row">
            <button
              type="button"
              className={!activeLabel ? "chip active" : "chip"}
              onClick={() => setActiveLabel(null)}
            >
              Todas
            </button>
            {allLabels.map((label) => (
              <button
                key={label}
                type="button"
                className={activeLabel === label ? "chip active" : "chip"}
                onClick={() => setActiveLabel(label)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="thread-list">
            {filteredConversations.length === 0 ? (
              <div className="empty-state compact">
                <strong>Sin conversaciones</strong>
                <p>Cuando lleguen mensajes por Meta, apareceran aqui al instante.</p>
              </div>
            ) : null}

            {filteredConversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={
                  conversation.id === selectedConversationId
                    ? "thread-card active"
                    : "thread-card"
                }
                onClick={() => setSelectedConversationId(conversation.id)}
              >
                <div className="thread-card-top">
                  <strong>{getConversationDisplayName(conversation)}</strong>
                  <span>{formatRelativeTime(conversation.last_message_at)}</span>
                </div>
                <span className="thread-account">
                  @{
                    accountUsernameMap.get(conversation.account_id) ??
                    conversation.account_username ??
                    "cuenta"
                  }
                </span>
                <p>{getConversationPreview(conversation)}</p>
                <div className="thread-meta">
                  <span>
                    {getConversationLabels(conversation.labels).join(", ") || "Sin etiquetas"}
                  </span>
                  <span>{conversation.unread_count ?? 0} sin leer</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="surface inbox-column inbox-column-thread">
          <div className="conversation-header">
            <div>
              <span className="eyebrow">Conversacion</span>
              <h2>
                {selectedConversation
                  ? getConversationDisplayName(selectedConversation)
                  : "Selecciona un chat"}
              </h2>
              <p className="page-copy">
                {selectedConversation
                  ? `Cuenta @${
                      accountUsernameMap.get(selectedConversation.account_id) ??
                      selectedConversation.account_username ??
                      "cuenta"
                    } - ${selectedConversation.last_message_type || "texto"}`
                  : "Elige una conversacion para ver el historial y responder."}
              </p>
            </div>
            {selectedConversation ? (
              <span className="status-inline">
                Ultimo mensaje {formatRelativeTime(selectedConversation.last_message_at)}
              </span>
            ) : null}
          </div>

          <div className="message-list">
            {loadingMessages ? (
              <div className="empty-state compact">
                <strong>Cargando mensajes</strong>
                <p>Sincronizando el historial guardado en Supabase.</p>
              </div>
            ) : null}

            {!loadingMessages && selectedConversation && messages.length === 0 ? (
              <div className="empty-state compact">
                <strong>Sin historial todavia</strong>
                <p>Cuando Meta entregue mensajes o respuestas, se van a persistir aqui.</p>
              </div>
            ) : null}

            {!loadingMessages && !selectedConversation ? (
              <div className="empty-state compact">
                <strong>Selecciona una conversacion</strong>
                <p>La columna izquierda agrupa los hilos de todas tus cuentas conectadas.</p>
              </div>
            ) : null}

            {!loadingMessages
              ? messages.map((message) => (
                  <article
                    key={message.id}
                    className={
                      message.direction === "out"
                        ? "message-bubble outgoing"
                        : "message-bubble incoming"
                    }
                  >
                    <div className="message-meta">
                      <span>{message.direction === "out" ? "Tu equipo" : "Instagram"}</span>
                      <span>{formatDateTime(message.sent_at ?? message.created_at)}</span>
                    </div>
                    {message.message_type === "audio" && message.media_url ? (
                      <audio controls src={message.media_url} className="message-audio" />
                    ) : (
                      <p>{getMessagePreview(message)}</p>
                    )}
                  </article>
                ))
              : null}
          </div>

          <div className="composer">
            <div className="tag-row">
              <button
                type="button"
                className={sendMode === "text" ? "chip active" : "chip"}
                onClick={() => setSendMode("text")}
              >
                Texto
              </button>
              <button
                type="button"
                className={sendMode === "audio" ? "chip active" : "chip"}
                onClick={() => setSendMode("audio")}
              >
                Audio
              </button>
            </div>

            {sendMode === "text" ? (
              <textarea
                className="text-area"
                placeholder={
                  selectedConversation
                    ? "Escribe una respuesta para esta conversacion."
                    : "Selecciona una conversacion para responder."
                }
                value={composerText}
                onChange={(event) => setComposerText(event.target.value)}
                disabled={!selectedConversation || sendingMessage}
              />
            ) : (
              <label className="upload-field">
                <span className="field-label">Adjuntar audio</span>
                <input
                  type="file"
                  accept="audio/*"
                  onChange={(event) =>
                    setAudioFile(event.target.files?.[0] ?? null)
                  }
                  disabled={!selectedConversation || sendingMessage}
                />
                <span className="status-copy">
                  {audioFile ? audioFile.name : "Acepta audio/mpeg, mp4, wav o m4a"}
                </span>
              </label>
            )}

            <button
              type="button"
              className="button button-primary"
              disabled={
                !selectedConversation ||
                sendingMessage ||
                (sendMode === "text" ? !composerText.trim() : !audioFile)
              }
              onClick={() => void sendMessage()}
            >
              {sendingMessage
                ? sendMode === "audio"
                  ? "Enviando audio..."
                  : "Enviando..."
                : sendMode === "audio"
                  ? "Enviar audio"
                  : "Enviar mensaje"}
            </button>
          </div>
        </section>

        <aside className="surface inbox-column inbox-column-tags">
          <div className="panel-section">
            <span className="eyebrow">Detalles</span>
            <h3>
              {selectedConversation
                ? getConversationDisplayName(selectedConversation)
                : "Sin conversacion seleccionada"}
            </h3>
            <p className="page-copy">
              Etiquetas, notas internas y recordatorios visibles para el equipo.
            </p>
          </div>

          {selectedConversation ? (
            <>
              <div className="panel-section top-border">
                <span className="field-label">Etiquetas</span>
                <div className="tag-row compact">
                  {labelsDraft.length === 0 ? (
                    <span className="chip passive">Sin etiquetas</span>
                  ) : (
                    labelsDraft.map((label) => (
                      <button
                        key={label}
                        type="button"
                        className="chip active"
                        onClick={() =>
                          setLabelsDraft((current) =>
                            current.filter((item) => item !== label),
                          )
                        }
                      >
                        {label} x
                      </button>
                    ))
                  )}
                </div>
                <div className="inline-form">
                  <input
                    className="text-input"
                    value={labelInput}
                    onChange={(event) => setLabelInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addLabel();
                      }
                    }}
                    placeholder="Agregar etiqueta"
                  />
                  <button type="button" className="button button-secondary" onClick={addLabel}>
                    Agregar
                  </button>
                </div>
              </div>

              <div className="panel-section top-border">
                <span className="field-label">Notas</span>
                <textarea
                  className="text-area notes-area"
                  value={notesDraft}
                  onChange={(event) => setNotesDraft(event.target.value)}
                  placeholder="Contexto interno, acuerdos, proximos pasos..."
                />
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => void saveConversationDetails()}
                  disabled={savingDetails}
                >
                  {savingDetails ? "Guardando..." : "Guardar detalles"}
                </button>
              </div>

              <div className="panel-section top-border">
                <span className="field-label">Recordatorios</span>
                <div className="form-stack compact-form">
                  <input
                    className="text-input"
                    value={reminderTitle}
                    onChange={(event) => setReminderTitle(event.target.value)}
                    placeholder="Llamar, volver a escribir, enviar propuesta..."
                  />
                  <input
                    className="text-input"
                    type="datetime-local"
                    value={reminderAt}
                    onChange={(event) => setReminderAt(event.target.value)}
                  />
                  <textarea
                    className="text-area notes-area"
                    value={reminderNote}
                    onChange={(event) => setReminderNote(event.target.value)}
                    placeholder="Nota opcional"
                  />
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => void createReminder()}
                    disabled={creatingReminder}
                  >
                    {creatingReminder ? "Creando..." : "Crear recordatorio"}
                  </button>
                </div>

                <div className="tag-stack">
                  {selectedConversationReminders.length === 0 ? (
                    <div className="empty-state compact">
                      <strong>Sin recordatorios</strong>
                      <p>Programa seguimientos con fecha y hora para esta conversacion.</p>
                    </div>
                  ) : (
                    selectedConversationReminders.map((reminder) => (
                      <div key={reminder.id} className="tag-card static-card">
                        <strong>{reminder.title}</strong>
                        <span>{formatDateTime(reminder.remind_at)}</span>
                        <p>{reminder.note || "Sin nota adicional"}</p>
                        <div className="tag-row compact">
                          <span
                            className={
                              reminder.status === "dismissed" ? "chip passive" : "chip active"
                            }
                          >
                            {reminder.status}
                          </span>
                          {reminder.status !== "dismissed" ? (
                            <button
                              type="button"
                              className="button button-secondary"
                              onClick={() => void dismissReminder(reminder.id)}
                            >
                              Descartar
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="panel-section top-border">
                <span className="eyebrow">Contexto</span>
                <div className="detail-list">
                  <div className="detail-row">
                    <span>Cuenta</span>
                    <strong>{selectedAccount ? `@${selectedAccount.username}` : "-"}</strong>
                  </div>
                  <div className="detail-row">
                    <span>IGSID</span>
                    <strong>{selectedConversation.contact_igsid}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Ultima actividad</span>
                    <strong>{formatDateTime(selectedConversation.last_message_at)}</strong>
                  </div>
                  <div className="detail-row">
                    <span>Sin leer</span>
                    <strong>{selectedConversation.unread_count ?? 0}</strong>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="empty-state compact">
              <strong>Panel listo</strong>
              <p>Selecciona una conversacion para editar etiquetas, notas y recordatorios.</p>
            </div>
          )}
        </aside>
      </section>
    </div>
  );
}
