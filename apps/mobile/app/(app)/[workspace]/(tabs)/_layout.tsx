/**
 * Bottom tab bar — native SwiftUI tabs via expo-router's `NativeTabs`.
 *
 * Why native rather than the JS `<Tabs>` we used before: on iOS 26 the system
 * tab bar is the Liquid Glass bar — it floats, refracts the content behind it,
 * and shrinks out of the way as you scroll (`minimizeBehavior`). None of that
 * is reproducible by tinting a JS tab bar; it has to be the real UITabBar.
 * Older iOS falls back to the standard opaque bar on its own, so there is no
 * version branch to write here.
 *
 * The trade this cost us: `NativeTabs`' tabPress has `canPreventDefault:
 * false`, so the old "tap More → open a dropdown popover anchored over the
 * bar" trick is impossible. More is now an ordinary destination screen
 * ((tabs)/more.tsx) holding the same entries the popover did. That is also
 * the plainer iOS idiom — a More tab that opens a list is what Apple's own
 * apps do once they exceed the bar.
 *
 * Projects graduated from a row inside More to its own tab, so the More list
 * no longer carries it.
 */
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  useInboxUnreadCount,
  useChatUnreadMessageCount,
} from "@/lib/unread-counts";

// Icon / Label / Badge hang off Trigger, not off NativeTabs. Destructured so
// the tree below reads as markup rather than as three-level property chains.
const { Trigger } = NativeTabs;
const { Icon, Label, Badge } = Trigger;

/** Truncation aligned with web's sidebar badges. `undefined` renders no
 *  badge at all, so a zero count is a free no-op. */
function badgeValue(count: number): string | undefined {
  if (count <= 0) return undefined;
  return count > 99 ? "99+" : String(count);
}

export default function TabsLayout() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const inboxBadge = badgeValue(useInboxUnreadCount(wsId));
  const chatBadge = badgeValue(useChatUnreadMessageCount(wsId));

  return (
    // onScrollDown: the bar collapses to a pill while reading a long list and
    // springs back the moment you scroll up — the iOS 26 behaviour users get
    // in Mail / Safari. Tint and material are left to the system so the glass
    // picks up the wallpaper and the light/dark transition for free.
    <NativeTabs minimizeBehavior="onScrollDown">
      <Trigger name="inbox">
        <Icon sf={{ default: "tray", selected: "tray.fill" }} />
        <Label>Inbox</Label>
        {inboxBadge ? <Badge>{inboxBadge}</Badge> : null}
      </Trigger>

      <Trigger name="my-issues">
        <Icon sf={{ default: "checklist.unchecked", selected: "checklist" }} />
        <Label>My Issues</Label>
      </Trigger>

      <Trigger name="projects">
        <Icon sf={{ default: "square.stack", selected: "square.stack.fill" }} />
        <Label>Projects</Label>
      </Trigger>

      <Trigger name="chat">
        <Icon sf={{ default: "bubble.left", selected: "bubble.left.fill" }} />
        <Label>Chat</Label>
        {chatBadge ? <Badge>{chatBadge}</Badge> : null}
      </Trigger>

      <Trigger name="more">
        <Icon sf="ellipsis" />
        <Label>More</Label>
      </Trigger>
    </NativeTabs>
  );
}
