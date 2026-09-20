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
import { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { Agent, ChatSession } from "@multica/core/types";
import { canAssignAgentToIssue } from "@multica/core/permissions";
import { Text } from "@/components/ui/text";
import { Header } from "@/components/ui/header";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { ChatSessionActions } from "@/components/chat/chat-session-actions";
import { AgentPickerSheet } from "@/components/chat/agent-picker-sheet";
import { NoAgentBanner } from "@/components/chat/no-agent-banner";
import { chatSessionsOptions } from "@/data/queries/chat";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { useDeleteChatSession } from "@/data/mutations/chat";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { chatSessionDisplayTitle } from "@/lib/chat-session-title";
import { cn } from "@/lib/utils";

export default function ChatListScreen() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id);
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);

  const { data: sessions = [] } = useQuery(chatSessionsOptions(wsId));
  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const deleteSession = useDeleteChatSession();

  const memberRole = members.find((m) => m.user_id === userId)?.role ?? null;
  // Same invoke gate the conversation applies: starting a chat enqueues a run,
  // so only agents this user may actually trigger can seed one (MUL-6380).
  const availableAgents = agents.filter(
    (a) =>
      !a.archived_at &&
      canAssignAgentToIssue(a, { userId: userId ?? null, role: memberRole })
        .allowed,
  );

  const openSession = useCallback((id: string) => {
    router.push(`./${id}`);
  }, []);

  const startNewChat = useCallback(() => {
    if (availableAgents.length > 1) {
      setAgentPickerOpen(true);
      return;
    }
    router.push("./new");
  }, [availableAgents.length]);

  const handlePickAgent = useCallback((agent: Agent) => {
    setAgentPickerOpen(false);
    router.push({ pathname: "./new", params: { agentId: agent.id } });
  }, []);

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
        data={sessions}
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
            onLongPress={() => confirmDelete(item)}
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
        <Text
          className={cn(
            "text-sm text-foreground",
            session.has_unread && "font-semibold",
          )}
          numberOfLines={1}
        >
          {chatSessionDisplayTitle(session.title)}
        </Text>
        {archived ? (
          <Text className="mt-0.5 text-xs text-muted-foreground">archived</Text>
        ) : null}
      </View>
    </Pressable>
  );
}
