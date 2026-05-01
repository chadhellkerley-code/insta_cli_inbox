"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  INSTAGRAM_AUDIO_ACCEPT_ATTRIBUTE,
  INSTAGRAM_AUDIO_ACCEPT_HELPER_TEXT,
} from "@/lib/meta/audio";
import type {
  ConversationRecord,
  InstagramAccountRecord,
  MessageRecord,
} from "@/lib/shared-data";
import {
  formatDateTime,
  formatRelativeTime,
  getConversationDisplayName,
  getConversationLabels,
  getConversationPreview,
  getInstagramAccountDisplayName,
  getMessagePreview,
} from "@/lib/shared-data";
import { createClient } from "@/lib/supabase/client";

type InboxRealtimeShellProps = {
  userId: string;
  initialAccounts: InstagramAccountRecord[];
  initialConversations: ConversationRecord[];
  initialMessages: MessageRecord[];
  initialSelectedConversationId: string | null;
};

type SendMode = "text" | "audio";
type TimeFilter = "all" | "plus12" | "between6and12" | "under6" | "new";
type StatusFilter = "all" | "active" | "handoff";
type DeleteTarget =
  | { type: "conversation"; id: string }
  | { type: "message"; id: string; conversationId: string };
type DeleteContextMenu = {
  x: number;
  y: number;
  target: DeleteTarget;
};
type DeleteResponsePayload = {
  error?: string;
  conversation?: {
    id: string;
    last_message_text: string | null;
    last_message_type: string | null;
    last_message_at: string | null;
    updated_at: string | null;
  };
};

const BACKGROUND_REFRESH_INTERVAL_MS = 12_000;
const DELETE_CONTEXT_MENU_WIDTH = 150;
const DELETE_CONTEXT_MENU_HEIGHT = 44;
const DELETE_CONTEXT_MENU_MARGIN = 8;
const HOUR_MS = 60 * 60 * 1000;

const TIME_FILTERS: Array<{
  id: TimeFilter;
  label: string;
  tone?: "success" | "warning" | "danger";
}> = [
  { id: "all", label: "All" },
  { id: "plus12", label: "12h+", tone: "success" },
  { id: "between6and12", label: "6-12h", tone: "warning" },
  { id: "under6", label: "<6h", tone: "danger" },
  { id: "new", label: "New" },
];

const STATUS_FILTERS: Array<{
  id: StatusFilter;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "handoff", label: "Handoff" },
];

type InstagramContactLite = {
  contact_igsid: string;
  contact_username: string | null;
  contact_name: string | null;
  profile_picture_url: string | null;
};

function mergeConversationIdentity(
  previous: ConversationRecord | undefined,
  incoming: ConversationRecord,
) {
  return {
    ...incoming,
    contact_username:
      incoming.contact_username ??
      previous?.contact_username ??
      null,
    contact_name:
      incoming.contact_name ??
      previous?.contact_name ??
      null,
    contact_profile_picture_url:
      incoming.contact_profile_picture_url ??
      previous?.contact_profile_picture_url ??
      null,
  } satisfies ConversationRecord;
}

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

function normalizeSortableDate(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getClampedContextMenuPosition(clientX: number, clientY: number) {
  if (typeof window === "undefined") {
    return { x: clientX, y: clientY };
  }

  const maxX = Math.max(
    DELETE_CONTEXT_MENU_MARGIN,
    window.innerWidth - DELETE_CONTEXT_MENU_WIDTH - DELETE_CONTEXT_MENU_MARGIN,
  );
  const maxY = Math.max(
    DELETE_CONTEXT_MENU_MARGIN,
    window.innerHeight - DELETE_CONTEXT_MENU_HEIGHT - DELETE_CONTEXT_MENU_MARGIN,
  );

  return {
    x: Math.min(Math.max(DELETE_CONTEXT_MENU_MARGIN, clientX), maxX),
    y: Math.min(Math.max(DELETE_CONTEXT_MENU_MARGIN, clientY), maxY),
  };
}

function getConversationAgeHours(conversation: ConversationRecord) {
  const timestamp = normalizeSortableDate(
    conversation.last_message_at ?? conversation.updated_at ?? conversation.created_at,
  );

  if (!timestamp) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, (Date.now() - timestamp) / HOUR_MS);
}

function conversationMatchesTimeFilter(
  conversation: ConversationRecord,
  timeFilter: TimeFilter,
) {
  if (timeFilter === "all") {
    return true;
  }

  if (timeFilter === "new") {
    return getConversationAgeHours(conversation) < 1;
  }

  const ageHours = getConversationAgeHours(conversation);

  if (timeFilter === "under6") {
    return ageHours >= 1 && ageHours < 6;
  }

  if (timeFilter === "between6and12") {
    return ageHours >= 6 && ageHours < 12;
  }

  return ageHours >= 12 && ageHours < 24;
}

function conversationMatchesStatusFilter(
  conversation: ConversationRecord,
  statusFilter: StatusFilter,
) {
  if (statusFilter === "all") {
    return true;
  }

  const ageHours = getConversationAgeHours(conversation);

  if (statusFilter === "active") {
    return ageHours < 24;
  }

  return ageHours >= 24;
}

async function loadConversationRows(client: ReturnType<typeof createClient>, userId: string) {
  const result = await client
    .from("instagram_conversations")
    .select("*")
    .eq("owner_id", userId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(200);

  if (result.error || !result.data) {
    return null;
  }

  const conversations = result.data as ConversationRecord[];
  const contactIds = Array.from(
    new Set(conversations.map((conversation) => conversation.contact_igsid).filter(Boolean)),
  );

  if (contactIds.length === 0) {
    return sortConversations(conversations);
  }

  const contactsResult = await client
    .from("instagram_contacts")
    .select("contact_igsid, contact_username, contact_name, profile_picture_url")
    .eq("owner_id", userId)
    .in("contact_igsid", contactIds);

  if (contactsResult.error || !contactsResult.data) {
    return sortConversations(conversations);
  }

  const contacts = contactsResult.data as InstagramContactLite[];
  const contactMap = new Map(contacts.map((contact) => [contact.contact_igsid, contact]));
  const mergedConversations = conversations.map((conversation) => {
    const contact = contactMap.get(conversation.contact_igsid);

    if (!contact) {
      return conversation;
    }

    return {
      ...conversation,
      contact_username: contact.contact_username ?? conversation.contact_username,
      contact_name: contact.contact_name ?? conversation.contact_name,
      contact_profile_picture_url:
        contact.profile_picture_url ?? conversation.contact_profile_picture_url ?? null,
    } satisfies ConversationRecord;
  });

  return sortConversations(mergedConversations);
}

async function loadMessageRows(
  client: ReturnType<typeof createClient>,
  userId: string,
  conversationId: string,
) {
  const result = await client
    .from("instagram_messages")
    .select("*")
    .eq("owner_id", userId)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(300);

  if (result.error || !result.data) {
    return null;
  }

  return sortMessages(result.data as MessageRecord[]);
}

export function InboxRealtimeShell({
  userId,
  initialAccounts,
  initialConversations,
  initialMessages,
  initialSelectedConversationId,
}: InboxRealtimeShellProps) {
  const clientRef = useRef<ReturnType<typeof createClient>>();
  const selectedConversationRef = useRef<string | null>(initialSelectedConversationId);
  const labelMenuRef = useRef<HTMLDivElement>(null);
  const deleteContextMenuRef = useRef<HTMLDivElement>(null);
  const [accounts, setAccounts] = useState(initialAccounts);
  const [conversations, setConversations] = useState(
    sortConversations(initialConversations),
  );
  const [messages, setMessages] = useState(sortMessages(initialMessages));
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(
    initialSelectedConversationId,
  );
  const [search, setSearch] = useState("");
  const [activeLabels, setActiveLabels] = useState<string[]>([]);
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [labelsDraft, setLabelsDraft] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState("");
  const [notesDraft, setNotesDraft] = useState("");
  const [composerText, setComposerText] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [savingDetails, setSavingDetails] = useState(false);
  const [sendMode, setSendMode] = useState<SendMode>("text");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<DeleteContextMenu | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!clientRef.current) {
    clientRef.current = createClient();
  }

  useEffect(() => {
    selectedConversationRef.current = selectedConversationId;
  }, [selectedConversationId]);

  useEffect(() => {
    if (!labelMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (
        target instanceof Node &&
        labelMenuRef.current &&
        !labelMenuRef.current.contains(target)
      ) {
        setLabelMenuOpen(false);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setLabelMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [labelMenuOpen]);

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (
        target instanceof Node &&
        deleteContextMenuRef.current &&
        !deleteContextMenuRef.current.contains(target)
      ) {
        setContextMenu(null);
      }
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setContextMenu(null);
      }
    }

    const closeContextMenu = () => setContextMenu(null);

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", closeContextMenu, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", closeContextMenu, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!deleteTarget || isDeleting) {
      return;
    }

    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setDeleteTarget(null);
        setDeleteError(null);
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteTarget, isDeleting]);

  const selectedConversation =
    conversations.find((conversation) => conversation.id === selectedConversationId) ?? null;
  const selectedAccount =
    accounts.find((account) => account.id === selectedConversation?.account_id) ?? null;
  const accountOrdinalById = useMemo(() => {
    const ordered = [...accounts].sort((left, right) => {
      const leftTimestamp = normalizeSortableDate(left.connected_at ?? left.created_at);
      const rightTimestamp = normalizeSortableDate(right.connected_at ?? right.created_at);
      return leftTimestamp - rightTimestamp;
    });

    return new Map(ordered.map((account, index) => [account.id, index + 1]));
  }, [accounts]);
  const accountUsernameMap = useMemo(() => {
    return new Map(accounts.map((account) => [account.id, account.username]));
  }, [accounts]);
  const resolveConversationAccountLabel = (conversation: ConversationRecord) => {
    const baseLabel = getInstagramAccountDisplayName(
      accountUsernameMap.get(conversation.account_id) ?? conversation.account_username,
    );

    if (baseLabel !== "Cuenta conectada") {
      return baseLabel;
    }

    const ordinal = accountOrdinalById.get(conversation.account_id);
    return ordinal ? `Cuenta ${ordinal}` : baseLabel;
  };

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

    const currentConversationId = selectedConversationId;

    if (
      currentConversationId === initialSelectedConversationId &&
      initialMessages.length > 0
    ) {
      setMessages(sortMessages(initialMessages));
      return;
    }

    const supabase = clientRef.current!;
    let cancelled = false;

    async function loadMessages() {
      setLoadingMessages(true);
      const nextMessages = await loadMessageRows(supabase, userId, currentConversationId);

      if (cancelled) {
        return;
      }

      setLoadingMessages(false);

      if (nextMessages) {
        setMessages(nextMessages);
      }
    }

    void loadMessages();

    return () => {
      cancelled = true;
    };
  }, [initialMessages, initialSelectedConversationId, selectedConversationId, userId]);

  useEffect(() => {
    const supabase = clientRef.current!;
    let cancelled = false;

    async function refreshInboxData() {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }

      const nextConversations = await loadConversationRows(supabase, userId);

      if (cancelled || !nextConversations) {
        return;
      }

      setConversations(nextConversations);

      const selectedId = selectedConversationRef.current;

      if (selectedId && !nextConversations.some((conversation) => conversation.id === selectedId)) {
        const fallbackConversationId = nextConversations[0]?.id ?? null;
        selectedConversationRef.current = fallbackConversationId;
        setSelectedConversationId(fallbackConversationId);
      }

      const currentConversationId =
        selectedConversationRef.current ?? nextConversations[0]?.id ?? null;

      if (!currentConversationId) {
        setMessages([]);
        return;
      }

      const nextMessages = await loadMessageRows(supabase, userId, currentConversationId);

      if (cancelled || !nextMessages) {
        return;
      }

      if (selectedConversationRef.current === currentConversationId) {
        setMessages(nextMessages);
      }
    }

    void refreshInboxData();

    const interval = window.setInterval(() => {
      void refreshInboxData();
    }, BACKGROUND_REFRESH_INTERVAL_MS);
    const handleFocus = () => {
      void refreshInboxData();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshInboxData();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [userId]);

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

          setConversations((current) => {
            const previousConversation = current.find((item) => item.id === conversation.id);
            const nextConversation = mergeConversationIdentity(previousConversation, conversation);
            return sortConversations(upsertById(current, nextConversation));
          });
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

    return () => {
      void supabase.removeChannel(accountsChannel);
      void supabase.removeChannel(conversationsChannel);
      void supabase.removeChannel(messagesChannel);
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
      const accountUsername = getInstagramAccountDisplayName(
        accountUsernameMap.get(conversation.account_id) ?? conversation.account_username,
      ).toLowerCase();
      const preview = getConversationPreview(conversation).toLowerCase();
      const searchTerm = search.trim().toLowerCase();
      const matchesSearch =
        !searchTerm ||
        displayName.includes(searchTerm) ||
        accountUsername.includes(searchTerm) ||
        preview.includes(searchTerm);
      const matchesLabel =
        activeLabels.length === 0 ||
        activeLabels.some((label) =>
          getConversationLabels(conversation.labels).includes(label),
        );
      const matchesTime = conversationMatchesTimeFilter(conversation, timeFilter);
      const matchesStatus = conversationMatchesStatusFilter(conversation, statusFilter);

      return matchesSearch && matchesLabel && matchesTime && matchesStatus;
    });
  }, [accountUsernameMap, activeLabels, conversations, search, statusFilter, timeFilter]);

  function getFallbackConversationId(deletedConversationId: string) {
    const visibleIndex = filteredConversations.findIndex(
      (conversation) => conversation.id === deletedConversationId,
    );
    const visibleFallback =
      visibleIndex >= 0
        ? (filteredConversations[visibleIndex + 1] ?? filteredConversations[visibleIndex - 1])
        : null;

    return (
      visibleFallback?.id ??
      conversations.find((conversation) => conversation.id !== deletedConversationId)?.id ??
      null
    );
  }

  function toggleActiveLabel(label: string) {
    setActiveLabels((current) => {
      if (current.includes(label)) {
        return current.filter((item) => item !== label);
      }

      return [...current, label];
    });
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
    } catch (error) {
      console.error("No pudimos guardar los cambios del inbox.", error);
    } finally {
      setSavingDetails(false);
    }
  }

  async function sendMessage() {
    if (sendingMessage) {
      return;
    }

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
    setSendError(null);

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
    } catch (error) {
      console.error("No pudimos enviar el mensaje del inbox.", error);
      setSendError(
        error instanceof Error ? error.message : "No pudimos enviar el mensaje.",
      );
    } finally {
      setSendingMessage(false);
    }
  }

  function openDeleteContextMenu(
    event: MouseEvent<HTMLElement>,
    target: DeleteTarget,
  ) {
    event.preventDefault();
    const position = getClampedContextMenuPosition(event.clientX, event.clientY);

    setLabelMenuOpen(false);
    setDeleteError(null);
    setContextMenu({
      ...position,
      target,
    });
  }

  function closeDeleteContextMenu() {
    setContextMenu(null);
  }

  function openDeleteDialog(target: DeleteTarget) {
    closeDeleteContextMenu();
    setDeleteError(null);
    setDeleteTarget(target);
  }

  function closeDeleteDialog() {
    if (isDeleting) {
      return;
    }

    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!deleteTarget || isDeleting) {
      return;
    }

    const target = deleteTarget;
    const fallbackConversationId =
      target.type === "conversation" ? getFallbackConversationId(target.id) : null;
    const endpoint =
      target.type === "conversation"
        ? `/api/instagram/conversations/${target.id}`
        : `/api/instagram/messages/${target.id}`;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      const response = await fetch(endpoint, { method: "DELETE" });
      const payload = (await response.json().catch(() => null)) as
        | DeleteResponsePayload
        | null;

      if (!response.ok) {
        throw new Error(payload?.error || "No pudimos eliminar los datos.");
      }

      if (target.type === "conversation") {
        setConversations((current) => removeById(current, target.id));

        if (selectedConversationRef.current === target.id) {
          selectedConversationRef.current = fallbackConversationId;
          setSelectedConversationId(fallbackConversationId);

          if (!fallbackConversationId) {
            setMessages([]);
          }
        }
      } else {
        setMessages((current) => removeById(current, target.id));

        const updatedConversation = payload?.conversation;

        if (updatedConversation) {
          setConversations((current) =>
            sortConversations(
              current.map((conversation) =>
                conversation.id === updatedConversation.id
                  ? {
                      ...conversation,
                      last_message_text: updatedConversation.last_message_text,
                      last_message_type: updatedConversation.last_message_type,
                      last_message_at: updatedConversation.last_message_at,
                      updated_at: updatedConversation.updated_at,
                    }
                  : conversation,
              ),
            ),
          );
        }
      }

      setDeleteTarget(null);
    } catch (error) {
      console.error("No pudimos eliminar datos del inbox.", error);
      setDeleteError(
        error instanceof Error ? error.message : "No pudimos eliminar los datos.",
      );
    } finally {
      setIsDeleting(false);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();
    void sendMessage();
  }

  return (
    <div className="page-stack inbox-page">
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

      <section className="inbox-shell">
        <aside className="surface inbox-column inbox-column-list">
          <div className="inbox-compact-header">
            <h2>Inbox</h2>
          </div>

          <div className="inbox-toolbar">
            <div className="inbox-search-row compact">
              <label className="visually-hidden" htmlFor="thread-search">
                Buscar conversaciones
              </label>
              <input
                id="thread-search"
                className="text-input inbox-search-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search conversations..."
              />
            </div>
          </div>

          <div className="time-filter-wrap" ref={labelMenuRef}>
            <div className="time-filter-group" role="group" aria-label="Filtros por tiempo">
              {TIME_FILTERS.filter((filter) => filter.id !== "new").map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={timeFilter === filter.id ? "chip active" : "chip"}
                  onClick={() => setTimeFilter(filter.id)}
                >
                  {filter.tone ? <span className={`time-dot ${filter.tone}`} /> : null}
                  {filter.label}
                </button>
              ))}
              <button
                type="button"
                className={activeLabels.length > 0 || labelMenuOpen ? "chip active" : "chip"}
                onClick={() => setLabelMenuOpen((current) => !current)}
                aria-expanded={labelMenuOpen}
              >
                Exp{activeLabels.length > 0 ? ` ${activeLabels.length}` : ""}
              </button>
              {TIME_FILTERS.filter((filter) => filter.id === "new").map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={timeFilter === filter.id ? "chip active" : "chip"}
                  onClick={() => setTimeFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            {labelMenuOpen ? (
              <div className="label-filter-menu" role="dialog" aria-label="Seleccionar etiquetas">
                <div className="label-filter-menu-head">
                  <div>
                    <strong>Etiquetas</strong>
                    <span>{activeLabels.length} seleccionadas</span>
                  </div>
                  <button type="button" onClick={() => setLabelMenuOpen(false)}>
                    Cerrar
                  </button>
                </div>
                <div className="label-filter-actions">
                  <button type="button" onClick={() => setActiveLabels([])}>
                    Todas
                  </button>
                </div>
                <div className="label-filter-options">
                  {allLabels.length === 0 ? (
                    <span className="muted">Sin etiquetas guardadas</span>
                  ) : null}
                  {allLabels.map((label) => (
                    <label key={label} className="label-filter-option">
                      <input
                        type="checkbox"
                        checked={activeLabels.includes(label)}
                        onChange={() => toggleActiveLabel(label)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="tag-row inbox-filter-row status-filter-row">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                className={statusFilter === filter.id ? "chip active" : "chip"}
                onClick={() => setStatusFilter(filter.id)}
              >
                {filter.label}
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
                onContextMenu={(event) =>
                  openDeleteContextMenu(event, {
                    type: "conversation",
                    id: conversation.id,
                  })
                }
              >
                {conversation.contact_profile_picture_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className="thread-contact-avatar"
                    src={conversation.contact_profile_picture_url}
                    alt={getConversationDisplayName(conversation)}
                    loading="lazy"
                  />
                ) : (
                  <span className="thread-contact-avatar thread-contact-avatar-fallback">
                    {getConversationDisplayName(conversation).slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="thread-card-main">
                  <span className="thread-card-top">
                    <strong>{getConversationDisplayName(conversation)}</strong>
                    <span className="thread-card-time">
                      {formatRelativeTime(conversation.last_message_at)}
                    </span>
                  </span>
                  <span className="thread-contact-subtitle">
                    {conversation.contact_name ?? conversation.contact_username ?? "Contacto"} -{" "}
                    {resolveConversationAccountLabel(conversation)}
                  </span>
                  <span className="thread-preview">
                    {getConversationPreview(conversation)}
                  </span>
                  <span className="thread-meta">
                    <span className="thread-label-summary">
                      {getConversationLabels(conversation.labels).join(", ") || "Sin etiquetas"}
                    </span>
                    {(conversation.unread_count ?? 0) > 0 ? (
                      <span className="thread-unread active">
                        {conversation.unread_count}
                      </span>
                    ) : null}
                  </span>
                </span>
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
                  ? resolveConversationAccountLabel(selectedConversation)
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
                    onContextMenu={(event) =>
                      openDeleteContextMenu(event, {
                        type: "message",
                        id: message.id,
                        conversationId: message.conversation_id,
                      })
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
                onKeyDown={handleComposerKeyDown}
                disabled={!selectedConversation || sendingMessage}
              />
            ) : (
              <label className="upload-field">
                <span className="field-label">Adjuntar audio</span>
                <input
                  type="file"
                  accept={INSTAGRAM_AUDIO_ACCEPT_ATTRIBUTE}
                  onChange={(event) =>
                    setAudioFile(event.target.files?.[0] ?? null)
                  }
                  disabled={!selectedConversation || sendingMessage}
                />
                <span className="status-copy">
                  {audioFile ? audioFile.name : INSTAGRAM_AUDIO_ACCEPT_HELPER_TEXT}
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
            {sendError ? <p className="feedback error">{sendError}</p> : null}
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
              Etiquetas y notas internas visibles para el equipo.
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
                <span className="eyebrow">Contexto</span>
                <div className="detail-list">
                  <div className="detail-row">
                    <span>Cuenta</span>
                    <strong>
                      {selectedConversation
                        ? resolveConversationAccountLabel(selectedConversation)
                        : selectedAccount
                          ? `@${selectedAccount.username}`
                          : "-"}
                    </strong>
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
              <p>Selecciona una conversacion para editar etiquetas y notas.</p>
            </div>
          )}
        </aside>
      </section>

      {contextMenu ? (
        <div
          ref={deleteContextMenuRef}
          className="delete-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label="Opciones de eliminacion"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => openDeleteDialog(contextMenu.target)}
          >
            Eliminar
          </button>
        </div>
      ) : null}

      {deleteTarget ? (
        <div
          className="delete-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDeleteDialog();
            }
          }}
        >
          <div
            className="surface delete-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="delete-modal-title"
            aria-describedby="delete-modal-description"
          >
            <div>
              <span className="eyebrow">Eliminar</span>
              <h3 id="delete-modal-title">Eliminar del inbox</h3>
            </div>
            <p id="delete-modal-description">
              Seguro que quieres eliminar sabiendo que se perderan los datos de aqui en el inbox?
            </p>
            {deleteError ? <p className="feedback error">{deleteError}</p> : null}
            <div className="delete-modal-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={closeDeleteDialog}
                disabled={isDeleting}
              >
                No
              </button>
              <button
                type="button"
                className="button button-danger"
                onClick={() => void confirmDelete()}
                disabled={isDeleting}
              >
                {isDeleting ? "Eliminando..." : "Si"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
