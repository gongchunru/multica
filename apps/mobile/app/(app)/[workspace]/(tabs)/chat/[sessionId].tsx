/**
 * One conversation — the detail half of the Chat tab's list/detail pair.
 *
 * Which session is open is now the URL, not component state: `[sessionId]`
 * is the route param, and the literal `new` opens the blank compose state.
 * That swap is what buys the tab its memory — the chat Stack keeps this
 * screen mounted when you leave for another tab, so coming back lands on the
 * same conversation instead of resetting to the list. It also makes the back
 * button real (chat/index) and the screen deep-linkable.
 *
 * A brand-new chat has no id until the first send creates one. Rather than
 * push a second screen at that moment, `router.setParams` rewrites `new` to
 * the real id in place: the transcript never unmounts mid-send, and Back
 * still returns to the list rather than to a stale blank compose screen.
 *
 * Layout:
 *   Stack header (native — back button + swipe-to-dismiss come from it)
 *   View ─ (NoAgentBanner?)
 *        ─ View ─ ChatMessageList (live status + timeline in its ListFooter)
 *               ─ OfflineBanner
 *               ─ ChatComposer (lifts itself over the keyboard and owns the
 *                               bottom safe-area inset)
 *
 * Optimistic send burst mirrors web's chat-window.tsx send sequence
 * (packages/views/chat/components/chat-window.tsx ~262-345):
 *   seed messages → seed pendingTask → adopt the new id → POST →
 *   patch pendingTask with server task_id + created_at.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useFocusEffect, useIsFocused } from "@react-navigation/native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  Agent,
  ChatMessage,
  ChatPendingTask,
} from "@multica/core/types";
import {
  enqueuePendingChatTask,
  hideQueuedChatMessages,
  removePendingChatTask,
} from "@multica/core/chat/pending";
import { canAssignAgentToIssue } from "@multica/core/permissions";
import { api } from "@/data/api";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import {
  chatKeys,
  chatMessagesOptions,
  chatSessionsOptions,
  pendingChatTaskOptions,
  taskMessagesOptions,
} from "@/data/queries/chat";
import {
  useCreateChatSession,
  useDeleteChatSession,
  useMarkChatSessionRead,
} from "@/data/mutations/chat";
import {
  DRAFT_NEW_SESSION,
  useChatDraftsStore,
} from "@/data/stores/chat-drafts-store";
import { useChatSessionRealtime } from "@/data/realtime/use-chat-session-realtime";
import {
  invalidatePendingTask,
  seedAcceptedPendingTask,
} from "@/data/realtime/chat-ws-updaters";
import { useWorkspaceAgentAvailability } from "@/lib/workspace-agent-availability";
import { sendFailureMessage } from "@/lib/dispatch-reason";
import { useAgentPresence } from "@/lib/use-agent-presence";
import { ChatSessionActions } from "@/components/chat/chat-session-actions";
import { ChatMessageList } from "@/components/chat/chat-message-list";
import { ChatComposer } from "@/components/chat/chat-composer";
import { AgentPickerSheet } from "@/components/chat/agent-picker-sheet";
import { NoAgentBanner } from "@/components/chat/no-agent-banner";
import { OfflineBanner } from "@/components/chat/offline-banner";
import { RuntimeRequiredBanner } from "@/components/chat/runtime-required-banner";
import { useChatSelectStore } from "@/data/chat-select-store";
import { isAgentRuntimeBound } from "@/lib/is-agent-runtime-bound";
import { chatSessionDisplayTitle } from "@/lib/chat-session-title";

/** Route sentinel for the not-yet-created conversation. A real session id is
 *  a UUID, so this can never collide with one. */
const NEW_SESSION = "new";

export default function ChatSessionScreen() {
  const qc = useQueryClient();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id);

  const { sessionId: routeSessionId, agentId: routeAgentId } =
    useLocalSearchParams<{ sessionId: string; agentId?: string }>();
  const activeSessionId =
    routeSessionId === NEW_SESSION ? null : (routeSessionId ?? null);

  // Only meaningful for a new chat: the list screen passes the agent the user
  // picked before navigating here. An existing session resolves its agent from
  // the session record instead, so this stays null there.
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    routeAgentId ?? null,
  );
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);

  // ── Server state ───────────────────────────────────────────────────────
  const { data: sessions = [] } = useQuery(chatSessionsOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));

  const { data: messages = [], isLoading: messagesLoading } = useQuery(
    chatMessagesOptions(activeSessionId),
  );
  const { data: pendingTask } = useQuery(
    pendingChatTaskOptions(activeSessionId),
  );
  const visibleMessages = hideQueuedChatMessages(messages, pendingTask);
  // Live execution trace for the in-flight task. `task:message` WS events
  // append rows to this same cache key via `appendTaskMessage`, so the
  // list/pill stay in sync without a polling fetch. `enabled` is gated by
  // `isTaskMessageTaskId` inside taskMessagesOptions — optimistic ids
  // never hit the network.
  const { data: liveTaskMessages = [] } = useQuery(
    taskMessagesOptions(pendingTask?.task_id),
  );

  // ── Derived ────────────────────────────────────────────────────────────
  const memberRole = useMemo(
    () => members.find((m) => m.user_id === userId)?.role ?? null,
    [members, userId],
  );

  // The picker must list only agents this user can actually TRIGGER — sending
  // a message enqueues a run, so it clears the server's invoke gate
  // (`canInvokeAgent`), which has no admin bypass. Shared rule, not a mobile
  // copy: a local mirror drifted from it and let admins pick a teammate's
  // personal agent only to be 403'd on send (MUL-6380 / GH #7180).
  const availableAgents = useMemo(
    () =>
      agents.filter(
        (a) =>
          !a.archived_at &&
          canAssignAgentToIssue(a, { userId: userId ?? null, role: memberRole })
            .allowed,
      ),
    [agents, userId, memberRole],
  );

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? null,
    [sessions, activeSessionId],
  );

  // Active agent: explicit selection wins; otherwise inherit from the
  // active session; otherwise pick the first available agent.
  const currentAgent: Agent | null = useMemo(() => {
    if (selectedAgentId) {
      return availableAgents.find((a) => a.id === selectedAgentId) ?? null;
    }
    if (activeSession) {
      return agents.find((a) => a.id === activeSession.agent_id) ?? null;
    }
    return availableAgents[0] ?? null;
  }, [selectedAgentId, availableAgents, activeSession, agents]);

  // A session outlives the permission that created it: the agent can be flipped
  // to personal, change owner, or drop this member from its allow-list, and the
  // server then refuses every send with `invocation_not_allowed` while still
  // serving the transcript (MUL-4525 — read uses the view gate, send re-runs the
  // invoke gate). `currentAgent` deliberately resolves an open session's agent
  // from the FULL list so the header stays honest, which means the picker filter
  // above cannot cover this case — judge the bound agent too (MUL-6380).
  const accessRevoked =
    currentAgent !== null &&
    !canAssignAgentToIssue(currentAgent, {
      userId: userId ?? null,
      role: memberRole,
    }).allowed;

  const availability = useWorkspaceAgentAvailability();
  const presenceDetail = useAgentPresence(wsId, currentAgent?.id);
  const presenceAvailability =
    presenceDetail === "loading" ? undefined : presenceDetail.availability;
  const isArchived = activeSession?.status === "archived";
  const runtimeBound =
    currentAgent !== null && isAgentRuntimeBound(currentAgent);
  const sending = !!pendingTask?.task_id;

  // ── Drafts ─────────────────────────────────────────────────────────────
  const draftKey = activeSessionId ?? DRAFT_NEW_SESSION;
  const draft = useChatDraftsStore((s) => s.drafts[draftKey] ?? "");
  const setDraft = useChatDraftsStore((s) => s.setDraft);
  const clearDraft = useChatDraftsStore((s) => s.clearDraft);
  const promoteNewDraft = useChatDraftsStore((s) => s.promoteNewDraft);

  // ── Realtime ───────────────────────────────────────────────────────────
  // Deleted from another device while open: there is nothing left to show, so
  // unwind to the list rather than leaving a transcript that no longer exists.
  useChatSessionRealtime(activeSessionId, () => {
    router.back();
  });

  // Exit text-selection mode whenever the chat tab loses focus. Expo
  // Router bottom tabs stay mounted across tab switches, so a plain
  // useEffect cleanup wouldn't fire — useFocusEffect is the navigation-
  // aware equivalent.
  useFocusEffect(
    useCallback(() => () => useChatSelectStore.getState().clear(), []),
  );

  // ── Auto markRead while viewing a session with unread state ──────────
  const isFocused = useIsFocused();
  const markRead = useMarkChatSessionRead();
  useEffect(() => {
    if (!isFocused) return;
    if (!activeSessionId) return;
    if (!activeSession?.has_unread) return;
    markRead.mutate(activeSessionId);
  }, [isFocused, activeSessionId, activeSession?.has_unread, markRead]);

  // ── Mutations ──────────────────────────────────────────────────────────
  const createSession = useCreateChatSession();
  const deleteSession = useDeleteChatSession();

  // ── Send burst ─────────────────────────────────────────────────────────
  const sessionPromiseRef = useRef<Promise<string | null> | null>(null);

  const ensureSession = useCallback(
    async (titleSeed: string): Promise<string | null> => {
      if (activeSessionId) return activeSessionId;
      if (!currentAgent) return null;
      if (sessionPromiseRef.current) return sessionPromiseRef.current;

      const promise = (async () => {
        try {
          const session = await createSession.mutateAsync({
            agent_id: currentAgent.id,
            title: titleSeed.slice(0, 50),
          });
          return session.id;
        } finally {
          sessionPromiseRef.current = null;
        }
      })();
      sessionPromiseRef.current = promise;
      return promise;
    },
    [activeSessionId, currentAgent, createSession],
  );

  const handleSend = useCallback(
    async (
      content: string,
      attachmentIds: string[] = [],
      options: { clearDraft?: boolean } = {},
    ) => {
      if (!currentAgent) return;
      // Invoke permission was revoked while this session was open — the server
      // would refuse before persisting anything. The composer is disabled in
      // this state; this is the belt-and-braces guard.
      if (accessRevoked) {
        Alert.alert(
          "No permission to run this agent",
          "You no longer have permission to run this agent, so the message was not sent. Ask its owner for access.",
        );
        return;
      }
      if (!runtimeBound) {
        Alert.alert(
          "Runtime required",
          "Bind a runtime to this agent on web or desktop before sending a message.",
        );
        return;
      }

      const isNewSession = !activeSessionId;
      let sessionId: string | null;
      try {
        sessionId = await ensureSession(content);
      } catch (err) {
        // Session create runs the same invoke gate as a send, so a permission
        // change refuses here too — and this is the only layer that sees the
        // reason code (MUL-6380).
        Alert.alert("Message not sent", sendFailureMessage(err));
        throw err;
      }
      if (!sessionId) return;

      const sentAt = new Date().toISOString();
      const optimistic: ChatMessage = {
        id: `optimistic-${Date.now()}`,
        chat_session_id: sessionId,
        role: "user",
        content,
        task_id: null,
        created_at: sentAt,
      };
      const optimisticTaskId = `optimistic-${optimistic.id}`;
      qc.setQueryData<ChatMessage[]>(chatKeys.messages(sessionId), (old) =>
        old ? [...old, optimistic] : [optimistic],
      );
      qc.setQueryData<ChatPendingTask>(
        chatKeys.pendingTask(sessionId),
        (old) =>
          enqueuePendingChatTask(
            old,
            {
              task_id: optimisticTaskId,
              status: "queued",
              created_at: sentAt,
              message_id: optimistic.id,
              content,
            },
            Boolean(old?.task_id),
          ),
      );
      if (isNewSession) {
        promoteNewDraft(sessionId);
        // Adopt the id in place. A push/replace here would remount the screen
        // mid-send and drop the optimistic bubble we just seeded; setParams
        // keeps this exact screen and only swaps `new` for the real id, so
        // Back still goes to the list.
        router.setParams({ sessionId });
      }

      try {
        const result = await api.sendChatMessage(sessionId, content, {
          attachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        });
        // Replace the local bubble before reconciling pending state. When the
        // server says this is a follow-up, its real message id lets the shared
        // queue filter hide it immediately instead of waiting for the refetch.
        qc.setQueryData<ChatMessage[]>(chatKeys.messages(sessionId), (old) =>
          old?.map((message) =>
            message.id === optimistic.id
              ? {
                  ...message,
                  id: result.message_id,
                  task_id: result.task_id,
                  created_at: result.created_at,
                }
              : message,
          ),
        );
        seedAcceptedPendingTask(qc, {
          chat_session_id: sessionId,
          task_id: result.task_id,
          created_at: result.created_at,
          message_id: result.message_id,
          content,
          optimistic_task_id: optimisticTaskId,
          supports_queue: result.supports_queue,
          queued: result.queued,
        });
        qc.invalidateQueries({ queryKey: chatKeys.messages(sessionId) });
        if (options.clearDraft !== false) {
          clearDraft(sessionId);
        }
      } catch (err) {
        qc.setQueryData<ChatMessage[]>(chatKeys.messages(sessionId), (old) =>
          old ? old.filter((m) => m.id !== optimistic.id) : old,
        );
        qc.setQueryData<ChatPendingTask>(
          chatKeys.pendingTask(sessionId),
          (old) => removePendingChatTask(old, optimisticTaskId),
        );
        // The composer restores the draft on a thrown rejection but says nothing
        // about it, so a revoked-permission 403 used to read as a silent no-op
        // (MUL-6380). Name the cause here: only this layer sees the error body.
        Alert.alert("Message not sent", sendFailureMessage(err));
        throw err;
      }
    },
    [
      activeSessionId,
      currentAgent,
      accessRevoked,
      runtimeBound,
      ensureSession,
      qc,
      promoteNewDraft,
      clearDraft,
    ],
  );

  // ── Cancel in-flight ───────────────────────────────────────────────────
  const handleStop = useCallback(() => {
    if (!pendingTask?.task_id || !activeSessionId) return;
    if (pendingTask.status === "queued") return;
    const taskId = pendingTask.task_id;
    const sessionId = activeSessionId;
    qc.setQueryData<ChatPendingTask>(chatKeys.pendingTask(sessionId), (old) =>
      removePendingChatTask(old, taskId),
    );
    void api.cancelTaskById(taskId)
      .catch(() => {
        // Silent — task may have already terminated server-side.
      })
      .finally(() => invalidatePendingTask(qc, sessionId));
  }, [pendingTask?.task_id, pendingTask?.status, activeSessionId, qc]);

  // ── Header actions ─────────────────────────────────────────────────────
  // Swapping the agent only makes sense before a session exists — an open
  // session is bound to the agent that created it. So picking one here just
  // rewrites this blank screen's agent rather than navigating anywhere.
  const handlePickAgent = useCallback((agent: Agent) => {
    setSelectedAgentId(agent.id);
    setAgentPickerOpen(false);
  }, []);

  const handleDeleteActive = useCallback(() => {
    if (!activeSession) return;
    Alert.alert(
      "Delete this chat?",
      chatSessionDisplayTitle(activeSession.title),
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            // Leave before the row disappears: staying would render a
            // transcript whose session is already gone from the cache.
            router.back();
            deleteSession.mutate(activeSession.id);
          },
        },
      ],
      { cancelable: true },
    );
  }, [activeSession, deleteSession]);

  // ── Composer disabled-state ────────────────────────────────────────────
  const disabled =
    !currentAgent ||
    accessRevoked ||
    availability === "none" ||
    isArchived === true ||
    !runtimeBound;
  const disabledReason = !currentAgent
    ? "No agent selected"
    : accessRevoked
      ? "You can no longer run this agent"
      : availability === "none"
        ? "No agents in this workspace"
        : isArchived
          ? "This chat is archived"
          : !runtimeBound
            ? "Agent needs a runtime"
          : undefined;

  return (
    <View className="flex-1 bg-background">
      {/* Native header, not the tab-root <Header>: this is a push screen now,
          and the iOS back button + swipe-to-dismiss come with it. The title
          is plain text rather than the old tappable ChatTitleButton — the
          list it used to open is the screen behind Back. */}
      <Stack.Screen
        options={{
          title: activeSession
            ? chatSessionDisplayTitle(activeSession.title)
            : (currentAgent?.name ?? "New chat"),
          headerRight: () =>
            activeSession ? (
              <ChatSessionActions showMore onMorePress={handleDeleteActive} />
            ) : null,
        }}
      />
      {availability === "none" ? <NoAgentBanner /> : null}
      {/* No KeyboardAvoidingView: ChatComposer lifts itself with
          KeyboardStickyView (react-native-keyboard-controller) and owns the
          bottom safe-area inset, the same as the comment composer. Wrapping
          it here too would double-stack the lift. */}
      <View className="flex-1">
        <ChatMessageList
          messages={visibleMessages}
          loading={messagesLoading}
          hasSessions={sessions.length > 0}
          agent={currentAgent}
          onPickPrompt={(text) => setDraft(draftKey, text)}
          onQuickAction={(action) =>
            handleSend(action.prompt, [], { clearDraft: false })
          }
          quickActionsDisabled={sending || disabled}
          pendingTask={pendingTask}
          liveTaskMessages={liveTaskMessages}
          availability={presenceAvailability}
        />
        {runtimeBound ? (
          <OfflineBanner
            agentName={currentAgent?.name}
            availability={presenceAvailability}
          />
        ) : currentAgent ? (
          <RuntimeRequiredBanner agentName={currentAgent.name} />
        ) : null}
        <ChatComposer
          value={draft}
          onChangeText={(next) => setDraft(draftKey, next)}
          onSend={handleSend}
          onStop={handleStop}
          sending={sending}
          allowStop={pendingTask?.status !== "queued"}
          disabled={disabled}
          disabledReason={disabledReason}
        />
      </View>

      <AgentPickerSheet
        visible={agentPickerOpen}
        agents={availableAgents}
        currentAgentId={currentAgent?.id ?? null}
        onPick={handlePickAgent}
        onClose={() => setAgentPickerOpen(false)}
      />
    </View>
  );
}
