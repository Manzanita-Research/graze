# Graze

**A shared sketchbook for you and your agents,**
**so you can touch grass instead of touching tmux**

Napkin sketches, UI wireframes & architecture diagrams, or just pass back & forth love notes and that Cool S Thing.

## What is this?

Graze is a [tldraw](https://tldraw.dev) canvas that your AI agents can see and draw on. Sketch something, send a snapshot, and your agent replies with shapes on the surface. It works as a plain MCP tool server, with optional [Claude Channels](https://docs.anthropic.com) support for passive events.

It's a napkin you both can reach.

## Demo

coming soon gimme a sec lol

## How it works

- Draw, write, or arrange things on the canvas
- Press **F12** (or tap the snapshot button) to send what you see to your agent
- Your agent reads the snapshot and replies — text appears as a sticky note on the canvas
- Keep going. Draw more, reply, rearrange. It's a conversation in space, not a chat log

## Suggested Pairings
- [Daylight DC-1](https://daylightcomputer.com) or iPad
- Private Tailscale network
- A picnic blanket
- Sunglasses
- Sunshine

## Network model

Graze is designed for a private boundary: a [Tailscale](https://tailscale.com)
tailnet, Cloudflare Access, or an equivalent access gate.

The Worker now rejects mutating and quota-bearing control routes outside local
development unless `GRAZE_ACCESS_TOKEN` is configured and callers send
`Authorization: Bearer <token>`. Browser sync still expects to live behind the
same private boundary, so do not expose the Worker publicly without Cloudflare
Access or similar in front of it. Wrangler preview URLs are disabled by default.

## Getting started

```bash
npm install
npm run dev:all
```

This starts the Vite dev server and the backend together. Open [localhost:5173](http://localhost:5173).

To run pieces separately:

```bash
npm run dev       # frontend only
bun run server    # backend on port 3737
bun run mcp       # MCP tool server
```

For Codex setup, see [docs/codex-mcp.md](docs/codex-mcp.md).

### Environment variables

Defaults work for local development. Production should be explicit.

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Bun side-channel API URL for the frontend. Required for production client builds. | `http://localhost:3737` in dev only |
| `GRAZE_PORT` | Port for the backend server | `3737` |
| `GRAZE_URL` | Backend URL for the MCP server | `http://localhost:3737` |
| `GRAZE_MCP_CHANNEL` | Optional passive channel bridge for MCP hosts. Use `off`/`codex` for generic MCP, or `claude` for Claude Channels notifications. | `off` |
| `GRAZE_WORKER_URL` | Worker URL used by the Bun sidecar. Required when `NODE_ENV=production`. | `http://localhost:5173` outside production |
| `GRAZE_ACCESS_TOKEN` | Shared bearer token for Worker control/image/upload routes outside local dev | unset |
| `GRAZE_ROOM_ID` | tldraw sync room used by the sidecar and MCP tools | `graze-main` |
| `REPLICATE_API_TOKEN` | Replicate token for `/api/images/generate` | unset |

## Architecture

Core parts:

- **Frontend** — React + tldraw. Connects to the Worker Durable Object for
  multiplayer canvas sync, and to the Bun side-channel for messages, viewport
  moves, browser rasterization requests, and manual visual snapshots.
- **Worker** (`worker/worker.ts`) — Cloudflare Worker that owns sync routes,
  uploads, unfurling, image generation, and room-scoped canvas control routes.
  Mutating, quota-bearing, and network-fetching helper routes are token-gated
  outside local dev.
- **Durable Object** (`worker/TLSyncDurableObject.ts`) — authoritative tldraw
  room state. Agent `create_shape`, `update_shape`, `delete_shapes`, `reply`,
  and generated image shapes now write through this path instead of depending on
  open browser tabs to mutate the document.
- **R2** — stores uploaded and generated assets under `/api/uploads/<id>`.
- **Bun sidecar** (`server/index.ts`) — local/MCP bridge. Stores messages and
  last browser-posted PNG snapshots in memory, forwards authoritative shape
  writes, bookmark unfurling, and image calls to the Worker, and still
  broadcasts non-authoritative UI events such as viewport moves and
  rasterization requests.
- **MCP server** (`mcp/index.ts`) — Model Context Protocol server for agents.
  Tools include `reply`, `create_shape`, `update_shape`, `delete_shapes`,
  `move_viewport`, `read_messages`, `read_canvas`, `read_shapes`, and
  `generate_image`. The direct tools are host-neutral. Passive Claude Channel
  notifications are opt-in via `GRAZE_MCP_CHANNEL=claude`.

Important distinction: `read_shapes` is authoritative structured canvas state
from the Durable Object. `read_canvas` is only the latest browser-posted visual
snapshot, so it can be stale or absent until a browser posts one.

## Tech

- [Vite](https://vitejs.dev) + React + TypeScript
- [tldraw](https://tldraw.dev) for the canvas
- [Cloudflare Workers](https://workers.cloudflare.com), Durable Objects, and R2
- [Bun](https://bun.sh) for the server runtime
- [MCP SDK](https://modelcontextprotocol.io) for agent communication
- [Replicate](https://replicate.com) for pinned `openai/gpt-image-2` image generation

## Install as PWA

**iPad / iPhone:** Open in Safari → Share → Add to Home Screen

**Android:** Open in Chrome → Menu → Install app

---

*A Manzanita Research project.*
