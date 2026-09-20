/**
 * Projects tab — flat list of the workspace's projects, newest activity first.
 *
 * Promoted from a row inside the More popover to a tab of its own, so the
 * screen now owns a tab-root `<Header>` instead of leaning on the push
 * stack's native bar. Tapping a project pushes `project/[id]` on the parent
 * workspace Stack, which is where the per-project issue list (Open / Done
 * buckets) already lives — the same destination the issue detail's project
 * link uses, so there is exactly one project screen in the app.
 *
 * Sort: client-side by `updated_at` desc, mirroring web's default list
 * ordering. `useProjectsRealtime` in the workspace layout keeps the cache
 * fresh, so pull-to-refresh is only for the cellular edge case where a WS
 * reconnect missed events.
 */
import { useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  View,
} from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Header } from "@/components/ui/header";
import { IconButton } from "@/components/ui/icon-button";
import { ProjectRow } from "@/components/project/project-row";
import { projectListOptions } from "@/data/queries/projects";
import { useWorkspaceStore } from "@/data/workspace-store";

export default function ProjectsTab() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const wsSlug = useWorkspaceStore((s) => s.currentWorkspaceSlug);

  const { data, isLoading, error, refetch, isRefetching } = useQuery(
    projectListOptions(wsId),
  );

  const sorted = useMemo(() => {
    if (!data) return [];
    return [...data].sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }, [data]);

  const goCreate = useCallback(() => {
    if (wsSlug) router.push(`/${wsSlug}/project/new`);
  }, [wsSlug]);

  return (
    <View className="flex-1 bg-background">
      <Header
        title="Projects"
        right={
          <IconButton
            name="add"
            onPress={goCreate}
            accessibilityLabel="New project"
          />
        }
      />

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View className="gap-3 px-4 pt-4">
          <Text className="text-sm text-destructive">
            Failed to load projects:{" "}
            {error instanceof Error ? error.message : "unknown error"}
          </Text>
          <Button variant="outline" onPress={() => refetch()}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : sorted.length === 0 ? (
        <View className="flex-1 items-center justify-center gap-4 px-6">
          <Text className="text-base font-medium text-foreground">
            No projects yet
          </Text>
          <Button variant="default" onPress={goCreate}>
            <Text>Create project</Text>
          </Button>
        </View>
      ) : (
        <FlatList
          data={sorted}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => (
            <View className="ml-4 h-px bg-border" />
          )}
          renderItem={({ item }) => (
            <ProjectRow
              project={item}
              onPress={() => {
                if (wsSlug) router.push(`/${wsSlug}/project/${item.id}`);
              }}
            />
          )}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
          }
          contentContainerClassName="pb-6"
        />
      )}
    </View>
  );
}
