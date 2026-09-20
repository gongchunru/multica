/**
 * Right-side actions for the Chat headers. Up to two buttons:
 *   - ⋯ (session menu): only when an active session exists.
 *   - + (new chat): only where creating one belongs.
 *
 * `onNewPress` is optional because the list and the conversation want
 * different halves of this: the list owns creation (+), a conversation owns
 * only its own menu (⋯). Passing neither renders nothing.
 *
 * Both are RNR `<Button variant="ghost" size="icon">` via IconButton, so
 * touch feedback / sizing / dark-mode tinting are all consistent with the
 * rest of the header toolbar.
 */
import { IconButton } from "@/components/ui/icon-button";

interface Props {
  showMore: boolean;
  onMorePress?: () => void;
  onNewPress?: () => void;
}

export function ChatSessionActions({
  showMore,
  onMorePress,
  onNewPress,
}: Props) {
  return (
    <>
      {showMore && onMorePress ? (
        <IconButton
          name="ellipsis-horizontal"
          onPress={onMorePress}
          accessibilityLabel="Session actions"
        />
      ) : null}
      {onNewPress ? (
        <IconButton
          name="add"
          iconSize={24}
          onPress={onNewPress}
          accessibilityLabel="New chat"
        />
      ) : null}
    </>
  );
}
