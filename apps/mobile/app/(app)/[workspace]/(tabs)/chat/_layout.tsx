/**
 * Chat tab's own Stack — list at the root, one conversation pushed on top.
 *
 * This Stack is what gives the tab its memory. Native tabs keep every tab's
 * navigator mounted, so a Stack sitting inside one remembers how deep you
 * were: open a conversation, wander off to Inbox, come back, and you are
 * still in that conversation. Nothing persists it by hand — leaving the
 * navigation state in the navigator is the whole mechanism.
 *
 * The list draws its own tab-root header; the conversation uses this native
 * one, which is where its back button and swipe-to-dismiss come from.
 */
import { Stack } from "expo-router";
import { useChatImmersiveStore } from "@/data/stores/chat-immersive-store";

export default function ChatStackLayout() {
  const setInConversation = useChatImmersiveStore((s) => s.setInConversation);

  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen
        name="[sessionId]"
        options={{ headerBackTitle: "Chats" }}
        // Only THIS screen's transitions speak for the tab bar. Listening on
        // the Stack instead caught the list screen's own transition, whose
        // `closing` is undefined — read as "entering a conversation", so
        // opening the Chat tab hid the bar with no pop coming to bring it
        // back. `transitionStart` is the point of it: the bar then moves with
        // the screen rather than trailing the committed route.
        listeners={{
          transitionStart: (e) => {
            const closing = (e.data as { closing?: boolean } | undefined)
              ?.closing;
            setInConversation(closing !== true);
          },
        }}
      />
    </Stack>
  );
}
