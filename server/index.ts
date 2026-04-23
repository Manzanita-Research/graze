#!/usr/bin/env bun
/**
 * Graze HTTP + WebSocket server.
 *
 * Endpoints:
 *   POST /api/shape              — create a text shape on the canvas
 *   POST /api/message            — human or agent posts a message (also creates shape)
 *   GET  /api/messages           — list recent messages
 *   POST /api/canvas/snapshot    — UI posts a canvas snapshot (PNG base64)
 *   GET  /api/canvas/snapshot    — agent reads latest canvas snapshot
 *
 * WebSocket: /ws
 */

import { addClient, removeClient, broadcast } from "./ws";

const PORT = parseInt(process.env.GRAZE_PORT ?? "3737", 10);

// --- In-memory store ---

interface Message {
  id: string;
  from: "human" | "agent";
  text: string;
  timestamp: string;
}

const messages: Message[] = [];
let canvasSnapshot: { dataUrl: string; timestamp: string } | null = null;

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// --- Response helpers ---

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// --- Route handlers ---

async function createShape(req: Request) {
  const body = (await req.json()) as { from?: string; text?: string };
  const from = body.from === "agent" ? "agent" : "human";
  const text = (body.text ?? "").trim();
  if (!text) return json({ error: "text required" }, 400);

  const msg: Message = {
    id: newId(),
    from,
    text,
    timestamp: new Date().toISOString(),
  };
  messages.push(msg);
  if (messages.length > 200) messages.splice(0, messages.length - 200);

  broadcast({
    type: "shape:created",
    message: msg as unknown as Record<string, unknown>,
  });

  return json(msg, 201);
}

async function createMessage(req: Request) {
  const body = (await req.json()) as { from?: string; text?: string };
  const from = body.from === "agent" ? "agent" : "human";
  const text = (body.text ?? "").trim();
  if (!text) return json({ error: "text required" }, 400);

  const msg: Message = {
    id: newId(),
    from,
    text,
    timestamp: new Date().toISOString(),
  };
  messages.push(msg);
  if (messages.length > 200) messages.splice(0, messages.length - 200);

  broadcast({
    type: "message:created",
    message: msg as unknown as Record<string, unknown>,
  });

  return json(msg, 201);
}

function listMessages(req: Request) {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
  return json({ messages: messages.slice(-limit) });
}

async function postSnapshot(req: Request) {
  const body = (await req.json()) as { dataUrl?: string };
  if (!body.dataUrl) return json({ error: "dataUrl required" }, 400);

  canvasSnapshot = {
    dataUrl: body.dataUrl,
    timestamp: new Date().toISOString(),
  };
  broadcast({
    type: "snapshot:created",
    timestamp: canvasSnapshot.timestamp,
  });
  return json({ ok: true, timestamp: canvasSnapshot.timestamp });
}

function getSnapshot() {
  return json({ snapshot: canvasSnapshot });
}

async function createCanvasShape(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  broadcast({ type: "canvas:create_shape", shape: body });
  return json({ ok: true }, 201);
}

async function updateCanvasShape(req: Request) {
  const body = (await req.json()) as {
    shapeId: string;
    props: Record<string, unknown>;
  };
  if (!body.shapeId) return json({ error: "shapeId required" }, 400);

  broadcast({
    type: "canvas:update_shape",
    shapeId: body.shapeId,
    props: body.props ?? {},
  });
  return json({ ok: true });
}

async function deleteCanvasShapes(req: Request) {
  const body = (await req.json()) as { shapeIds: string[] };
  if (!body.shapeIds?.length) return json({ error: "shapeIds required" }, 400);

  broadcast({ type: "canvas:delete_shapes", shapeIds: body.shapeIds });
  return json({ ok: true });
}

async function moveViewport(req: Request) {
  const body = (await req.json()) as { x: number; y: number; zoom?: number };
  broadcast({
    type: "canvas:move_viewport",
    x: body.x,
    y: body.y,
    zoom: body.zoom,
  });
  return json({ ok: true });
}

function listShapes() {
  return json({
    hint: "Shape data is synced via Durable Objects. Use read_canvas for visual state, or the frontend will respond to shape queries.",
  });
}

// --- Start ---

Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  routes: {
    "/ws": (req, server) => {
      if (server.upgrade(req)) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    },

    "/api/shape": {
      POST: createShape,
    },

    "/api/message": {
      POST: createMessage,
    },

    "/api/messages": {
      GET: listMessages,
    },

    "/api/canvas/snapshot": {
      POST: postSnapshot,
      GET: getSnapshot,
    },

    "/api/canvas/create_shape": {
      POST: createCanvasShape,
    },

    "/api/canvas/update_shape": {
      POST: updateCanvasShape,
    },

    "/api/canvas/delete_shapes": {
      POST: deleteCanvasShapes,
    },

    "/api/canvas/move_viewport": {
      POST: moveViewport,
    },

    "/api/canvas/shapes": {
      GET: listShapes,
    },

    // CORS preflight for all API routes
    "/api/*": {
      OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders }),
    },
  },
  websocket: {
    open(ws) {
      addClient(ws);
    },
    close(ws) {
      removeClient(ws);
    },
    message() {},
  },
});

console.log(`graze server running on http://localhost:${PORT}`);
