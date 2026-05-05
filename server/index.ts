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
import { createCanvasImageHandlers } from "./canvasImage";

const PORT = parseInt(process.env.GRAZE_PORT ?? "3737", 10);
const ROOM_ID = process.env.GRAZE_ROOM_ID ?? "graze-main";

/**
 * The Cloudflare worker serves /api/images/generate. In dev it runs in-process
 * inside Vite on 5173 (via @cloudflare/vite-plugin); in prod it's served by
 * the deployed worker. Override via GRAZE_WORKER_URL if needed.
 */
const WORKER_URL = getWorkerUrl();
const WORKER_ACCESS_TOKEN = process.env.GRAZE_ACCESS_TOKEN;

const canvasImageHandlers = createCanvasImageHandlers({
  broadcast,
  fetchWorker: async (req) => {
    return fetchWorker(req);
  },
  createShape: (shape) => createAuthoritativeShape(shape),
});

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

function getWorkerUrl(): string {
  const configured = process.env.GRAZE_WORKER_URL;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("GRAZE_WORKER_URL is required when NODE_ENV=production");
  }
  return "http://localhost:5173";
}

async function fetchWorker(req: Request) {
  const src = new URL(req.url);
  const target = new URL(src.pathname + src.search, WORKER_URL);
  const next = new Request(target.toString(), req);
  if (WORKER_ACCESS_TOKEN) {
    next.headers.set("authorization", `Bearer ${WORKER_ACCESS_TOKEN}`);
  }
  return fetch(next);
}

async function workerJson(path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (WORKER_ACCESS_TOKEN) {
    headers.set("authorization", `Bearer ${WORKER_ACCESS_TOKEN}`);
  }
  const res = await fetch(new URL(path, WORKER_URL), { ...init, headers });
  if (!res.ok) {
    return { ok: false as const, res, text: await res.text() };
  }
  return { ok: true as const, body: await res.json() };
}

async function createAuthoritativeShape(shape: Record<string, unknown>) {
  return workerJson(`/api/rooms/${ROOM_ID}/shapes`, {
    method: "POST",
    body: JSON.stringify(shape),
  });
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

  const result = await createAuthoritativeShape({
    type: "note",
    id: `reply-${msg.id}`,
    x: 120,
    y: 100,
    props: {
      color: from === "agent" ? "light-violet" : "light-blue",
      richText: text,
    },
  });
  if (!result.ok) return json({ error: result.text }, result.res.status);

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

  const result = await createAuthoritativeShape({
    type: "note",
    id: `message-${msg.id}`,
    x: 120,
    y: 100,
    props: {
      color: from === "agent" ? "light-violet" : "yellow",
      richText: text,
    },
  });
  if (!result.ok) return json({ error: result.text }, result.res.status);

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
  return json({
    snapshot: canvasSnapshot,
    source: "browser-posted-snapshot",
    authoritative: false,
    hint: "Use /api/canvas/shapes for authoritative structured canvas state.",
  });
}

async function createCanvasShape(req: Request) {
  const body = (await req.json()) as Record<string, unknown>;
  const result = await createAuthoritativeShape(body);
  if (!result.ok) return json({ error: result.text }, result.res.status);
  return json(result.body, 201);
}

async function updateCanvasShape(req: Request) {
  const body = (await req.json()) as {
    shapeId: string;
    props: Record<string, unknown>;
  };
  if (!body.shapeId) return json({ error: "shapeId required" }, 400);

  const result = await workerJson(`/api/rooms/${ROOM_ID}/shapes/update`, {
    method: "POST",
    body: JSON.stringify({
      shapeId: body.shapeId,
      props: body.props ?? {},
    }),
  });
  if (!result.ok) return json({ error: result.text }, result.res.status);
  return json(result.body);
}

async function deleteCanvasShapes(req: Request) {
  const body = (await req.json()) as { shapeIds: string[] };
  if (!body.shapeIds?.length) return json({ error: "shapeIds required" }, 400);

  const result = await workerJson(`/api/rooms/${ROOM_ID}/shapes/delete`, {
    method: "POST",
    body: JSON.stringify({ shapeIds: body.shapeIds }),
  });
  if (!result.ok) return json({ error: result.text }, result.res.status);
  return json(result.body);
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

async function listShapes() {
  const result = await workerJson(`/api/rooms/${ROOM_ID}/shapes`);
  if (!result.ok) return json({ error: result.text }, result.res.status);
  return json(result.body);
}

async function unfurl(req: Request) {
  const url = new URL(req.url);
  const target = `/api/unfurl${url.search}`;
  const result = await workerJson(target, { method: "GET" });
  if (!result.ok) return json({ error: result.text }, result.res.status);
  return json(result.body);
}

// --- Main fetch handler ---

async function handleRequest(req: Request, server: Bun.Server) {
  const url = new URL(req.url);
  const pathname = url.pathname;
  const method = req.method;

  // WebSocket upgrade
  if (pathname === "/ws") {
    const success = server.upgrade(req);
    if (success) return undefined;
    return new Response("WebSocket upgrade failed", { status: 500 });
  }

  // CORS preflight
  if (method === "OPTIONS" && pathname.startsWith("/api/")) {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (pathname === "/api/shape" && method === "POST") {
    return createShape(req);
  }

  if (pathname === "/api/message" && method === "POST") {
    return createMessage(req);
  }

  if (pathname === "/api/messages" && method === "GET") {
    return listMessages(req);
  }

  if (pathname === "/api/unfurl" && method === "GET") {
    return unfurl(req);
  }

  if (pathname === "/api/canvas/snapshot") {
    if (method === "POST") return postSnapshot(req);
    if (method === "GET") return getSnapshot();
  }

  if (pathname === "/api/canvas/create_shape" && method === "POST") {
    return createCanvasShape(req);
  }

  if (pathname === "/api/canvas/update_shape" && method === "POST") {
    return updateCanvasShape(req);
  }

  if (pathname === "/api/canvas/delete_shapes" && method === "POST") {
    return deleteCanvasShapes(req);
  }

  if (pathname === "/api/canvas/move_viewport" && method === "POST") {
    return moveViewport(req);
  }

  if (pathname === "/api/canvas/shapes" && method === "GET") {
    return listShapes();
  }

  if (pathname === "/api/canvas/generate_image") {
    if (method === "POST") {
      return canvasImageHandlers.handleGenerateImage(req);
    }
    return methodNotAllowed(["POST"]);
  }

  if (pathname === "/api/canvas/rasterize_response") {
    if (method === "POST") {
      return canvasImageHandlers.handleRasterizeResponse(req);
    }
    return methodNotAllowed(["POST"]);
  }

  return new Response("Not Found", { status: 404 });
}

function methodNotAllowed(allowed: string[]): Response {
  return new Response(
    JSON.stringify({ error: "method not allowed" }),
    {
      status: 405,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        Allow: allowed.join(", "),
      },
    },
  );
}

// --- Start ---

Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  async fetch(req, server) {
    return handleRequest(req, server);
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
