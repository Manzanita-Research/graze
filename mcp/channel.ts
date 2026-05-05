export const GRAZE_MCP_CHANNEL_ENV = "GRAZE_MCP_CHANNEL";

export type PassiveChannelMode = "off" | "claude";

export interface GrazeHumanMessage {
  id: string;
  text: string;
  timestamp: string;
}

export interface ClaudeChannelNotification {
  method: "notifications/claude/channel";
  params: {
    content: string;
    meta: Record<string, string>;
  };
}

export function parsePassiveChannelMode(
  value: string | undefined,
): PassiveChannelMode {
  const normalized = (value ?? "off").trim().toLowerCase();
  if (
    normalized === "" ||
    normalized === "0" ||
    normalized === "false" ||
    normalized === "off" ||
    normalized === "none" ||
    normalized === "generic" ||
    normalized === "codex"
  ) {
    return "off";
  }
  if (
    normalized === "claude" ||
    normalized === "claude-channel" ||
    normalized === "claude_channels" ||
    normalized === "claude/channels"
  ) {
    return "claude";
  }
  throw new Error(
    `${GRAZE_MCP_CHANNEL_ENV} must be one of: off, none, generic, codex, claude`,
  );
}

export function getPassiveChannelCapabilities(mode: PassiveChannelMode) {
  if (mode !== "claude") return {};
  return {
    experimental: { "claude/channel": {}, "claude/channel/permission": {} },
  };
}

export function getPassiveChannelInstructions(mode: PassiveChannelMode) {
  if (mode === "claude") {
    return `When the human sends a canvas snapshot, you'll get a channel notification. Use read_canvas to see it.
When the human sends a message, it arrives as a <channel> event.`;
  }
  return `This MCP server does not rely on host-specific passive channel events by default.
Use read_messages to check recent human messages and read_canvas for the latest browser-posted snapshot.`;
}

export function buildHumanMessageNotification(
  mode: PassiveChannelMode,
  message: GrazeHumanMessage,
): ClaudeChannelNotification | null {
  if (mode !== "claude") return null;
  return {
    method: "notifications/claude/channel",
    params: {
      content: message.text,
      meta: {
        message_id: message.id,
        timestamp: message.timestamp,
      },
    },
  };
}

export function buildSnapshotNotification(
  mode: PassiveChannelMode,
  timestamp: string,
): ClaudeChannelNotification | null {
  if (mode !== "claude") return null;
  return {
    method: "notifications/claude/channel",
    params: {
      content: "The human sent a canvas snapshot. Use read_canvas to see it.",
      meta: { timestamp, type: "snapshot" },
    },
  };
}
