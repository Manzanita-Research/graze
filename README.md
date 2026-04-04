# ClawPad 🐾

A digital napkin. Sketch something, push it to your agent.

## What is this?

ClawPad is a minimal canvas app built with [tldraw](https://tldraw.dev). Draw on it like a napkin, then hit "Push to OpenClaw" to send your sketch to your AI agent.

That's it. That's the app.

## Features

- **tldraw canvas** — full drawing toolkit, stylus-optimized
- **Push to OpenClaw** — exports as PNG (webhook integration coming)
- **Clear** — fresh napkin, ready for your next thought
- **PWA** — install on iPad, DC-1, or any device

## Getting Started

```bash
npm install
cp .env.example .env
# Edit .env with your gateway URL and hook token
npm run dev
```

Open http://localhost:5173

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_GATEWAY_URL` | OpenClaw Gateway URL | `http://127.0.0.1:18789` |
| `VITE_HOOK_TOKEN` | Webhook token from `hooks.token` in `openclaw.json` | (required) |

## Install as PWA

**iPad/iPhone:**
1. Open in Safari
2. Tap Share → Add to Home Screen

**Android/DC-1:**
1. Open in Chrome
2. Tap menu → Install app

## Development

```bash
npm run dev      # Start dev server
npm run build    # Production build
npm run preview  # Preview production build
```

## Tech

- [Vite](https://vitejs.dev) + React + TypeScript
- [tldraw](https://tldraw.dev) — the canvas

## TODO

- [x] POST to OpenClaw webhook instead of download
- [ ] History of sent napkins
- [ ] DC-1 Live Paper color theme

---

*Napkin → Agent. That's it.*
