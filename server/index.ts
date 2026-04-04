#!/usr/bin/env bun
/**
 * Graze HTTP + WebSocket server.
 *
 * Endpoints:
 *   POST /api/message          — agent or UI posts a message
 *   GET  /api/messages         — list recent messages
 *   POST /api/canvas/snapshot  — UI posts a canvas snapshot (PNG base64)
 *   GET  /api/canvas/snapshot  — agent reads latest canvas snapshot
 *
 * WebSocket: upgrade on any request with Upgrade: websocket
 */

import { addClient, removeClient, broadcast } from "./ws";

const PORT = parseInt(process.env.GRAZE_PORT ?? "3737", 10);

// --- In-memory store (no DB needed for POC) ---

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

  // CORS headers for dev
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // POST /api/message — create a message (from human or agent)
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
    // Keep last 200 messages
    if (messages.length > 200) messages.splice(0, messages.length - 200);

    broadcast({ type: "message:created", message: msg as unknown as Record<string, unknown> });

    return new Response(JSON.stringify(msg), {
      status: 201,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // GET /api/messages — list messages
  if (path === "/api/messages" && req.method === "GET") {
    const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const recent = messages.slice(-limit);
    return new Response(JSON.stringify({ messages: recent }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // POST /api/canvas/snapshot — UI sends canvas screenshot
  if (path === "/api/canvas/snapshot" && req.method === "POST") {
    const body = (await req.json()) as { dataUrl?: string };
    if (!body.dataUrl) {
      return new Response(JSON.stringify({ error: "dataUrl required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    canvasSnapshot = { dataUrl: body.dataUrl, timestamp: new Date().toISOString() };
    return new Response(JSON.stringify({ ok: true, timestamp: canvasSnapshot.timestamp }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // GET /api/canvas/snapshot — agent reads latest canvas screenshot
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

  return new Response("Not found", { status: 404, headers: corsHeaders });
}

// --- Start ---

Bun.serve({
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
