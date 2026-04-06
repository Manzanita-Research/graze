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
 * WebSocket: upgrade on any request with Upgrade: websocket
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

// --- HTTP handler ---

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // POST /api/shape — create a shape on the canvas (from agent reply tool)
  if (path === "/api/shape" && req.method === "POST") {
    const body = (await req.json()) as { from?: string; text?: string };
    const from = body.from === "agent" ? "agent" : "human";
    const text = (body.text ?? "").trim();
    if (!text) {
      return new Response(JSON.stringify({ error: "text required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const msg: Message = {
      id: newId(),
      from: from as "human" | "agent",
      text,
      timestamp: new Date().toISOString(),
    };
    messages.push(msg);
    if (messages.length > 200) messages.splice(0, messages.length - 200);

    // Broadcast as shape event — frontend will create a tldraw shape
    broadcast({ type: "shape:created", message: msg as unknown as Record<string, unknown> });

    return new Response(JSON.stringify(msg), {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // POST /api/message — create a message (backwards compat + human input)
  if (path === "/api/message" && req.method === "POST") {
    const body = (await req.json()) as { from?: string; text?: string };
    const from = body.from === "agent" ? "agent" : "human";
    const text = (body.text ?? "").trim();
    if (!text) {
      return new Response(JSON.stringify({ error: "text required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const msg: Message = {
      id: newId(),
      from: from as "human" | "agent",
      text,
      timestamp: new Date().toISOString(),
    };
    messages.push(msg);
    if (messages.length > 200) messages.splice(0, messages.length - 200);

    broadcast({ type: "message:created", message: msg as unknown as Record<string, unknown> });

    return new Response(JSON.stringify(msg), {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // GET /api/messages
  if (path === "/api/messages" && req.method === "GET") {
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const recent = messages.slice(-limit);
    return new Response(JSON.stringify({ messages: recent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // POST /api/canvas/snapshot
  if (path === "/api/canvas/snapshot" && req.method === "POST") {
    const body = (await req.json()) as { dataUrl?: string };
    if (!body.dataUrl) {
      return new Response(JSON.stringify({ error: "dataUrl required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    canvasSnapshot = { dataUrl: body.dataUrl, timestamp: new Date().toISOString() };
    broadcast({ type: "snapshot:created", timestamp: canvasSnapshot.timestamp });
    return new Response(JSON.stringify({ ok: true, timestamp: canvasSnapshot.timestamp }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // GET /api/canvas/snapshot
  if (path === "/api/canvas/snapshot" && req.method === "GET") {
    if (!canvasSnapshot) {
      return new Response(JSON.stringify({ snapshot: null }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ snapshot: canvasSnapshot }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // POST /api/canvas/create_shape — agent creates a shape on the canvas
  if (path === "/api/canvas/create_shape" && req.method === "POST") {
    const body = (await req.json()) as Record<string, unknown>;
    broadcast({ type: "canvas:create_shape", shape: body });
    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // POST /api/canvas/update_shape — agent updates a shape
  if (path === "/api/canvas/update_shape" && req.method === "POST") {
    const body = (await req.json()) as { shapeId: string; props: Record<string, unknown> };
    if (!body.shapeId) {
      return new Response(JSON.stringify({ error: "shapeId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    broadcast({ type: "canvas:update_shape", shapeId: body.shapeId, props: body.props ?? {} });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // POST /api/canvas/delete_shapes — agent deletes shapes
  if (path === "/api/canvas/delete_shapes" && req.method === "POST") {
    const body = (await req.json()) as { shapeIds: string[] };
    if (!body.shapeIds?.length) {
      return new Response(JSON.stringify({ error: "shapeIds required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    broadcast({ type: "canvas:delete_shapes", shapeIds: body.shapeIds });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // POST /api/canvas/move_viewport — agent moves the viewport
  if (path === "/api/canvas/move_viewport" && req.method === "POST") {
    const body = (await req.json()) as { x: number; y: number; zoom?: number };
    broadcast({ type: "canvas:move_viewport", x: body.x, y: body.y, zoom: body.zoom });
    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // GET /api/canvas/shapes — read all shapes as structured data
  if (path === "/api/canvas/shapes" && req.method === "GET") {
    // This is served by the frontend via snapshot — we broadcast a request
    // and the frontend responds. For now, return a hint to use read_canvas.
    return new Response(JSON.stringify({
      hint: "Shape data is synced via Durable Objects. Use read_canvas for visual state, or the frontend will respond to shape queries.",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response("Not found", { status: 404, headers: corsHeaders });
}

// --- Start ---

Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  fetch(req, server) {
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      server.upgrade(req);
      return;
    }
    return handleRequest(req);
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
