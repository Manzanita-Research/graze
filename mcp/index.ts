#!/usr/bin/env bun
/**
 * Graze MCP Channel Server
 *
 * Declares claude/channel capability so messages from the canvas
 * arrive as <channel source="graze"> events in Claude Code.
 *
 * Tools:
 *   reply          — send a text reply as a sticky note on the canvas
 *   create_shape   — create any tldraw shape (geo, text, note, arrow, etc.)
 *   update_shape   — modify an existing shape's properties
 *   delete_shapes  — remove shapes from the canvas
 *   move_viewport  — pan/zoom the canvas view
 *   read_canvas    — get the latest canvas snapshot as a base64 PNG
 *   read_messages  — read recent messages from the canvas
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

Graze is a collaborative tldraw canvas. You can manipulate it directly:

**Reading the canvas:**
- read_canvas — screenshot of the current canvas state
- read_messages — recent text messages

**Writing to the canvas:**
- reply — quick text reply as a sticky note
- create_shape — create any shape (note, text, geo, arrow, draw)
- update_shape — modify an existing shape's properties
- delete_shapes — remove shapes by ID

**Navigation:**
- move_viewport — pan and zoom the canvas view

**Shape types you can create:**
- "note" — sticky note with text (props: richText, color, size)
- "text" — plain text (props: richText, color, size, font)
- "geo" — rectangle, ellipse, etc. (props: w, h, geo, color, fill)
- "arrow" — connecting arrow

**Colors:** "black", "grey", "light-violet", "violet", "blue", "light-blue", "yellow", "orange", "green", "light-green", "light-red", "red"

When the human sends a canvas snapshot, you'll get a channel notification. Use read_canvas to see it.
When the human sends a message, it arrives as a <channel> event.

Keep canvas additions concise and well-positioned.`;

// --- MCP Server ---

const mcp = new Server(
  { name: "graze", version: "0.3.0" },
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
        "Send a quick text reply as a sticky note on the Graze canvas.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: {
            type: "string",
            description: "The message text to display",
          },
        },
        required: ["text"],
      },
    },
    {
      name: "create_shape",
      description:
        "Create a shape on the Graze canvas. Supports note (sticky note), text, geo (rectangle/ellipse), and arrow types.",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: {
            type: "string",
            description: "Shape type: 'note', 'text', 'geo', or 'arrow'",
            enum: ["note", "text", "geo", "arrow"],
          },
          x: {
            type: "number",
            description: "X position on canvas (default: 0)",
          },
          y: {
            type: "number",
            description: "Y position on canvas (default: 0)",
          },
          props: {
            type: "object",
            description: "Shape-specific properties. For note/text: { richText: string (will be converted), color: string, size: 's'|'m'|'l'|'xl' }. For geo: { w: number, h: number, geo: 'rectangle'|'ellipse'|'diamond', color: string, fill: 'none'|'semi'|'solid' }",
          },
          id: {
            type: "string",
            description: "Optional custom ID for the shape (for later updates/deletion)",
          },
        },
        required: ["type"],
      },
    },
    {
      name: "update_shape",
      description:
        "Update an existing shape's properties on the canvas.",
      inputSchema: {
        type: "object" as const,
        properties: {
          shapeId: {
            type: "string",
            description: "The ID of the shape to update",
          },
          props: {
            type: "object",
            description: "Properties to update (merged with existing props)",
          },
        },
        required: ["shapeId", "props"],
      },
    },
    {
      name: "delete_shapes",
      description:
        "Delete one or more shapes from the canvas.",
      inputSchema: {
        type: "object" as const,
        properties: {
          shapeIds: {
            type: "array",
            items: { type: "string" },
            description: "Array of shape IDs to delete",
          },
        },
        required: ["shapeIds"],
      },
    },
    {
      name: "move_viewport",
      description:
        "Move the canvas viewport to a specific position and/or zoom level.",
      inputSchema: {
        type: "object" as const,
        properties: {
          x: {
            type: "number",
            description: "X position to center on",
          },
          y: {
            type: "number",
            description: "Y position to center on",
          },
          zoom: {
            type: "number",
            description: "Zoom level (1 = 100%, 0.5 = 50%, 2 = 200%)",
          },
        },
        required: ["x", "y"],
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
        "Get the latest canvas snapshot as a base64 PNG image. The human must press F12 or the snapshot button first.",
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
      content: [{ type: "text" as const, text: "Reply sent to Graze canvas." }],
    };
  }

  if (name === "create_shape") {
    await apiPost("/api/canvas/create_shape", {
      type: a.type ?? "geo",
      x: a.x ?? 0,
      y: a.y ?? 0,
      props: a.props ?? {},
      id: a.id,
    });
    return {
      content: [{ type: "text" as const, text: `Created ${a.type ?? "geo"} shape on canvas.` }],
    };
  }

  if (name === "update_shape") {
    await apiPost("/api/canvas/update_shape", {
      shapeId: a.shapeId,
      props: a.props ?? {},
    });
    return {
      content: [{ type: "text" as const, text: `Updated shape ${a.shapeId}.` }],
    };
  }

  if (name === "delete_shapes") {
    await apiPost("/api/canvas/delete_shapes", {
      shapeIds: a.shapeIds,
    });
    return {
      content: [{ type: "text" as const, text: `Deleted ${(a.shapeIds as string[]).length} shape(s).` }],
    };
  }

  if (name === "move_viewport") {
    await apiPost("/api/canvas/move_viewport", {
      x: a.x ?? 0,
      y: a.y ?? 0,
      zoom: a.zoom,
    });
    return {
      content: [{ type: "text" as const, text: `Moved viewport to (${a.x}, ${a.y}).` }],
    };
  }

  if (name === "read_messages") {
    const limit = (a.limit as number) ?? 20;
    const result = (await apiGet(`/api/messages?limit=${limit}`)) as {
      messages: Array<{ id: string; from: string; text: string; timestamp: string }>;
    };
    if (result.messages.length === 0) {
      return { content: [{ type: "text" as const, text: "No messages yet." }] };
    }
    const formatted = result.messages.map((m) => `[${m.from}] ${m.text}`).join("\n");
    return { content: [{ type: "text" as const, text: formatted }] };
  }

  if (name === "read_canvas") {
    const result = (await apiGet("/api/canvas/snapshot")) as {
      snapshot: { dataUrl: string; timestamp: string } | null;
    };
    if (!result.snapshot) {
      return {
        content: [{ type: "text" as const, text: "No canvas snapshot available yet. Ask the human to press F12." }],
      };
    }
    const base64 = result.snapshot.dataUrl.replace(/^data:image\/png;base64,/, "");
    return {
      content: [
        { type: "image" as const, data: base64, mimeType: "image/png" },
        { type: "text" as const, text: `Canvas snapshot from ${result.snapshot.timestamp}` },
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
          if (msg.type === "message:created" && msg.message?.from === "human") {
            mcp.notification(buildChannelNotification(msg.message));
          }
          if (msg.type === "snapshot:created") {
            mcp.notification({
              method: "notifications/claude/channel" as const,
              params: {
                content: "The human sent a canvas snapshot. Use read_canvas to see it.",
                meta: { timestamp: msg.timestamp, type: "snapshot" },
              },
            });
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

      ws.onerror = () => {};
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
