#!/usr/bin/env bun
/**
 * Graze MCP Channel Server
 *
 * Declares claude/channel capability so messages from the canvas
 * arrive as <channel source="graze"> events in Claude Code.
 *
 * Tools:
 *   reply         — send a text reply that appears as a shape on the canvas
 *   read_messages — read recent messages from the canvas
 *   read_canvas   — get the latest canvas snapshot as a base64 PNG
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = process.env.GRAZE_URL ?? "http://localhost:3737";

// --- HTTP helpers ---

async function apiPost(path: string, body: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
}

async function apiGet(path: string) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
}

// --- Channel notification builder ---

function buildChannelNotification(message: { id: string; text: string; timestamp: string }) {
  return {
    method: "notifications/claude/channel" as const,
    params: {
      content: message.text,
      meta: {
        message_id: message.id,
        timestamp: message.timestamp,
      },
    },
  };
}

// --- Instructions ---

const INSTRUCTIONS = `You are connected to Graze — an ink surface where agents browse.

Graze is a collaborative tldraw canvas. You can:
- Reply to the human via the reply tool — your text appears as a shape on the canvas
- Read recent messages via read_messages
- Read the current canvas state (as a PNG screenshot) via read_canvas

When the human sends a message from the canvas, it arrives as a channel event:

<channel source="graze" message_id="abc123" timestamp="2026-04-04T...">
their message text here
</channel>

Keep messages concise — this is a scratchpad, not a chat app.`;

// --- MCP Server ---

const mcp = new Server(
  { name: "graze", version: "0.2.0" },
  {
    capabilities: {
      experimental: { "claude/channel": {} },
      tools: {},
    },
    instructions: INSTRUCTIONS,
  }
);

// --- Tools ---

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description:
        "Send a reply to the Graze canvas. The text appears as a shape on the canvas that the human can see in real-time.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "The message text to display on the canvas",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "read_messages",
      description:
        "Read recent messages from the Graze canvas.",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: {
            type: "number",
            description: "Number of recent messages to return (default 20)",
          },
        },
      },
    },
    {
      name: "read_canvas",
      description:
        "Get the latest canvas snapshot as a base64 PNG image. Returns null if no snapshot has been taken yet.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
  ],
}));

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const a = (args ?? {}) as Record<string, unknown>;

  if (name === "reply") {
    const text = a.text as string;
    await apiPost("/api/shape", { from: "agent", text });
    return {
      content: [
        {
          type: "text" as const,
          text: `Reply sent to Graze canvas.`,
        },
      ],
    };
  }

  if (name === "read_messages") {
    const limit = (a.limit as number) ?? 20;
    const result = (await apiGet(`/api/messages?limit=${limit}`)) as {
      messages: Array<{ id: string; from: string; text: string; timestamp: string }>;
    };
    if (result.messages.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No messages yet." }],
      };
    }
    const formatted = result.messages
      .map((m) => `[${m.from}] ${m.text}`)
      .join("\n");
    return {
      content: [{ type: "text" as const, text: formatted }],
    };
  }

  if (name === "read_canvas") {
    const result = (await apiGet("/api/canvas/snapshot")) as {
      snapshot: { dataUrl: string; timestamp: string } | null;
    };
    if (!result.snapshot) {
      return {
        content: [
          { type: "text" as const, text: "No canvas snapshot available yet." },
        ],
      };
    }
    // Extract base64 from data URL
    const base64 = result.snapshot.dataUrl.replace(/^data:image\/png;base64,/, "");
    return {
      content: [
        {
          type: "image" as const,
          data: base64,
          mimeType: "image/png",
        },
        {
          type: "text" as const,
          text: `Canvas snapshot from ${result.snapshot.timestamp}`,
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// --- WebSocket listener for human messages ---

function connectWebSocket() {
  const wsUrl = BASE_URL.replace(/^http/, "ws");
  let reconnectDelay = 1000;

  function connect() {
    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        reconnectDelay = 1000;
        console.error("graze: connected to server WebSocket");
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          // Forward human messages as channel notifications
          if (msg.type === "message:created" && msg.message?.from === "human") {
            const notification = buildChannelNotification(msg.message);
            mcp.notification(notification);
          }
          // Forward canvas snapshots as channel notifications
          if (msg.type === "snapshot:created") {
            try {
              const result = (await apiGet("/api/canvas/snapshot")) as {
                snapshot: { dataUrl: string; timestamp: string } | null;
              };
              if (result.snapshot) {
                mcp.notification({
                  method: "notifications/claude/channel" as const,
                  params: {
                    content: "The human sent a canvas snapshot. Use read_canvas to see it.",
                    meta: {
                      timestamp: msg.timestamp,
                      type: "snapshot",
                    },
                  },
                });
              }
            } catch {
              // ignore fetch errors
            }
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        console.error(`graze: WebSocket closed, reconnecting in ${reconnectDelay}ms`);
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      };

      ws.onerror = () => {
        // onclose will fire after this
      };
    } catch {
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    }
  }

  connect();
}

// --- Start ---

async function main() {
  await mcp.connect(new StdioServerTransport());
  connectWebSocket();
  console.error("graze channel server ready");
}

main();
