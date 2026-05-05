# Using Graze from Codex

Graze works in Codex as a local stdio MCP server. Codex gets the direct tool
surface: create shapes, update shapes, delete shapes, read structured canvas
state, read snapshots, move the viewport, and generate image shapes.

## Local setup

Start the Graze app stack:

```bash
npm run dev:all
```

Open the canvas at <http://localhost:5173>. The MCP server talks to the Bun
sidecar at <http://localhost:3737>.

## Add the MCP server to Codex

From this repo, run:

```bash
codex mcp add graze \
  --env GRAZE_REPO="$PWD" \
  --env GRAZE_URL=http://localhost:3737 \
  --env GRAZE_MCP_CHANNEL=off \
  -- /bin/zsh -lc 'cd "$GRAZE_REPO" && bun run mcp'
```

Equivalent `~/.codex/config.toml` entry:

```toml
[mcp_servers.graze]
command = "/bin/zsh"
args = ["-lc", "cd \"$GRAZE_REPO\" && bun run mcp"]
env = { GRAZE_REPO = "/absolute/path/to/graze", GRAZE_URL = "http://localhost:3737", GRAZE_MCP_CHANNEL = "off" }
```

Restart Codex after adding the server so the tool list refreshes.

## What works in Codex

- `create_shape`, `update_shape`, `delete_shapes`, and `reply` write through
  the Durable Object-backed tldraw store. They work even when no browser tab is
  open, though you need a browser open to see the canvas live.
- `read_shapes` returns authoritative structured canvas state.
- `read_canvas` returns the latest browser-posted visual snapshot. It is stale
  or empty until the browser posts one with F12 or the snapshot button.
- `generate_image` without `referenceShapeIds` creates an image shape through
  the Worker/Bun path.
- `generate_image` with `referenceShapeIds` still needs an open browser tab,
  because the browser rasterizes selected tldraw shapes before generation.
- `move_viewport` needs an open browser tab, because viewport motion is a UI
  command rather than stored document state.

## Passive channels

By default, `GRAZE_MCP_CHANNEL=off` makes Graze plain, host-neutral MCP. That is
the right mode for Codex.

Claude Code users who want passive `<channel>` events can opt in:

```bash
GRAZE_MCP_CHANNEL=claude bun run mcp
```

In Claude mode, the server advertises the `claude/channel` experimental
capability and forwards human messages/snapshot pings as
`notifications/claude/channel`. In Codex mode, those host-specific notifications
are disabled; use `read_messages`, `read_shapes`, and `read_canvas` instead.
