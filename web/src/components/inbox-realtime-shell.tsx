"use client";

import { useEffect, useRef, useState } from "react";

import type {
  AccountRecord,
  ChatRecord,
  ThreadSummary,
} from "@/lib/shared-data";
import {
  buildThreadKey,
  extractTags,
  formatDateTime,
  formatRelativeTime,
} from "@/lib/shared-data";
import { createClient } from "@/lib/supabase/client";

type InboxRealtimeShellProps = {
  userId: string;
  initialAccounts: AccountRecord[];
  initialThreads: ThreadSummary[];
  initialMessages: ChatRecord[];
  initialSelectedThreadKey: string | null;
};

function sortByTimestamp(messages: ChatRecord[]) {
  return [...messages].sort((left, right) => left.timestamp - right.timestamp);
}

function upsertThread(
  threads: ThreadSummary[],
  message: ChatRecord,
  accounts: AccountRecord[],
) {
  const threadKey = buildThreadKey(message.account_id, message.thread_id);
  const account = accounts.find((item) => item.id === message.account_id);
  const tags = extractTags(message.tags);
  const existing = threads.find((thread) => thread.threadKey === threadKey);

  if (!existing) {
    return [
      {
        threadKey,
        threadId: message.thread_id,
        accountId: message.account_id,
        accountUsername: account?.username ?? `Cuenta ${message.account_id}`,
        username: message.username || "Sin nombre",
        lastMessage: message.message || "Sin contenido",
        lastTimestamp: message.timestamp,
        messageCount: 1,
        inboundCount: message.direction === "in" ? 1 : 0,
        outboundCount: message.direction === "out" ? 1 : 0,
        tags,
      },
      ...threads,
    ].sort((left, right) => right.lastTimestamp - left.lastTimestamp);
  }

  const nextThreads = threads.map((thread) => {
    if (thread.threadKey !== threadKey) {
      return thread;
    }

    const nextTags = [...thread.tags];
    for (const tag of tags) {
      if (!nextTags.includes(tag)) {
        nextTags.push(tag);
      }
    }

    return {
      ...thread,
      username: message.username || thread.username,
      lastMessage: message.message || thread.lastMessage,
      lastTimestamp: Math.max(thread.lastTimestamp, message.timestamp),
      messageCount: thread.messageCount + 1,
      inboundCount: thread.inboundCount + (message.direction === "in" ? 1 : 0),
      outboundCount: thread.outboundCount + (message.direction === "out" ? 1 : 0),
      tags: nextTags,
    };
  });

  return nextThreads.sort((left, right) => right.lastTimestamp - left.lastTimestamp);
}

function removeMessage(messages: ChatRecord[], messageId: number) {
  return messages.filter((message) => message.id !== messageId);
}

export function InboxRealtimeShell({
  userId,
  initialAccounts,
  initialThreads,
  initialMessages,
  initialSelectedThreadKey,
}: InboxRealtimeShellProps) {
  const clientRef = useRef<ReturnType<typeof createClient>>();
  const accountsRef = useRef(initialAccounts);
  const accountIdsRef = useRef(new Set(initialAccounts.map((account) => account.id)));
  const selectedThreadRef = useRef<string | null>(initialSelectedThreadKey);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [threads, setThreads] = useState(initialThreads);
  const [messages, setMessages] = useState(sortByTimestamp(initialMessages));
  const [selectedThreadKey, setSelectedThreadKey] = useState<string | null>(
    initialSelectedThreadKey,
  );
  const [loadingThread, setLoadingThread] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  if (!clientRef.current) {
    clientRef.current = createClient();
  }

  useEffect(() => {
    accountsRef.current = accounts;
    accountIdsRef.current = new Set(accounts.map((account) => account.id));
  }, [accounts]);

  useEffect(() => {
    selectedThreadRef.current = selectedThreadKey;
  }, [selectedThreadKey]);

  useEffect(() => {
    const selectedThread = threads.find((thread) => thread.threadKey === selectedThreadKey);

    if (!selectedThread) {
      setMessages([]);
      return;
    }

    const activeThread = selectedThread;
    const supabase = clientRef.current!;
    let cancelled = false;

    async function loadMessages() {
      setLoadingThread(true);

      const { data, error } = await supabase
        .from("chats")
        .select("*")
        .eq("account_id", activeThread.accountId)
        .eq("thread_id", activeThread.threadId)
        .order("timestamp", { ascending: true })
        .limit(300);

      if (!cancelled) {
        setLoadingThread(false);
        if (!error && data) {
          setMessages(sortByTimestamp(data as ChatRecord[]));
        }
      }
    }

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [selectedThreadKey, threads]);

  useEffect(() => {
    const supabase = clientRef.current!;

    const chatsChannel = supabase
      .channel(`inbox-chats-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chats" },
        (payload) => {
          const nextRow = (payload.new || payload.old) as ChatRecord | undefined;

          if (!nextRow || !accountIdsRef.current.has(nextRow.account_id)) {
            return;
          }

          if (payload.eventType === "INSERT") {
            setThreads((current) => upsertThread(current, nextRow, accountsRef.current));

            if (
              selectedThreadRef.current ===
              buildThreadKey(nextRow.account_id, nextRow.thread_id)
            ) {
              setMessages((current) => {
                if (current.some((message) => message.id === nextRow.id)) {
                  return current;
                }

                return sortByTimestamp([...current, nextRow]);
              });
            }

            if (!selectedThreadRef.current) {
              setSelectedThreadKey(buildThreadKey(nextRow.account_id, nextRow.thread_id));
            }
          }

          if (payload.eventType === "UPDATE") {
            setMessages((current) =>
              sortByTimestamp(
                current.map((message) =>
                  message.id === nextRow.id ? nextRow : message,
                ),
              ),
            );
          }

          if (payload.eventType === "DELETE") {
            setMessages((current) => removeMessage(current, nextRow.id));
          }
        },
      )
      .subscribe();

    const accountsChannel = supabase
      .channel(`inbox-accounts-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "accounts",
          filter: `owner_id=eq.${userId}`,
        },
        (payload) => {
          const account = (payload.new || payload.old) as AccountRecord | undefined;

          if (!account) {
            return;
          }

          if (payload.eventType === "DELETE") {
            setAccounts((current) =>
              current.filter((item) => item.id !== account.id),
            );
            setThreads((current) =>
              current.filter((thread) => thread.accountId !== account.id),
            );
            return;
          }

          setAccounts((current) => {
            const exists = current.some((item) => item.id === account.id);

            if (!exists) {
              return [account, ...current];
            }

            return current.map((item) => (item.id === account.id ? account : item));
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(chatsChannel);
      void supabase.removeChannel(accountsChannel);
    };
  }, [userId]);

  useEffect(() => {
    if (!selectedThreadKey && threads.length > 0) {
      setSelectedThreadKey(threads[0].threadKey);
    }
  }, [selectedThreadKey, threads]);

  const selectedThread =
    threads.find((thread) => thread.threadKey === selectedThreadKey) ?? null;
  const selectedTags = Array.from(
    new Set(messages.flatMap((message) => extractTags(message.tags))),
  );
  const filteredThreads = threads.filter((thread) => {
    const matchesSearch =
      search.trim().length === 0 ||
      thread.username.toLowerCase().includes(search.toLowerCase()) ||
      thread.accountUsername.toLowerCase().includes(search.toLowerCase()) ||
      thread.lastMessage.toLowerCase().includes(search.toLowerCase());
    const matchesTag = !activeTag || thread.tags.includes(activeTag);

    return matchesSearch && matchesTag;
  });

  return (
    <div className="page-stack">
      <section className="page-header">
        <div>
          <span className="eyebrow">Inbox unificado</span>
          <h1>Conversaciones en vivo desde Supabase</h1>
          <p className="page-copy">
            Layout fijo de tres columnas con lista de chats, burbujas y panel de
            etiquetas listo para crecer sobre la base actual.
          </p>
        </div>
        <div className="surface stat-pill">
          <strong>{threads.length}</strong>
          <span>hilos visibles</span>
        </div>
      </section>

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
              className={!activeTag ? "chip active" : "chip"}
              onClick={() => setActiveTag(null)}
            >
              Todas
            </button>
            {Array.from(new Set(threads.flatMap((thread) => thread.tags))).map((tag) => (
              <button
                key={tag}
                type="button"
                className={activeTag === tag ? "chip active" : "chip"}
                onClick={() => setActiveTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>

          <div className="thread-list">
            {filteredThreads.length === 0 ? (
              <div className="empty-state compact">
                <strong>Sin conversaciones</strong>
                <p>Ajustá la búsqueda o esperá nuevos eventos en tiempo real.</p>
              </div>
            ) : null}

            {filteredThreads.map((thread) => (
              <button
                key={thread.threadKey}
                type="button"
                className={
                  thread.threadKey === selectedThreadKey
                    ? "thread-card active"
                    : "thread-card"
                }
                onClick={() => setSelectedThreadKey(thread.threadKey)}
              >
                <div className="thread-card-top">
                  <strong>{thread.username}</strong>
                  <span>{formatRelativeTime(thread.lastTimestamp)}</span>
                </div>
                <span className="thread-account">@{thread.accountUsername}</span>
                <p>{thread.lastMessage}</p>
                <div className="thread-meta">
                  <span>{thread.messageCount} mensajes</span>
                  <span>
                    {thread.inboundCount} in / {thread.outboundCount} out
                  </span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="surface inbox-column inbox-column-thread">
          <div className="conversation-header">
            <div>
              <span className="eyebrow">Conversación</span>
              <h2>{selectedThread?.username ?? "Seleccioná un chat"}</h2>
              <p className="page-copy">
                {selectedThread
                  ? `Cuenta @${selectedThread.accountUsername} • ${selectedThread.messageCount} mensajes`
                  : "Todavía no hay un hilo seleccionado."}
              </p>
            </div>
            {selectedThread ? (
              <span className="status-inline">
                Activo {formatRelativeTime(selectedThread.lastTimestamp)}
              </span>
            ) : null}
          </div>

          <div className="message-list">
            {loadingThread ? (
              <div className="empty-state compact">
                <strong>Cargando mensajes</strong>
                <p>Sincronizando el hilo seleccionado.</p>
              </div>
            ) : null}

            {!loadingThread && messages.length === 0 ? (
              <div className="empty-state compact">
                <strong>Sin mensajes</strong>
                <p>Este hilo todavía no tiene mensajes persistidos en Supabase.</p>
              </div>
            ) : null}

            {!loadingThread
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
                      <span>{message.direction === "out" ? "Nosotros" : message.username}</span>
                      <span>{formatDateTime(message.timestamp)}</span>
                    </div>
                    <p>{message.message}</p>
                    {extractTags(message.tags).length > 0 ? (
                      <div className="tag-row compact">
                        {extractTags(message.tags).map((tag) => (
                          <span key={`${message.id}-${tag}`} className="chip passive">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))
              : null}
          </div>

          <div className="composer">
            <textarea
              className="text-area"
              placeholder="Composer visual listo. El envío lo conectamos al backend cuando quieras."
              disabled
            />
            <button type="button" className="button button-primary" disabled>
              Enviar pronto
            </button>
          </div>
        </section>

        <aside className="surface inbox-column inbox-column-tags">
          <div className="panel-section">
            <span className="eyebrow">Etiquetas</span>
            <h3>{selectedTags.length > 0 ? "Resumen del hilo" : "Sin etiquetas aún"}</h3>
            <p className="page-copy">
              Este panel agrega las etiquetas detectadas en los mensajes del hilo
              y se actualiza con los eventos Realtime.
            </p>
          </div>

          <div className="tag-stack">
            {selectedTags.length === 0 ? (
              <div className="empty-state compact">
                <strong>Vacío por ahora</strong>
                <p>Cuando Supabase guarde tags en `chats.tags`, van a aparecer acá.</p>
              </div>
            ) : (
              selectedTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={activeTag === tag ? "tag-card active" : "tag-card"}
                  onClick={() => setActiveTag(tag)}
                >
                  <strong>{tag}</strong>
                  <span>Filtrar este label en la columna izquierda</span>
                </button>
              ))
            )}
          </div>

          <div className="panel-section top-border">
            <span className="eyebrow">Contexto</span>
            <div className="detail-list">
              <div className="detail-row">
                <span>Cuenta</span>
                <strong>{selectedThread ? `@${selectedThread.accountUsername}` : "-"}</strong>
              </div>
              <div className="detail-row">
                <span>Última actividad</span>
                <strong>
                  {selectedThread ? formatDateTime(selectedThread.lastTimestamp) : "-"}
                </strong>
              </div>
              <div className="detail-row">
                <span>Entrantes</span>
                <strong>{selectedThread?.inboundCount ?? 0}</strong>
              </div>
              <div className="detail-row">
                <span>Salientes</span>
                <strong>{selectedThread?.outboundCount ?? 0}</strong>
              </div>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
