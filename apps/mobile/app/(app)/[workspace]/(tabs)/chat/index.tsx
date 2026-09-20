/**
 * Chat list — the root of the Chat tab.
 *
 * Replaces the formSheet session picker the single-screen chat used to open
 * from its title. A pushed list/detail pair costs the same tap to switch
 * conversations, but it gives the tab a place to go Back to, makes each
 * conversation its own route, and lets the Stack remember which one was open
 * across tab switches.
 *
 * Creating a chat lives here rather than in the conversation: the agent has
 * to be chosen before a session exists, so the picker belongs on the screen
 * that has no session yet. One available agent skips the picker entirely.
 */
import { useCallback, useMemo, useState } from "react";
import {
  ActionSheetIOS,
  Alert,
  FlatList,
  Pressable,
  View,
} from "react-native";
import { router } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import type { Agent, ChatSession } from "@multica/core/types";
import { canAssignAgentToIssue } from "@multica/core/permissions";
import { sortChatSessions } from "@multica/core/chat/queries";
import { Image } from "expo-image";
import { Text } from "@/components/ui/text";
import { Header } from "@/components/ui/header";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { ChatSessionActions } from "@/components/chat/chat-session-actions";
import { AgentPickerSheet } from "@/components/chat/agent-picker-sheet";
import { NoAgentBanner } from "@/components/chat/no-agent-banner";
import { chatSessionsOptions } from "@/data/queries/chat";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import {
  useDeleteChatSession,
  useRenameChatSession,
  useSetChatSessionPinned,
} from "@/data/mutations/chat";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useChatImmersiveStore } from "@/data/stores/chat-immersive-store";
import { chatSessionDisplayTitle } from "@/lib/chat-session-title";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export default function ChatListScreen() {
  // Backstop for the tab bar. The conversation's transition listener is what
  // makes hiding and showing feel immediate, but a missed event there used to
  // strand the bar off-screen with no way back. Standing on the list is proof
  // no conversation is open, so assert it on every focus.
  const setInConversation = useChatImmersiveStore((s) => s.setInConversation);
  useFocusEffect(
    useCallback(() => setInConversation(false), [setInConversation]),
  );

  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  // Targets are built as absolute `/{slug}/chat/...` paths, matching every
  // other screen here. A relative `./id` resolves against the route rather
  // than the directory, which collapsed to a pathless `multica:///` and hit
  // the Unmatched Route screen.
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const userId = useAuthStore((s) => s.user?.id);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);

  const { data: sessions = [] } = useQuery(chatSessionsOptions(wsId));
  // Pinned first, then most-recent activity — the same shared comparator the
  // server and web order by, so a pin looks identical everywhere. Re-sorting
  // here rather than trusting the payload also covers the optimistic pin,
  // which patches the flat cache before the refetch lands.
  const orderedSessions = useMemo(() => sortChatSessions(sessions), [sessions]);
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const deleteSession = useDeleteChatSession();
  const renameSession = useRenameChatSession();
  const setPinned = useSetChatSessionPinned();

  const memberRole = members.find((m) => m.user_id === userId)?.role ?? null;
  // Same invoke gate the conversation applies: starting a chat enqueues a run,
  // so only agents this user may actually trigger can seed one (MUL-6380).
  const availableAgents = agents.filter(
    (a) =>
      !a.archived_at &&
      canAssignAgentToIssue(a, { userId: userId ?? null, role: memberRole })
        .allowed,
  );

  const openSession = useCallback(
    (id: string) => {
      if (wsSlug) router.push(`/${wsSlug}/chat/${id}`);
    },
    [wsSlug],
  );

  const startNewChat = useCallback(() => {
    if (availableAgents.length > 1) {
      setAgentPickerOpen(true);
      return;
    }
    if (wsSlug) router.push(`/${wsSlug}/chat/new`);
  }, [availableAgents.length, wsSlug]);

  const handlePickAgent = useCallback(
    (agent: Agent) => {
      setAgentPickerOpen(false);
      if (wsSlug) {
        router.push({
          pathname: "/[workspace]/chat/[sessionId]",
          params: { workspace: wsSlug, sessionId: "new", agentId: agent.id },
        });
      }
    },
    [wsSlug],
  );

  const confirmDelete = useCallback(
    (session: ChatSession) => {
      Alert.alert(
        "Delete this chat?",
        chatSessionDisplayTitle(session.title),
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => deleteSession.mutate(session.id),
          },
        ],
        { cancelable: true },
      );
    },
    [deleteSession],
  );

  const promptRename = useCallback(
    (session: ChatSession) => {
      // Alert.prompt is the native text-entry affordance the mobile
      // instructions call for; a formSheet for one field would be heavier
      // than the edit.
      Alert.prompt(
        "Rename chat",
        undefined,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save",
            onPress: (next?: string) => {
              const title = (next ?? "").trim();
              // Unchanged or emptied: nothing to send. The server would
              // reject an empty title anyway.
              if (!title || title === session.title) return;
              renameSession.mutate({ id: session.id, title });
            },
          },
        ],
        "plain-text",
        session.title,
      );
    },
    [renameSession],
  );

  /** Long-press menu. Pin sits first because it is the reversible one;
   *  Delete is last and destructive, matching every other row menu here. */
  const openSessionActions = useCallback(
    (session: ChatSession) => {
      const pinned = session.pinned === true;
      const options = [
        pinned ? "Unpin" : "Pin to top",
        "Rename",
        "Delete",
        "Cancel",
      ];
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: chatSessionDisplayTitle(session.title),
          options,
          destructiveButtonIndex: 2,
          cancelButtonIndex: 3,
        },
        (index) => {
          if (index === 0) {
            setPinned.mutate({ id: session.id, pinned: !pinned });
          } else if (index === 1) {
            promptRename(session);
          } else if (index === 2) {
            confirmDelete(session);
          }
        },
      );
    },
    [confirmDelete, promptRename, setPinned],
  );

  return (
    <View className="flex-1 bg-background">
      <Header
        title="Chat"
        right={
          availableAgents.length > 0 ? (
            <ChatSessionActions showMore={false} onNewPress={startNewChat} />
          ) : null
        }
      />
      {agents.length === 0 ? <NoAgentBanner /> : null}

      <FlatList
        data={orderedSessions}
        keyExtractor={(s) => s.id}
        ItemSeparatorComponent={() => <View className="ml-4 h-px bg-border" />}
        ListEmptyComponent={
          <View className="items-center px-6 py-10">
            <Text className="text-center text-sm text-muted-foreground">
              No chats yet.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <ChatSessionRow
            session={item}
            onPress={() => openSession(item.id)}
            onLongPress={() => openSessionActions(item)}
          />
        )}
        contentContainerClassName="pb-6"
      />

      <AgentPickerSheet
        visible={agentPickerOpen}
        agents={availableAgents}
        currentAgentId={null}
        onPick={handlePickAgent}
        onClose={() => setAgentPickerOpen(false)}
      />
    </View>
  );
}

/** Same row the picker sheet used, minus the check mark — on a list screen
 *  "which one is open" is answered by the screen you're on, not a tick.
 *  Long-press to delete is kept from the sheet: it is the only destructive
 *  action here and a swipe would collide with the Stack's back gesture. */
function ChatSessionRow({
  session,
  onPress,
  onLongPress,
}: {
  session: ChatSession;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const archived = session.status === "archived";
  const { colorScheme } = useColorScheme();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={chatSessionDisplayTitle(session.title)}
      className="flex-row items-center gap-3 px-4 py-3 active:bg-secondary"
    >
      <View
        className={cn(
          "h-2 w-2 rounded-full",
          session.has_unread ? "bg-primary" : "bg-transparent",
        )}
      />
      <ActorAvatar type="agent" id={session.agent_id} size={32} showPresence />
      <View className="flex-1">
        <View className="flex-row items-center gap-1.5">
          {/* Sort order alone doesn't say "pinned" — the top row of any list
              looks the same either way. */}
          {session.pinned ? (
            <Image
              source="sf:pin.fill"
              tintColor={THEME[colorScheme].mutedForeground}
              style={{ width: 11, height: 11 }}
            />
          ) : null}
          <Text
            className={cn(
              "flex-1 text-sm text-foreground",
              session.has_unread && "font-semibold",
            )}
            numberOfLines={1}
          >
            {chatSessionDisplayTitle(session.title)}
          </Text>
        </View>
        {archived ? (
          <Text className="mt-0.5 text-xs text-muted-foreground">archived</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
