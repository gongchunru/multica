import { beforeEach, describe, expect, it, vi } from "vitest";

const { client, subscriptionSetups } = vi.hoisted(() => ({
  // Filled per test — the hook resolves its QueryClient through
  // useQueryClient(), so the mock below reads whatever the test installed.
  client: { current: null as unknown },
  subscriptionSetups: [] as Array<(ws: MockWS, wsId: string) => unknown>,
}));

type EventHandler = (payload: unknown) => void;

interface MockWS {
  on: ReturnType<typeof vi.fn>;
  onReconnect: ReturnType<typeof vi.fn>;
}

// Only useQueryClient is faked; the cache under test is a real QueryClient so
// the assertions read the same structure the screen renders from.
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...actual, useQueryClient: () => client.current };
});

vi.mock("@/lib/use-ws-subscriptions", () => ({
  useWSSubscriptions: (setup: (ws: MockWS, wsId: string) => unknown) => {
    subscriptionSetups.push(setup);
  },
}));

vi.mock("@/data/api", () => ({ api: {} }));

import { QueryClient } from "@tanstack/react-query";
import type { TaskMessagePayload } from "@multica/core/types";
import { chatKeys } from "@/data/queries/chat";
import { useChatSessionRealtime } from "./use-chat-session-realtime";

const SESSION = "session-1";
const TASK = "task-1";

/** Mounts the hook and returns the event handlers it registered. */
function mount(qc: QueryClient, sessionId: string | null) {
  client.current = qc;
  useChatSessionRealtime(sessionId);

  const handlers = new Map<string, EventHandler>();
  const ws: MockWS = {
    on: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
      return () => {};
    }),
    onReconnect: vi.fn(() => () => {}),
  };
  subscriptionSetups[subscriptionSetups.length - 1](ws, "workspace-1");
  return handlers;
}

describe("useChatSessionRealtime", () => {
  beforeEach(() => {
    subscriptionSetups.length = 0;
    client.current = null;
  });

  it("records a task:message that carries no chat_session_id", () => {
    // Regression: this handler used to require `chat_session_id === sessionId`.
    // The server's task:message payload has no such field — taskMessageToPayload
    // (server/internal/handler/daemon.go) fills task_id + issue_id only — so the
    // comparison was always `undefined !== sessionId` and every frame was
    // dropped. The live execution trace never rendered, and because StatusPill
    // infers "running" from `taskMessages.length > 0`, the status line sat on
    // "Starting up" until the turn finished.
    const qc = new QueryClient();
    qc.setQueryData<TaskMessagePayload[]>(chatKeys.taskMessages(TASK), []);

    const handlers = mount(qc, SESSION);
    handlers.get("task:message")?.({
      task_id: TASK,
      issue_id: "",
      seq: 1,
      type: "tool_use",
      tool: "bash",
    });

    expect(
      qc.getQueryData<TaskMessagePayload[]>(chatKeys.taskMessages(TASK)),
    ).toHaveLength(1);
  });

  it("still gates chat lifecycle events on the open session", () => {
    // Loosening task:message must not loosen the rest: a sibling session's
    // chat:done has no business touching this session's caches.
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");

    const handlers = mount(qc, SESSION);
    handlers.get("chat:done")?.({
      chat_session_id: "another-session",
      task_id: "task-elsewhere",
    });

    expect(invalidate).not.toHaveBeenCalled();
  });
});
