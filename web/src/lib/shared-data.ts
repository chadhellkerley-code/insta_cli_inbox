import type { User } from "@supabase/supabase-js";

export type UserProfile = {
  id: string;
  role: string | null;
  expires_at: string | null;
};

export type AccountRecord = {
  id: number;
  username: string;
  status: string | null;
  created_at: string | null;
  proxy_host: string | null;
  proxy_port: number | null;
  proxy_username: string | null;
  proxy_password: string | null;
  owner_id: string | null;
  twofactor: string | null;
};

export type ChatRecord = {
  id: number;
  account_id: number;
  thread_id: string;
  username: string;
  message: string;
  direction: "in" | "out" | string;
  timestamp: number;
  tags: string | null;
  created_at: string | null;
};

export type ThreadSummary = {
  threadKey: string;
  threadId: string;
  accountId: number;
  accountUsername: string;
  username: string;
  lastMessage: string;
  lastTimestamp: number;
  messageCount: number;
  inboundCount: number;
  outboundCount: number;
  tags: string[];
};

export type DashboardMetrics = {
  todayInbound: number;
  todayOutbound: number;
  weekTotal: number;
  monthTotal: number;
  activeThreads: number;
  qualifiedThreads: number;
  staleThreads: number;
  activeAccounts: number;
  replyRatio: number;
};

export function buildThreadKey(accountId: number, threadId: string) {
  return `${accountId}::${threadId}`;
}

export function extractTags(rawTags: string | null | undefined) {
  if (!rawTags) {
    return [];
  }

  return rawTags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

export function buildThreadSummaries(
  chats: ChatRecord[],
  accounts: AccountRecord[],
): ThreadSummary[] {
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const grouped = new Map<string, ThreadSummary>();

  for (const chat of chats) {
    const threadKey = buildThreadKey(chat.account_id, chat.thread_id);
    const account = accountMap.get(chat.account_id);
    const existing = grouped.get(threadKey);

    if (!existing) {
      grouped.set(threadKey, {
        threadKey,
        threadId: chat.thread_id,
        accountId: chat.account_id,
        accountUsername: account?.username ?? `Cuenta ${chat.account_id}`,
        username: chat.username || "Sin nombre",
        lastMessage: chat.message || "Sin contenido",
        lastTimestamp: chat.timestamp ?? 0,
        messageCount: 1,
        inboundCount: chat.direction === "in" ? 1 : 0,
        outboundCount: chat.direction === "out" ? 1 : 0,
        tags: extractTags(chat.tags),
      });
      continue;
    }

    existing.messageCount += 1;
    if (chat.direction === "in") {
      existing.inboundCount += 1;
    }
    if (chat.direction === "out") {
      existing.outboundCount += 1;
    }

    for (const tag of extractTags(chat.tags)) {
      if (!existing.tags.includes(tag)) {
        existing.tags.push(tag);
      }
    }

    if ((chat.timestamp ?? 0) > existing.lastTimestamp) {
      existing.lastTimestamp = chat.timestamp ?? 0;
      existing.lastMessage = chat.message || "Sin contenido";
      existing.username = chat.username || existing.username;
    }
  }

  return Array.from(grouped.values()).sort(
    (left, right) => right.lastTimestamp - left.lastTimestamp,
  );
}

export function computeDashboardMetrics(
  chats: ChatRecord[],
  threads: ThreadSummary[],
  accounts: AccountRecord[],
): DashboardMetrics {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
  const todayChats = chats.filter((chat) => chat.timestamp >= dayAgo);
  const weekChats = chats.filter((chat) => chat.timestamp >= weekAgo);
  const monthChats = chats.filter((chat) => chat.timestamp >= monthAgo);
  const inboundToday = todayChats.filter((chat) => chat.direction === "in").length;
  const outboundToday = todayChats.filter((chat) => chat.direction === "out").length;
  const qualifiedThreads = threads.filter((thread) =>
    thread.tags.some((tag) => tag.toLowerCase() === "qualified"),
  ).length;
  const staleThreads = threads.filter(
    (thread) => thread.lastTimestamp < now - 14 * 24 * 60 * 60 * 1000,
  ).length;
  const activeAccounts = accounts.filter(
    (account) => !account.status || account.status === "active",
  ).length;

  return {
    todayInbound: inboundToday,
    todayOutbound: outboundToday,
    weekTotal: weekChats.length,
    monthTotal: monthChats.length,
    activeThreads: threads.length,
    qualifiedThreads,
    staleThreads,
    activeAccounts,
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

  return user.email?.split("@")[0] ?? "Usuario";
}
