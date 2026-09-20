/**
 * More tab — the overflow destination for everything that doesn't earn a tab.
 *
 * Was a DropdownMenu popover anchored over the tab bar. `NativeTabs` can't
 * preventDefault a tab press (see (tabs)/_layout.tsx), so this is a real
 * screen now. That also lets it be a plain grouped list, which is what iOS
 * does with a More tab anyway.
 *
 * Projects is deliberately absent: it has its own tab now, and two entry
 * points to the same list is how a nav grows confusing.
 */
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { SFSymbol } from "sf-symbols-typescript";
import { Text } from "@/components/ui/text";
import { Separator } from "@/components/ui/separator";
import { MoreRow, IdentityRow } from "@/components/nav/more-rows";
import { WorkspaceAvatar } from "@/components/workspace/workspace-avatar";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";

interface NavItem {
  label: string;
  icon: SFSymbol;
  /** Path under /:slug/ — final href is `/${slug}${path}`. */
  path: string;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Pinned", icon: "pin", path: "/more/pins" },
  { label: "Issues", icon: "list.bullet", path: "/more/issues" },
];

export default function MoreTab() {
  const slug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const user = useAuthStore((s) => s.user);
  const { data: workspaces } = useQuery(workspaceListOptions());
  const current = slug ? workspaces?.find((w) => w.slug === slug) : undefined;
  // A lone workspace has nothing to switch to, so the row renders inert
  // rather than pushing a sheet that would list exactly one option.
  const canSwitch = (workspaces?.length ?? 0) > 1;

  const go = (path: string) => {
    if (slug) router.push(`/${slug}${path}`);
  };

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["top"]}>
      <View className="px-4 pb-2 pt-1">
        <Text className="text-2xl font-bold text-foreground">More</Text>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <IdentityRow
          title={user?.name ?? "—"}
          subtitle={user?.email ?? undefined}
          avatarUrl={user?.avatar_url ?? null}
          fallbackText={(user?.name ?? user?.email ?? "U")
            .charAt(0)
            .toUpperCase()}
          onPress={() => go("/more/settings")}
          accessibilityLabel="Account settings"
        />

        <Separator />

        <IdentityRow
          title={current?.name ?? "Workspace"}
          leading={
            <WorkspaceAvatar
              name={current?.name ?? "Workspace"}
              avatarUrl={current?.avatar_url}
              size={32}
            />
          }
          onPress={canSwitch ? () => go("/switch-workspace") : undefined}
          accessibilityLabel={canSwitch ? "Switch workspace" : "Workspace"}
        />

        <Separator />

        {NAV_ITEMS.map((item) => (
          <MoreRow
            key={item.path}
            label={item.label}
            icon={item.icon}
            onPress={() => go(item.path)}
          />
        ))}

        <Separator />

        <MoreRow
          label="Settings"
          icon="gearshape"
          onPress={() => go("/more/settings")}
        />
      </ScrollView>
    </SafeAreaView>
  );
}
