import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WSClient } from "./ws-client";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  receive(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  send(frame: string) {
    this.sent.push(frame);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

function connectAuthenticatedClient() {
  const client = new WSClient({
    url: "wss://example.test/ws",
    token: "token",
    workspaceSlug: "workspace",
  });
  client.connect();
  const socket = MockWebSocket.instances[0];
  socket.open();
  socket.receive({ type: "auth_ack" });
  return { client, socket };
}

describe("WSClient application heartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket);
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reconnects a stale OPEN socket through the jittered backoff path", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { client, socket } = connectAuthenticatedClient();

    expect(socket.sent.map((frame) => JSON.parse(frame))).toEqual([
      { type: "auth", payload: { token: "token" } },
      { type: "ping" },
    ]);

    // No pong arrives even though the JS-visible readyState remains OPEN.
    vi.advanceTimersByTime(10_000);
    vi.advanceTimersByTime(1);

    expect(MockWebSocket.instances).toHaveLength(2);
    client.disconnect();
  });

  it("keeps a healthy socket connected when its pong arrives", () => {
    const { client, socket } = connectAuthenticatedClient();
    socket.receive({ type: "pong" });

    vi.advanceTimersByTime(10_000);

    expect(MockWebSocket.instances).toHaveLength(1);
    client.disconnect();
  });
});

// A phone reconnects constantly — after every backgrounding, every network
// switch. By the time it does, a sliding session may have been renewed, and
// the token captured when this client was built is on its way out (MUL-7436).
describe("WSClient session renewal", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("authenticates each connection with the current token", () => {
    let current = "token-v1";
    const client = new WSClient({
      url: "wss://example.test/ws",
      token: "token-v1",
      workspaceSlug: "workspace",
      getToken: () => current,
    });

    client.connect();
    MockWebSocket.instances[0].open();
    expect(JSON.parse(MockWebSocket.instances[0].sent[0])).toEqual({
      type: "auth",
      payload: { token: "token-v1" },
    });

    current = "token-v2";
    client.forceReconnect();
    const reconnected = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    reconnected.open();

    expect(JSON.parse(reconnected.sent[0])).toEqual({
      type: "auth",
      payload: { token: "token-v2" },
    });
  });

  it("falls back to the constructor token when no reader is supplied", () => {
    const client = new WSClient({
      url: "wss://example.test/ws",
      token: "token-only",
      workspaceSlug: "workspace",
    });

    client.connect();
    MockWebSocket.instances[0].open();

    expect(JSON.parse(MockWebSocket.instances[0].sent[0])).toEqual({
      type: "auth",
      payload: { token: "token-only" },
    });
  });
});

// A cookie-authenticated upgrade never produces an auth_ack: the server writes
// that frame only on the token-frame path (realtime/hub.go), and RN's
// WebSocket hands NSURLSession's shared cookie jar to the upgrade request, so
// the phone can land on the cookie branch without asking to. Everything the
// client does after connecting used to hang off that ack.
describe("WSClient establishment without auth_ack", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", MockWebSocket);
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function connect() {
    const client = new WSClient({
      url: "wss://example.test/ws",
      token: "token",
      workspaceSlug: "workspace",
    });
    client.connect();
    const socket = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    socket.open();
    return { client, socket };
  }

  it("starts the heartbeat on open, without waiting for any frame back", () => {
    // Without a heartbeat an iOS/NAT half-open socket reads as OPEN forever,
    // so events just stop with nothing to notice it. A quiet workspace sends
    // nothing inbound for minutes, so this cannot wait on inbound traffic.
    const { socket } = connect();

    expect(socket.sent.map((f) => JSON.parse(f).type)).toEqual(["auth", "ping"]);
  });

  it("fires onReconnect on the second connection even with no ack", () => {
    // Each feature refreshes the caches it missed here. Never firing is why a
    // reconnect left the transcript stale until the screen was reopened.
    const { client, socket } = connect();
    const onReconnect = vi.fn();
    client.onReconnect(onReconnect);

    socket.receive({ type: "task:message", payload: { task_id: "t", seq: 1 } });
    expect(onReconnect).not.toHaveBeenCalled();

    client.forceReconnect();
    const next = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    next.open();
    next.receive({ type: "task:message", payload: { task_id: "t", seq: 2 } });

    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("treats a pong as establishment so an idle workspace still recovers", () => {
    // Reconnecting onto a workspace with no activity yields no business
    // events at all; the heartbeat's own reply is the only proof of life, and
    // the caches missed across the gap still need refreshing.
    const { client } = connect();
    const onReconnect = vi.fn();
    client.onReconnect(onReconnect);
    MockWebSocket.instances[0].receive({ type: "pong" });

    client.forceReconnect();
    const next = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    next.open();
    next.receive({ type: "pong" });

    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it("establishes once per socket, not once per frame", () => {
    const { client, socket } = connect();
    const onReconnect = vi.fn();
    client.onReconnect(onReconnect);
    socket.receive({ type: "pong" });

    client.forceReconnect();
    const next = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    next.open();
    for (let seq = 1; seq <= 5; seq++) {
      next.receive({ type: "task:message", payload: { task_id: "t", seq } });
    }

    // Five frames on one socket is still one reconnect, not five.
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});
