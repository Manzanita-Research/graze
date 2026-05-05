import { describe, expect, test } from "bun:test";
import {
  buildHumanMessageNotification,
  buildSnapshotNotification,
  getPassiveChannelCapabilities,
  getPassiveChannelInstructions,
  parsePassiveChannelMode,
} from "./channel";

describe("MCP passive channel mode", () => {
  test("defaults to generic MCP without host-specific passive events", () => {
    expect(parsePassiveChannelMode(undefined)).toBe("off");
    expect(getPassiveChannelCapabilities("off")).toEqual({});
    expect(getPassiveChannelInstructions("off")).toContain("read_messages");
  });

  test("accepts Codex/generic aliases as off", () => {
    expect(parsePassiveChannelMode("codex")).toBe("off");
    expect(parsePassiveChannelMode("generic")).toBe("off");
    expect(parsePassiveChannelMode("none")).toBe("off");
  });

  test("enables Claude channel capability explicitly", () => {
    expect(parsePassiveChannelMode("claude")).toBe("claude");
    expect(getPassiveChannelCapabilities("claude")).toEqual({
      experimental: {
        "claude/channel": {},
        "claude/channel/permission": {},
      },
    });
  });

  test("emits no notifications when channel mode is off", () => {
    expect(
      buildHumanMessageNotification("off", {
        id: "msg_1",
        text: "hello",
        timestamp: "2026-05-05T00:00:00.000Z",
      }),
    ).toBeNull();
    expect(
      buildSnapshotNotification("off", "2026-05-05T00:00:00.000Z"),
    ).toBeNull();
  });

  test("builds Claude channel notifications when enabled", () => {
    expect(
      buildHumanMessageNotification("claude", {
        id: "msg_1",
        text: "hello",
        timestamp: "2026-05-05T00:00:00.000Z",
      }),
    ).toEqual({
      method: "notifications/claude/channel",
      params: {
        content: "hello",
        meta: {
          message_id: "msg_1",
          timestamp: "2026-05-05T00:00:00.000Z",
        },
      },
    });

    expect(
      buildSnapshotNotification("claude", "2026-05-05T00:00:00.000Z"),
    ).toEqual({
      method: "notifications/claude/channel",
      params: {
        content: "The human sent a canvas snapshot. Use read_canvas to see it.",
        meta: { timestamp: "2026-05-05T00:00:00.000Z", type: "snapshot" },
      },
    });
  });
});
