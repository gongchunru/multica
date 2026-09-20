/**
 * Chat query keys + queryOptions factories.
 *
 * Keys:
 *   - sessions(wsId)        → ChatSession[] for the workspace dropdown / sheet
 *   - messages(sessionId)   → ChatMessage[] for the active session
 *   - pendingTask(sessionId)→ ChatPendingTask, populated when an agent task is
 *                             in flight; refreshed on terminal task events
 *
 * Same shape as web's `chatKeys` in packages/core/chat/queries.ts (mobile
 * owns its own copy per the "mirror, don't import" rule in apps/mobile/CLAUDE.md).
 *
 * `staleTime: Infinity` everywhere — caches are kept fresh by WS event
 * handlers, not by background refetch. Foreground / reconnect invalidates
 * are scoped to each owning hook (see use-chat-sessions-realtime.ts and
 * use-chat-session-realtime.ts).
 */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { api } from "@/data/api";

export const chatKeys = {
  all: (wsId: string | null) => ["chat", wsId] as const,
  sessions: (wsId: string | null) =>
    [...chatKeys.all(wsId), "sessions"] as const,
  messages: (sessionId: string) => ["chat", "messages", sessionId] as const,
  pendingTask: (sessionId: string) =>
    ["chat", "pending-task", sessionId] as const,
  /** Per-task live execution timeline (thinking / tool_use / tool_result /
   *  text / error rows). Cache is workspace-agnostic — keyed only on
   *  `taskId` — matching web's `chatKeys.taskMessages` shape so future
   *  cross-feature consumers (issue agent cards) can share the cache.
   *  `task:message` WS events append rows in place; once the task
   *  completes the cache stays warm so the persisted assistant message
   *  can render the same trace without refetching. */
  taskMessages: (taskId: string) => ["task-messages", taskId] as const,
};

// UUID gate mirrors `packages/core/chat/queries.ts`: optimistic task ids
// (`optimistic-…`) are not real backend rows, so the query must be
// disabled until we have a server-issued UUID. Returning the cache for
// an optimistic id would 404 the API.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTaskMessageTaskId(
  taskId: string | null | undefined,
): taskId is string {
  return typeof taskId === "string" && UUID_PATTERN.test(taskId);
}

/**
 * Whether this client already holds a timeline cache entry for `taskId`.
 *
 * `task:message` is a workspace-wide fanout: every client receives every run's
 * frames, but only the runs a screen actually opened are ever rendered. Entry
 * presence is the gate — mounting a `useQuery` registers it before the fetch
 * resolves, so a frame landing mid-backfill is still kept, while frames for
 * runs nobody opened are dropped instead of accumulating a transcript (tool
 * input included) the user will never look at.
 *
 * Dropping a frame for an unregistered task is safe: the row is persisted
 * before it is broadcast, so whoever opens the task next fetches it.
 *
 * Mirrors `isTaskMessageTimelineHeld` in packages/core/chat/queries.ts —
 * mobile owns its own copy per the "mirror, don't import" rule.
 */
export function isTaskMessageTimelineHeld(
  qc: QueryClient,
  taskId: string,
): boolean {
  return (
    qc.getQueryCache().find({ queryKey: chatKeys.taskMessages(taskId) }) !==
    undefined
  );
}

export const chatSessionsOptions = (wsId: string | null) =>
  queryOptions({
    queryKey: chatKeys.sessions(wsId),
    queryFn: ({ signal }) => api.listChatSessions({ signal }),
    enabled: !!wsId,
    staleTime: Infinity,
  });

export const chatMessagesOptions = (sessionId: string | null) =>
  queryOptions({
    queryKey: chatKeys.messages(sessionId ?? ""),
    queryFn: ({ signal }) => api.listChatMessages(sessionId!, { signal }),
    enabled: !!sessionId,
    staleTime: Infinity,
  });

export const pendingChatTaskOptions = (sessionId: string | null) =>
  queryOptions({
    queryKey: chatKeys.pendingTask(sessionId ?? ""),
    queryFn: ({ signal }) => api.getPendingChatTask(sessionId!, { signal }),
    enabled: !!sessionId,
    staleTime: Infinity,
  });

export const taskMessagesOptions = (taskId: string | null | undefined) =>
  queryOptions({
    queryKey: chatKeys.taskMessages(taskId ?? ""),
    queryFn: ({ signal }) => api.listTaskMessages(taskId!, { signal }),
    enabled: isTaskMessageTaskId(taskId),
    staleTime: Infinity,
  });
