#!/usr/bin/env bun
/**
 * Graze MCP Server
 *
 * Hosts the Graze tool surface over stdio MCP. Optional passive channel
 * notifications can be enabled for clients that support them.
 *
 * Tools:
 *   reply          — send a text reply as a sticky note on the canvas
 *   create_shape   — create any tldraw shape (geo, text, note, arrow, etc.)
 *   update_shape   — modify an existing shape's properties
 *   delete_shapes  — remove shapes from the canvas
 *   move_viewport  — pan/zoom the canvas view
 *   read_canvas    — get the latest browser-posted canvas snapshot as a base64 PNG
 *   read_shapes    — get authoritative structured shape state from the Durable Object
 *   read_messages  — read recent messages from the canvas
 *   generate_image — generate a new image shape via gpt-image-2
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";
import {
  buildHumanMessageNotification,
  buildSnapshotNotification,
  getPassiveChannelCapabilities,
  getPassiveChannelInstructions,
  parsePassiveChannelMode,
} from "./channel";
import {
  GENERATE_IMAGE_INSTRUCTIONS,
  generateImageInputSchema,
  runGenerateImage,
} from "./generateImage";

const BASE_URL = process.env.GRAZE_URL ?? "http://localhost:3737";
const PASSIVE_CHANNEL_MODE = parsePassiveChannelMode(
  process.env.GRAZE_MCP_CHANNEL,
);

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

// --- Instructions ---

const INSTRUCTIONS = `You are connected to Graze — an ink surface where agents browse.

Graze is a collaborative tldraw canvas. You can manipulate it directly:

**Reading the canvas:**
- read_canvas — last browser-posted screenshot, if available
- read_shapes — authoritative structured shape state from the Durable Object
- read_messages — recent text messages

**Writing to the canvas:**
- reply — quick text reply as a sticky note
- create_shape — create any shape (note, text, geo, arrow). Omit x/y to let Graze place it in open canvas space.
- update_shape — modify an existing shape's properties
- delete_shapes — remove shapes by ID
- generate_image — generate a new image shape on the canvas via gpt-image-2

**Navigation:**
- move_viewport — pan and zoom the canvas view

${GENERATE_IMAGE_INSTRUCTIONS}

**Shape types you can create:**
- "note" — sticky note with text (props: richText, color, size)
- "text" — plain text (props: richText, color, size, font)
- "geo" — rectangle, ellipse, etc. (props: w, h, geo, color, fill)
- "arrow" — connecting arrow

**Colors:** "black", "grey", "light-violet", "violet", "blue", "light-blue", "yellow", "orange", "green", "light-green", "light-red", "red"
**Layout hints:** "heading", "caption", "compact", "wide", "card"
**Style hints:** "muted", "question", "warning", "success", "idea"

${getPassiveChannelInstructions(PASSIVE_CHANNEL_MODE)}

Keep canvas additions concise and well-positioned.`;

// --- MCP Server ---

const mcp = new McpServer(
  { name: "graze", version: "0.3.0" },
  {
    capabilities: {
      ...getPassiveChannelCapabilities(PASSIVE_CHANNEL_MODE),
      tools: {},
    },
    instructions: INSTRUCTIONS,
  },
);

// --- Tools ---

mcp.registerTool(
  "reply",
  {
    description:
      "Send a quick text reply as a sticky note on the Graze canvas.",
    inputSchema: {
      text: z.string().describe("The message text to display"),
    },
  },
  async ({ text }) => {
    await apiPost("/api/shape", { from: "agent", text });
    return {
      content: [{ type: "text" as const, text: "Reply sent to Graze canvas." }],
    };
  },
);

mcp.registerTool(
  "create_shape",
  {
    description:
      "Create a shape on the Graze canvas. Supports note (sticky note), text, geo (rectangle/ellipse), and arrow types. Omit x/y to auto-place in open canvas space.",
    inputSchema: z.object({
      type: z
        .enum(["note", "text", "geo", "arrow"])
        .describe("Shape type: 'note', 'text', 'geo', or 'arrow'"),
      x: z.optional(
        z.number().describe("Optional X position on canvas. Omit for auto-placement."),
      ),
      y: z.optional(
        z.number().describe("Optional Y position on canvas. Omit for auto-placement."),
      ),
      layout: z.optional(
        z
          .enum(["heading", "caption", "compact", "wide", "card"])
          .describe(
            "Optional layout intent. heading is large, caption is small text, compact is tight, wide wraps long text, card is a larger labeled box.",
          ),
      ),
      style: z.optional(
        z
          .enum(["muted", "question", "warning", "success", "idea"])
          .describe(
            "Optional semantic style intent that picks sensible default colors/fills.",
          ),
      ),
      props: z.optional(
        z
          .looseObject({})
          .describe(
            "Shape-specific properties (pass-through; all caller keys are preserved). For note/text: { richText: string (will be converted), color: string, size: 's'|'m'|'l'|'xl' }. For geo: { w: number, h: number, geo: 'rectangle'|'ellipse'|'diamond', color: string, fill: 'none'|'semi'|'solid' }",
          ),
      ),
      id: z.optional(
        z
          .string()
          .describe(
            "Optional custom ID for the shape (for later updates/deletion)",
          ),
      ),
    }),
  },
  async ({ type, x, y, layout, style, props, id }) => {
    const body: Record<string, unknown> = {
      type: type ?? "geo",
      props: props ?? {},
      id,
    };
    if (x !== undefined) body.x = x;
    if (y !== undefined) body.y = y;
    if (layout !== undefined) body.layout = layout;
    if (style !== undefined) body.style = style;
    await apiPost("/api/canvas/create_shape", body);
    return {
      content: [
        {
          type: "text" as const,
          text: `Created ${type ?? "geo"} shape on canvas.`,
        },
      ],
    };
  },
);

mcp.registerTool(
  "update_shape",
  {
    description: "Update an existing shape's properties on the canvas.",
    inputSchema: z.object({
      shapeId: z.string().describe("The ID of the shape to update"),
      props: z
        .looseObject({})
        .describe(
          "Properties to update, merged with existing props. Pass-through object: all caller-supplied keys are preserved (e.g. { color: 'red', size: 'xl', w: 200 }).",
        ),
    }),
  },
  async ({ shapeId, props }) => {
    await apiPost("/api/canvas/update_shape", {
      shapeId,
      props: props ?? {},
    });
    return {
      content: [{ type: "text" as const, text: `Updated shape ${shapeId}.` }],
    };
  },
);

mcp.registerTool(
  "delete_shapes",
  {
    description: "Delete one or more shapes from the canvas.",
    inputSchema: z.object({
      shapeIds: z.array(z.string()).describe("Array of shape IDs to delete"),
    }),
  },
  async ({ shapeIds }) => {
    await apiPost("/api/canvas/delete_shapes", {
      shapeIds,
    });
    return {
      content: [
        {
          type: "text" as const,
          text: `Deleted ${shapeIds.length} shape(s).`,
        },
      ],
    };
  },
);

mcp.registerTool(
  "move_viewport",
  {
    description:
      "Move the canvas viewport to a specific position and/or zoom level.",
    inputSchema: z.object({
      x: z.number().describe("X position to center on"),
      y: z.number().describe("Y position to center on"),
      zoom: z
        .optional(z.number())
        .describe("Zoom level (1 = 100%, 0.5 = 50%, 2 = 200%)"),
    }),
  },
  async ({ x, y, zoom }) => {
    await apiPost("/api/canvas/move_viewport", {
      x: x ?? 0,
      y: y ?? 0,
      zoom,
    });
    return {
      content: [
        { type: "text" as const, text: `Moved viewport to (${x}, ${y}).` },
      ],
    };
  },
);

mcp.registerTool(
  "read_messages",
  {
    description: "Read recent messages from the Graze canvas.",
    inputSchema: z.object({
      limit: z
        .optional(z.number())
        .describe("Number of recent messages to return (default 20)"),
    }),
  },
  async ({ limit }) => {
    const result = (await apiGet(`/api/messages?limit=${limit ?? 20}`)) as {
      messages: Array<{
        id: string;
        from: string;
        text: string;
        timestamp: string;
      }>;
    };
    if (result.messages.length === 0) {
      return { content: [{ type: "text" as const, text: "No messages yet." }] };
    }
    const formatted = result.messages
      .map((m) => `[${m.from}] ${m.text}`)
      .join("\n");
    return { content: [{ type: "text" as const, text: formatted }] };
  },
);

mcp.registerTool(
  "read_canvas",
  {
    description:
      "Get the latest browser-posted canvas snapshot as a base64 PNG image. This is visual state only; use read_shapes for authoritative structured state.",
    inputSchema: z.object({}),
  },
  async () => {
    const result = (await apiGet("/api/canvas/snapshot")) as {
      snapshot: { dataUrl: string; timestamp: string } | null;
    };
    if (!result.snapshot) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No canvas snapshot available yet. Ask the human to press F12.",
          },
        ],
      };
    }
    const base64 = result.snapshot.dataUrl.replace(
      /^data:image\/png;base64,/,
      "",
    );
    return {
      content: [
        { type: "image" as const, data: base64, mimeType: "image/png" },
        {
          type: "text" as const,
          text: `Last browser-posted canvas snapshot from ${result.snapshot.timestamp}. This may be stale; use read_shapes for authoritative structured state.`,
        },
      ],
    };
  },
);

mcp.registerTool(
  "read_shapes",
  {
    description:
      "Read the authoritative structured canvas shape records from the Durable Object-backed tldraw store.",
    inputSchema: z.object({}),
  },
  async () => {
    const result = (await apiGet("/api/canvas/shapes")) as {
      clock?: number;
      sessions?: number;
      shapes?: unknown[];
    };
    const shapes = Array.isArray(result.shapes) ? result.shapes : [];
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              clock: result.clock,
              sessions: result.sessions,
              shapeCount: shapes.length,
              shapes,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

mcp.registerTool(
  "generate_image",
  {
    description:
      "Generate a new image shape on the Graze canvas using gpt-image-2. " +
      "Provide a text prompt describing what to draw. Optionally pass " +
      "referenceShapeIds — an array of existing tldraw shape ids whose " +
      "rasterized bitmap will be used as a reference image for an edit-style " +
      "generation. Optional x/y position the resulting image on the canvas. " +
      "Returns content[0].text as a JSON string containing { url, shapeId } " +
      "so both the uploads URL and the created tldraw shape id are available.",
    inputSchema: generateImageInputSchema,
  },
  async ({ prompt, referenceShapeIds, x, y }) => {
    return runGenerateImage(
      { prompt, referenceShapeIds, x, y },
      { baseUrl: BASE_URL },
    );
  },
);

// --- WebSocket listener for human messages ---

function connectWebSocket() {
  if (PASSIVE_CHANNEL_MODE === "off") return;

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
            const notification = buildHumanMessageNotification(
              PASSIVE_CHANNEL_MODE,
              msg.message,
            );
            if (notification) mcp.server.notification(notification);
          }
          if (msg.type === "snapshot:created") {
            const notification = buildSnapshotNotification(
              PASSIVE_CHANNEL_MODE,
              msg.timestamp,
            );
            if (notification) mcp.server.notification(notification);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        console.error(
          `graze: WebSocket closed, reconnecting in ${reconnectDelay}ms`,
        );
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
  console.error(`graze MCP server ready (${PASSIVE_CHANNEL_MODE} channel)`);
}

main();
