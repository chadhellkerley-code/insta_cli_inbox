import type { User } from "@supabase/supabase-js";

import { isFallbackInstagramUsername } from "@/lib/meta/instagram-username";

export type UserProfile = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: string | null;
  expires_at: string | null;
  last_login_at: string | null;
  instagram_inbox_cleanup_started_at?: string | null;
  instagram_inbox_cleanup_last_run_at?: string | null;
  instagram_inbox_cleanup_last_repair_at?: string | null;
  instagram_inbox_cleanup_last_error?: string | null;
};

export type InstagramAccountRecord = {
  id: string;
  owner_id: string;
  page_id: string | null;
  instagram_user_id: string | null;
  instagram_account_id: string;
  instagram_app_user_id: string | null;
  username: string;
  name: string | null;
  account_type: string | null;
  profile_picture_url: string | null;
  status: string | null;
  token_obtained_at: string | null;
  expires_in: number | null;
  expires_at: string | null;
  token_expires_at: string | null;
  token_lifecycle: string | null;
  last_token_refresh_at: string | null;
  connected_at: string | null;
  last_oauth_at: string | null;
  webhook_subscribed_at?: string | null;
  webhook_status?: string | null;
  messaging_status?: string | null;
  last_webhook_check_at?: string | null;
  webhook_subscription_error?: string | null;
  last_webhook_at?: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ConversationRecord = {
  id: string;
  owner_id: string;
  account_id: string;
  contact_igsid: string;
  contact_username: string | null;
  contact_name: string | null;
  contact_profile_picture_url?: string | null;
  labels: string[] | null;
  notes: string | null;
  last_message_text: string | null;
  last_message_type: string | null;
  last_message_at: string | null;
  unread_count: number | null;
  created_at: string | null;
  updated_at: string | null;
  account_username?: string;
};

export type MessageRecord = {
  id: string;
  owner_id: string;
  account_id: string;
  conversation_id: string;
  meta_message_id: string | null;
  direction: "in" | "out" | string;
  message_type: "text" | "audio" | "image" | "video" | "file" | string;
  text_content: string | null;
  media_url: string | null;
  mime_type: string | null;
  sender_igsid: string | null;
  recipient_igsid: string | null;
  raw_payload: Record<string, unknown> | null;
  sent_at: string | null;
  created_at: string | null;
};

export type DashboardMetrics = {
  todayInbound: number;
  todayOutbound: number;
  weekTotal: number;
  monthTotal: number;
  activeConversations: number;
  qualifiedConversations: number;
  staleConversations: number;
  activeAccounts: number;
  replyRatio: number;
};

export function getConversationLabels(labels: string[] | null | undefined) {
  return (labels ?? []).filter(Boolean);
}

export function enrichConversationsWithAccounts(
  conversations: ConversationRecord[],
  accounts: InstagramAccountRecord[],
) {
  const accountMap = new Map(accounts.map((account) => [account.id, account.username]));

  return conversations.map((conversation) => ({
    ...conversation,
    account_username:
      accountMap.get(conversation.account_id) ??
      conversation.account_username ??
      "cuenta",
  }));
}

export function getInstagramAccountDisplayName(username?: string | null) {
  const normalized = username?.trim().replace(/^@+/, "") ?? null;

  if (!normalized || isFallbackInstagramUsername(normalized)) {
    return "Cuenta conectada";
  }

  return `@${normalized}`;
}

export function getConversationDisplayName(conversation: ConversationRecord) {
  const username = conversation.contact_username?.trim().replace(/^@+/, "") ?? null;
  const name = conversation.contact_name?.trim() ?? null;

  if (username && !isFallbackInstagramUsername(username)) {
    return `@${username}`;
  }

  if (name) {
    return name;
  }

  if (conversation.contact_igsid) {
    return `Contacto ${conversation.contact_igsid.slice(-6)}`;
  }

  return "Contacto";
}

export function getMessagePreview(message: MessageRecord) {
  if (message.text_content?.trim()) {
    return message.text_content;
  }

  switch (message.message_type) {
    case "audio":
      return "Mensaje de audio";
    case "image":
      return "Imagen";
    case "video":
      return "Video";
    case "file":
      return "Archivo";
    default:
      return "Mensaje";
  }
}

export function getConversationPreview(conversation: ConversationRecord) {
  if (conversation.last_message_text?.trim()) {
    return conversation.last_message_text;
  }

  switch (conversation.last_message_type) {
    case "audio":
      return "Mensaje de audio";
    case "image":
      return "Imagen";
    case "video":
      return "Video";
    case "file":
      return "Archivo";
    default:
      return "Sin mensajes";
  }
}

export function computeDashboardMetrics(
  messages: MessageRecord[],
  conversations: ConversationRecord[],
  accounts: InstagramAccountRecord[],
): DashboardMetrics {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const todayMessages = messages.filter((message) => {
    if (!message.created_at && !message.sent_at) {
      return false;
    }

    return new Date(message.sent_at ?? message.created_at ?? 0).getTime() >= dayAgo;
  });
  const weekMessages = messages.filter((message) => {
    if (!message.created_at && !message.sent_at) {
      return false;
    }

    return new Date(message.sent_at ?? message.created_at ?? 0).getTime() >= weekAgo;
  });
  const monthMessages = messages.filter((message) => {
    if (!message.created_at && !message.sent_at) {
      return false;
    }

    return new Date(message.sent_at ?? message.created_at ?? 0).getTime() >= monthAgo;
  });
  const inboundToday = todayMessages.filter((message) => message.direction === "in").length;
  const outboundToday = todayMessages.filter((message) => message.direction === "out").length;
  const qualifiedConversations = conversations.filter((conversation) =>
    getConversationLabels(conversation.labels).some(
      (label) => label.toLowerCase() === "qualified",
    ),
  ).length;
  const staleConversations = conversations.filter((conversation) => {
    if (!conversation.last_message_at) {
      return true;
    }

    return new Date(conversation.last_message_at).getTime() < now - 14 * 24 * 60 * 60 * 1000;
  }).length;
  return {
    todayInbound: inboundToday,
    todayOutbound: outboundToday,
    weekTotal: weekMessages.length,
    monthTotal: monthMessages.length,
    activeConversations: conversations.length,
    qualifiedConversations,
    staleConversations,
    activeAccounts: accounts.length,
    replyRatio:
      inboundToday === 0 ? 100 : Math.min(999, (outboundToday / inboundToday) * 100),
  };
}

export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("es-UY", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDateTime(value: number | string | null | undefined) {
  if (!value) {
    return "Sin fecha";
  }

  const date = new Date(value);
  return new Intl.DateTimeFormat("es-UY", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatRelativeTime(value: number | string | null | undefined) {
  if (!value) {
    return "Sin actividad";
  }

  const timestamp = new Date(value).getTime();
  const diff = timestamp - Date.now();
  const minutes = Math.round(diff / (60 * 1000));
  const formatter = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

  if (Math.abs(minutes) < 60) {
    return formatter.format(minutes, "minute");
  }

  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) {
    return formatter.format(hours, "hour");
  }

  const days = Math.round(hours / 24);
  return formatter.format(days, "day");
}

export function getDisplayName(user: User, profile: UserProfile | null) {
  const role = profile?.role?.toLowerCase();

  if (role === "owner") {
    return "Owner";
  }

  return profile?.full_name ?? user.user_metadata?.name ?? user.email?.split("@")[0] ?? "Usuario";
}
