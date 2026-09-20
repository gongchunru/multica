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

export default function ChatStackLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[sessionId]" options={{ headerBackTitle: "Chats" }} />
    </Stack>
  );
}
