/**
 * Grouped-list rows for the More tab.
 *
 * These replace the DropdownMenuItem rows the More popover used before it
 * became a screen. Same two shapes as that popover had — an identity row
 * (avatar + title + optional subtitle) and a plain icon + label row — so the
 * tab reads as the same menu, just in place.
 *
 * `chevron.right` is the standard disclosure indicator: every row here
 * descends into something. A row with no `onPress` renders inert and drops
 * the chevron, which is how the workspace row presents itself when the user
 * belongs to exactly one workspace.
 */
import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import type { SFSymbol } from "sf-symbols-typescript";
import { Text } from "@/components/ui/text";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const ROW_CLASS = "flex-row items-center gap-3 px-4 min-h-12";

function Chevron({ tint }: { tint: string }) {
  return (
    <Image
      source="sf:chevron.right"
      tintColor={tint}
      style={{ width: 12, height: 12 }}
    />
  );
}

export function MoreRow({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: SFSymbol;
  onPress: () => void;
}) {
  const { colorScheme } = useColorScheme();
  const t = THEME[colorScheme];

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn(ROW_CLASS, "active:bg-secondary")}
    >
      <Image
        source={`sf:${icon}`}
        tintColor={t.foreground}
        style={{ width: 20, height: 20 }}
      />
      <Text className="flex-1 text-base text-foreground">{label}</Text>
      <Chevron tint={t.mutedForeground} />
    </Pressable>
  );
}

export function IdentityRow({
  title,
  subtitle,
  avatarUrl,
  fallbackText,
  leading,
  onPress,
  accessibilityLabel,
}: {
  title: string;
  subtitle?: string;
  avatarUrl?: string | null;
  fallbackText?: string;
  /** Pre-built avatar. Wins over `avatarUrl` / `fallbackText` when given —
   *  the workspace row needs WorkspaceAvatar's own initial/colour rules. */
  leading?: React.ReactNode;
  /** Omit to render the row inert (no press feedback, no chevron). */
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const { colorScheme } = useColorScheme();
  const t = THEME[colorScheme];

  const body = (
    <>
      {leading ?? (
        avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={{ width: 32, height: 32, borderRadius: 16 }}
          />
        ) : (
          <View className="size-8 items-center justify-center rounded-full bg-muted">
            <Text className="text-xs font-medium text-muted-foreground">
              {fallbackText ?? "?"}
            </Text>
          </View>
        )
      )}
      <View className="min-w-0 flex-1">
        <Text
          className="text-base font-medium text-foreground"
          numberOfLines={1}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-xs text-muted-foreground" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {onPress ? <Chevron tint={t.mutedForeground} /> : null}
    </>
  );

  if (!onPress) {
    return <View className={cn(ROW_CLASS, "py-2")}>{body}</View>;
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      className={cn(ROW_CLASS, "py-2 active:bg-secondary")}
    >
      {body}
    </Pressable>
  );
}
