import { useRef, useCallback, useState, useMemo, useEffect } from "react";
import {
  Tldraw,
  Editor,
  useEditor,
  DefaultHorizontalAlignStyle,
  createShapeId,
  Vec,
  type TLAssetStore,
} from "tldraw";
import { useSync } from "@tldraw/sync";
import { toRichText } from "@tldraw/tlschema";
import "tldraw/tldraw.css";
import "./App.css";

const API_URL =
  import.meta.env.VITE_API_URL || `http://${window.location.hostname}:3737`;
const WS_URL = API_URL.replace(/^http/, "ws");
const SYNC_URL = `wss://${window.location.hostname}:8788`;
const ROOM_ID = "graze-main";

// Minimal asset store — no upload support for now
const assetStore: TLAssetStore = {
  async upload() {
    throw new Error("Asset uploads not supported yet");
  },
  resolve(asset) {
    return asset.props.src ?? null;
  },
};

const TOOLS = [
  {
    id: "select",
    label: "Select",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
      </svg>
    ),
  },
  {
    id: "draw",
    label: "Draw",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 19l7-7 3 3-7 7-3-3z" />
        <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
        <path d="M2 2l7.586 7.586" />
        <circle cx="11" cy="11" r="2" />
      </svg>
    ),
  },
  {
    id: "eraser",
    label: "Eraser",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 21h10" />
        <path d="M5.5 11.5L16 2l6 6-10.5 10.5a2 2 0 01-1.4.6H5.6a2 2 0 01-1.4-.6L2.5 16.8a2 2 0 010-2.8l3-2.5z" />
      </svg>
    ),
  },
  {
    id: "hand",
    label: "Hand",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 11V6a2 2 0 00-4 0v4" />
        <path d="M14 10V4a2 2 0 00-4 0v7" />
        <path d="M10 10.5V6a2 2 0 00-4 0v8" />
        <path d="M18 8a2 2 0 014 0v6a8 8 0 01-8 8h-2c-2.5 0-4.5-1-6.2-2.8L3 16" />
      </svg>
    ),
  },
  {
    id: "text",
    label: "Text",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <polyline points="4 7 4 4 20 4 20 7" />
        <line x1="9" y1="20" x2="15" y2="20" />
        <line x1="12" y1="4" x2="12" y2="20" />
      </svg>
    ),
  },
  {
    id: "note",
    label: "Sticky Note",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M15.5 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V8.5L15.5 3z" />
        <polyline points="14 3 14 9 21 9" />
      </svg>
    ),
  },
  {
    id: "geo",
    label: "Rectangle",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
      </svg>
    ),
  },
  {
    id: "arrow",
    label: "Arrow",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    ),
  },
  {
    id: "highlight",
    label: "Highlight",
    icon: (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 11l-6 6v3h9l3-3" />
        <path d="M22 12l-4.6 4.6a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8L14 4" />
      </svg>
    ),
  },
];

/** Find the lowest point of all existing shapes to place new ones below */
function getNextY(editor: Editor): number {
  const shapes = editor.getCurrentPageShapes();
  if (shapes.length === 0) return 100;

  let maxBottom = 0;
  for (const shape of shapes) {
    const bounds = editor.getShapePageBounds(shape.id);
    if (bounds) {
      const bottom = bounds.maxY;
      if (bottom > maxBottom) maxBottom = bottom;
    }
  }
  return maxBottom + 40;
}

/** Create a note shape on the canvas for an agent message */
function createAgentShape(editor: Editor, text: string, id: string) {
  const y = getNextY(editor);
  const shapeId = createShapeId(id);

  editor.createShape({
    id: shapeId,
    type: "note",
    x: 120,
    y,
    props: {
      richText: toRichText(text),
      color: "yellow",
      size: "m",
    },
  });
}

/** Create a note shape for a human message */
function createHumanShape(editor: Editor, text: string, id: string) {
  const y = getNextY(editor);
  const shapeId = createShapeId(id);

  editor.createShape({
    id: shapeId,
    type: "note",
    x: 120,
    y,
    props: {
      richText: toRichText(text),
      color: "yellow",
      size: "m",
    },
  });
}

/** Zoom helpers */
function ZoomHelper() {
  const editor = useEditor();

  useEffect(() => {
    const container = editor.getContainer();
    let twoFingerStart = 0;
    let lastTwoFingerTap = 0;
    let tapCenter = { x: 0, y: 0 };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        twoFingerStart = Date.now();
        tapCenter = {
          x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };
      } else {
        twoFingerStart = 0;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length !== 0 || !twoFingerStart) return;
      const duration = Date.now() - twoFingerStart;
      if (duration > 300) {
        twoFingerStart = 0;
        return;
      }

      const now = Date.now();
      if (now - lastTwoFingerTap < 500) {
        lastTwoFingerTap = 0;
        twoFingerStart = 0;
        editor.resetZoom(new Vec(tapCenter.x, tapCenter.y), {
          animation: { duration: 200 },
        });
      } else {
        lastTwoFingerTap = now;
      }
      twoFingerStart = 0;
    };

    const DETENT = 0.04;
    let prevZoom = editor.getZoomLevel();
    let snappedAt100 = false;

    const unsub = editor.store.listen(() => {
      const zoom = editor.getZoomLevel();
      if (zoom === prevZoom) return;
      const crossed = (prevZoom < 1 && zoom > 1) || (prevZoom > 1 && zoom < 1);
      const near100 = Math.abs(zoom - 1) < DETENT;
      if ((crossed || near100) && !snappedAt100) {
        snappedAt100 = true;
        const cam = editor.getCamera();
        editor.setCamera({ x: cam.x, y: cam.y, z: 1 }, { immediate: true });
      } else if (Math.abs(zoom - 1) > DETENT * 2) {
        snappedAt100 = false;
      }
      prevZoom = editor.getZoomLevel();
    });

    container.addEventListener("touchstart", onTouchStart, { passive: true });
    container.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      container.removeEventListener("touchstart", onTouchStart);
      container.removeEventListener("touchend", onTouchEnd);
      unsub();
    };
  }, [editor]);

  return null;
}

function ToolDock({
  onClear,
  onSnapshot,
}: {
  onClear: () => void;
  onSnapshot: () => void;
}) {
  const editor = useEditor();
  const [currentTool, setCurrentTool] = useState("draw");
  const [penMode, setPenMode] = useState(
    () => editor.getInstanceState().isPenMode,
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTool(editor.getCurrentToolId());
      setPenMode(editor.getInstanceState().isPenMode);
    }, 100);
    return () => clearInterval(interval);
  }, [editor]);

  const togglePenMode = useCallback(() => {
    const next = !editor.getInstanceState().isPenMode;
    editor.updateInstanceState({ isPenMode: next });
    setPenMode(next);
  }, [editor]);

  return (
    <div className="graze-dock">
      <span className="dock-logo">Gz</span>
      <button
        className={`dock-btn dock-pen-toggle ${penMode ? "active" : ""}`}
        onClick={togglePenMode}
        title={penMode ? "Pen mode (touch ignored)" : "Touch mode (all input)"}
      >
        {penMode ? (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M18 11V6a2 2 0 00-4 0v4" />
            <path d="M14 10V4a2 2 0 00-4 0v7" />
            <path d="M10 10.5V6a2 2 0 00-4 0v8" />
            <path d="M18 8a2 2 0 014 0v6a8 8 0 01-8 8h-2c-2.5 0-4.5-1-6.2-2.8L3 16" />
          </svg>
        )}
      </button>
      <div className="dock-divider" />
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          className={`dock-btn dock-tool ${currentTool === tool.id ? "active" : ""}`}
          onClick={() => editor.setCurrentTool(tool.id)}
          title={tool.label}
        >
          {tool.icon}
        </button>
      ))}
      <div className="dock-spacer" />
      <div className="dock-divider" />
      <button className="dock-btn" onClick={onClear} title="Clear canvas">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 6h18" />
          <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
          <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
        </svg>
      </button>
      <button
        className="dock-btn"
        onClick={onSnapshot}
        title="Send snapshot to agent"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      </button>
    </div>
  );
}

/** Floating message input (replaces sidebar) */
function MessageInput({ onSend }: { onSend: (text: string) => void }) {
  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    onSend(text);
    setInput("");
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <button
        className="graze-chat-fab"
        onClick={() => setExpanded(true)}
        title="Send a message"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </svg>
      </button>
    );
  }

  return (
    <form className="graze-chat-input" onSubmit={handleSubmit}>
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="Message the agent..."
        autoFocus
        onBlur={() => {
          if (!input.trim()) setExpanded(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") setExpanded(false);
        }}
      />
      <button type="submit">↑</button>
    </form>
  );
}

function App() {
  const editorRef = useRef<Editor | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Sync store via Cloudflare Durable Objects
  const store = useSync({
    uri: `${SYNC_URL}/api/connect/${ROOM_ID}`,
    assets: assetStore,
  });

  // F12 keybinding for snapshot
  const handleSnapshotRef = useRef<() => void>(() => {});

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "F12") {
        e.preventDefault();
        handleSnapshotRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Connect WebSocket and handle shape creation events
  useEffect(() => {
    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          const editor = editorRef.current;
          if (!editor) return;

          // Agent reply → create shape on canvas
          if (data.type === "shape:created" && data.message) {
            const msg = data.message;
            if (msg.from === "agent") {
              createAgentShape(editor, msg.text, msg.id);
            }
          }

          // Human message → also create shape on canvas (from other devices)
          if (data.type === "message:created" && data.message) {
            const msg = data.message;
            if (msg.from === "human") {
              createHumanShape(editor, msg.text, msg.id);
            }
          }

          // Agent creates an arbitrary shape
          if (data.type === "canvas:create_shape" && data.shape) {
            const s = data.shape;
            editor.createShape({
              id: s.id ? createShapeId(s.id as string) : createShapeId(),
              type: ((s.type as string) ?? "geo") as "geo",
              x: (s.x as number) ?? 0,
              y: (s.y as number) ?? 0,
              props: (s.props as Record<string, unknown>) ?? {},
            } as any);
          }

          // Agent updates a shape's props
          if (data.type === "canvas:update_shape") {
            const shapes = editor.getCurrentPageShapes();
            const target = shapes.find((sh) => sh.id.includes(data.shapeId));
            if (target) {
              editor.updateShape({
                id: target.id,
                type: target.type,
                props: { ...target.props, ...data.props },
              });
            }
          }

          // Agent deletes shapes
          if (data.type === "canvas:delete_shapes" && data.shapeIds) {
            const shapes = editor.getCurrentPageShapes();
            const ids = shapes
              .filter((sh) =>
                data.shapeIds.some((sid: string) => sh.id.includes(sid)),
              )
              .map((sh) => sh.id);
            if (ids.length > 0) editor.deleteShapes(ids);
          }

          // Agent moves viewport
          if (data.type === "canvas:move_viewport") {
            const zoom = data.zoom ?? editor.getZoomLevel();
            editor.setCamera(
              { x: -(data.x as number), y: -(data.y as number), z: zoom },
              {
                animation: { duration: 300 },
              },
            );
          }
        } catch {}
      };

      ws.onclose = () => {
        setTimeout(connect, 2000);
      };
    }

    connect();
    return () => {
      wsRef.current?.close();
    };
  }, []);

  const options = useMemo(
    () => ({
      gridSteps: [
        { min: -1, mid: 0.15, step: 20 },
        { min: 0.05, mid: 0.375, step: 8 },
        { min: 0.15, mid: 1, step: 4 },
        { min: 0.7, mid: 2.5, step: 1 },
      ],
    }),
    [],
  );

  const handleMount = useCallback((editor: Editor) => {
    editorRef.current = editor;
    editor.updateInstanceState({ isGridMode: true, isPenMode: true });
    editor.setCurrentTool("draw");
    editor.setStyleForNextShapes(DefaultHorizontalAlignStyle, "middle");

    editor.sideEffects.registerAfterChangeHandler("shape", (prev, next) => {
      if (
        next.type === "highlight" &&
        !(prev.props as any).isComplete &&
        (next.props as any).isComplete
      ) {
        editor.sendToBack([next.id]);
      }
    });
    editor.sideEffects.registerAfterCreateHandler("shape", (shape) => {
      if (shape.type === "highlight") {
        editor.sendToBack([shape.id]);
      }
    });
  }, []);

  const handleSendMessage = useCallback(async (text: string) => {
    try {
      await fetch(`${API_URL}/api/message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from: "human", text }),
      });
    } catch (err) {
      console.error("Failed to send message:", err);
    }
  }, []);

  const handleSnapshot = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;

    const shapeIds = editor.getCurrentPageShapeIds();
    if (shapeIds.size === 0) return;

    try {
      const result = await editor.toImage([...shapeIds], {
        format: "png",
        pixelRatio: 2,
        background: true,
        padding: 32,
      });
      if (!result) return;

      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = reader.result as string;
        await fetch(`${API_URL}/api/canvas/snapshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dataUrl }),
        });
      };
      reader.readAsDataURL(result.blob);
    } catch (err) {
      console.error("Snapshot failed:", err);
    }
  }, []);

  // Keep ref in sync for F12 handler
  useEffect(() => {
    handleSnapshotRef.current = handleSnapshot;
  }, [handleSnapshot]);

  const handleClear = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const shapeIds = editor.getCurrentPageShapeIds();
    if (shapeIds.size === 0) return;
    editor.deleteShapes([...shapeIds]);
  }, []);

  return (
    <div className="graze">
      <div className="canvas">
        <Tldraw
          store={store}
          onMount={handleMount}
          options={options}
          components={{
            HelpMenu: null,
            DebugPanel: null,
            DebugMenu: null,
            MenuPanel: null,
            PageMenu: null,
            NavigationPanel: null,
            Minimap: null,
            Toolbar: null,
            HelperButtons: null,
          }}
        >
          <ZoomHelper />
          <ToolDock onClear={handleClear} onSnapshot={handleSnapshot} />
        </Tldraw>
      </div>
      <MessageInput onSend={handleSendMessage} />
    </div>
  );
}

export default App;
