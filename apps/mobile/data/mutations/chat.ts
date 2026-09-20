/**
 * Mobile chat mutations — create session, delete session, mark session read.
 *
 * Send-message is NOT a mutation: the chat screen runs a hand-written
 * optimistic burst (seed messages cache → seed pendingTask cache → flip
 * activeSession → POST → patch with real task_id) that doesn't map cleanly
 * onto useMutation. See the chat tab screen for the send path.
 *
 * Mirrors the optimistic-update + rollback + onSettled-invalidate pattern
 * of data/mutations/inbox.ts and web's packages/core/chat/mutations.ts.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ChatSession } from "@multica/core/types";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
// Pure sorting helper, on the mobile sharing whitelist — importing it keeps
// the list in exactly the order the server and web produce.
import { sortChatSessions } from "@multica/core/chat/queries";
import { chatKeys } from "@/data/queries/chat";

export function useCreateChatSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (data: { agent_id: string; title?: string }) =>
      api.createChatSession(data),
    onSettled: () => {
      // Optimistic prepend isn't done here — the chat screen seeds caches
      // synchronously around its send burst and uses the returned session
      // id directly. The invalidate ensures the dropdown picks up the new
      // row (and any has_unread / title server defaults) without a refetch
      // race on switch.
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

export function useDeleteChatSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (id: string) => api.deleteChatSession(id),
    onMutate: async (id) => {
      const key = chatKeys.sessions(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatSession[]>(key);
      qc.setQueryData<ChatSession[]>(key, (old) =>
        old ? old.filter((s) => s.id !== id) : old,
      );
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: (_data, _err, id) => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
      // Detail-side caches the screen may still hold for this id.
      qc.removeQueries({ queryKey: chatKeys.messages(id) });
      qc.removeQueries({ queryKey: chatKeys.pendingTask(id) });
    },
  });
}

export function useMarkChatSessionRead() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: (sessionId: string) => api.markChatSessionRead(sessionId),
    onMutate: async (sessionId) => {
      const key = chatKeys.sessions(wsId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ChatSession[]>(key);
      // Zero unread_count together with has_unread — the tab badge sums
      // unread_count (see lib/unread-counts.ts), so clearing only the flag
      // would leave a stale badge until the settle refetch. Mirrors web's
      // useMarkChatSessionRead in packages/core/chat/mutations.ts.
      qc.setQueryData<ChatSession[]>(key, (old) =>
        old?.map((s) =>
          s.id === sessionId
            ? { ...s, has_unread: false, unread_count: 0 }
            : s,
        ),
      );
      return { prev, key };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

/**
 * Rename a chat. Title-only: the server's PATCH handler accepts exactly one
 * editable field per call and rejects a body carrying both.
 *
 * Patched in place rather than prepended — a rename must not reorder the list.
 * `chat:session_updated` follows with the authoritative title (the server
 * trims and length-caps it), so a rejected edit self-corrects.
 */
export function useRenameChatSession() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      api.renameChatSession(id, title),
    onMutate: async ({ id, title }) => {
      await qc.cancelQueries({ queryKey: chatKeys.sessions(wsId) });
      const previous = qc.getQueryData<ChatSession[]>(chatKeys.sessions(wsId));
      qc.setQueryData<ChatSession[]>(chatKeys.sessions(wsId), (old) =>
        old?.map((s) => (s.id === id ? { ...s, title } : s)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(chatKeys.sessions(wsId), context.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}

/**
 * Pin or unpin a chat. Pinned chats sort to the top of this user's list;
 * pin state is per-session and sessions are per-creator, so it is inherently
 * per-user.
 *
 * Re-sorts with the shared `sortChatSessions` so the optimistic row lands
 * where the server would have put it — patching `pinned` without re-sorting
 * would leave the list visibly out of order until the refetch.
 */
export function useSetChatSessionPinned() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  return useMutation({
    mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) =>
      api.setChatSessionPinned(id, pinned),
    onMutate: async ({ id, pinned }) => {
      await qc.cancelQueries({ queryKey: chatKeys.sessions(wsId) });
      const previous = qc.getQueryData<ChatSession[]>(chatKeys.sessions(wsId));
      qc.setQueryData<ChatSession[]>(chatKeys.sessions(wsId), (old) =>
        old
          ? sortChatSessions(
              old.map((s) => (s.id === id ? { ...s, pinned } : s)),
            )
          : old,
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        qc.setQueryData(chatKeys.sessions(wsId), context.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: chatKeys.sessions(wsId) });
    },
  });
}
