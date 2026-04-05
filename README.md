# Graze

**A shared sketchbook for you and your agents,**
**so you can touch grass instead of touching tmux**

Napkin sketches, UI wireframes & architecture diagrams, or just pass back & forth love notes and that Cool S Thing.

## What is this?

Graze is a [tldraw](https://tldraw.dev) canvas that your AI agents can see and draw on. Sketch something, send a snapshot, and your agent replies with shapes on the surface. Works with anything that speaks [Claude Channels](https://docs.anthropic.com).

It's a napkin you both can reach.

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

Graze has no authentication. It's designed to run inside a [Tailscale](https://tailscale.com) tailnet (or similar private network). If you expose it to the public internet, anyone can draw on your canvas and talk to your agent.

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
bun run mcp       # MCP channel server
```

### Environment variables

All optional. Defaults work for local development.

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API URL for the frontend | `http://<hostname>:3737` |
| `GRAZE_PORT` | Port for the backend server | `3737` |
| `GRAZE_URL` | Backend URL for the MCP server | `http://localhost:3737` |

## Architecture

Three parts:

- **Frontend** — React + tldraw. Connects to the backend over WebSocket for real-time shape updates. Custom dock with drawing tools, pen/touch toggle, and a floating message input.
- **Backend** (`server/index.ts`) — Bun HTTP + WebSocket server. Stores messages and canvas snapshots in memory. Broadcasts shape and message events to all connected clients.
- **MCP channel** (`mcp/index.ts`) — Model Context Protocol server that bridges the canvas to Claude Code. Declares a `claude/channel` capability so canvas messages arrive as `<channel>` events. Exposes three tools: `reply`, `read_messages`, and `read_canvas`.

## Tech

- [Vite](https://vitejs.dev) + React + TypeScript
- [tldraw](https://tldraw.dev) for the canvas
- [Bun](https://bun.sh) for the server runtime
- [MCP SDK](https://modelcontextprotocol.io) for agent communication

## Install as PWA

**iPad / iPhone:** Open in Safari → Share → Add to Home Screen

**Android:** Open in Chrome → Menu → Install app

---

*A Manzanita Research project.*
