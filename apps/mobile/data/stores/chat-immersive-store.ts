/**
 * Whether a conversation is on screen, so the tab bar can get out of its way.
 *
 * Why a store rather than reading the route: `usePathname()` only changes once
 * the navigation state commits, which for a pop is the END of the transition.
 * The tab bar then snapped back in after the screen had already slid away —
 * visibly late. The chat Stack flips this from `transitionStart` instead, so
 * the bar animates together with the screen.
 */
import { create } from "zustand";

interface ChatImmersiveState {
  /** True while a conversation screen is being shown or is on screen. */
  inConversation: boolean;
  setInConversation: (value: boolean) => void;
}

export const useChatImmersiveStore = create<ChatImmersiveState>((set) => ({
  inConversation: false,
  setInConversation: (value) =>
    set((state) =>
      state.inConversation === value ? state : { inConversation: value },
    ),
}));
