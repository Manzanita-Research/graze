import { useRef, useCallback, useState, useMemo, useEffect } from "react";
import {
  Tldraw,
  Editor,
  useEditor,
  DefaultHorizontalAlignStyle,
  createShapeId,
  Vec,
  AssetRecordType,
  renderPlaintextFromRichText,
  type TLShape,
  type TLShapeId,
} from "tldraw";
import { useSync } from "@tldraw/sync";
import { toRichText } from "@tldraw/tlschema";
import "tldraw/tldraw.css";
import "./App.css";
import { getBookmarkPreview } from "./getBookmarkPreview";
import { multiplayerAssetStore } from "./multiplayerAssetStore";
import {
  buildPromptFromSelection,
  isTextOnlySelection,
} from "./imagePromptComposition";

const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:3737";
const WS_URL = new URL("/ws", API_URL.replace(/^http/, "ws")).toString();
const SYNC_URL = `ws://${window.location.host}`;

const ROOM_ID = "graze-main";

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

/** Native image size returned by gpt-image-2 at 1024x1024. */
const GENERATED_IMAGE_NATIVE = 1024;
/** Canvas display size for both the placeholder and the final image shape. */
const GENERATED_IMAGE_CANVAS = 384;

const IMAGE_ICON = (
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
    <circle cx="8.5" cy="9" r="1.5" />
    <path d="M21 15l-4.5-4.5L7 20" />
    <path d="M14 7l4 4" strokeDasharray="1 2" />
  </svg>
);

/** Extract plain text from a text/note shape's richText, returning "" otherwise. */
function getShapeText(editor: Editor, shape: TLShape): string {
  if (shape.type !== "text" && shape.type !== "note") return "";
  const richText = (shape.props as { richText?: unknown }).richText;
  if (!richText) return "";
  try {
    return renderPlaintextFromRichText(
      editor,
      richText as Parameters<typeof renderPlaintextFromRichText>[1],
    );
  } catch {
    return "";
  }
}

/**
 * Compute the target page-rect where the placeholder/final image shape should
 * land. If a selection exists, place the shape just below it horizontally
 * centered; otherwise fall back to `getNextY()`.
 */
function getImageDropPosition(editor: Editor): { x: number; y: number } {
  const sel = editor.getSelectionPageBounds();
  if (sel) {
    return {
      x: sel.midX - GENERATED_IMAGE_CANVAS / 2,
      y: sel.maxY + 40,
    };
  }
  return { x: 120, y: getNextY(editor) };
}

/** Create a placeholder geo shape so users see progress mid-flight. */
function createPlaceholderShape(editor: Editor): TLShapeId {
  const id = createShapeId();
  const { x, y } = getImageDropPosition(editor);
  editor.createShape({
    id,
    type: "geo",
    x,
    y,
    props: {
      geo: "rectangle",
      dash: "dashed",
      color: "grey",
      fill: "none",
      w: GENERATED_IMAGE_CANVAS,
      h: GENERATED_IMAGE_CANVAS,
      richText: toRichText("Generating image…"),
    },
  });
  return id;
}

/** Remove a placeholder by id if it still exists. */
function removePlaceholder(editor: Editor, id: TLShapeId) {
  if (editor.getShape(id)) editor.deleteShapes([id]);
}

/**
 * Create a real tldraw image shape referencing a registered asset at the
 * position currently occupied by the placeholder (or fallback bounds).
 * Must be called AFTER the placeholder has been deleted.
 */
function createImageShape(
  editor: Editor,
  url: string,
  x: number,
  y: number,
): TLShapeId {
  const assetId = AssetRecordType.createId();
  editor.createAssets([
    {
      id: assetId,
      type: "image",
      typeName: "asset",
      meta: {},
      props: {
        name: "generated.png",
        src: url,
        w: GENERATED_IMAGE_NATIVE,
        h: GENERATED_IMAGE_NATIVE,
        mimeType: "image/png",
        isAnimated: false,
      },
    },
  ]);
  const shapeId = createShapeId();
  editor.createShape({
    id: shapeId,
    type: "image",
    x,
    y,
    props: {
      assetId,
      w: GENERATED_IMAGE_CANVAS,
      h: GENERATED_IMAGE_CANVAS,
    },
  });
  return shapeId;
}

type ImageGenerationOutcome =
  | { kind: "ok"; shapeId: TLShapeId; url: string }
  | { kind: "error"; message: string };

interface GenerateImageOptions {
  typedPrompt: string;
  selectedIds: TLShapeId[];
  signal?: AbortSignal;
}

/**
 * Orchestrate a single image-generation round:
 *   1. Classify the selection (text-only vs visual/mixed vs empty).
 *   2. Create a placeholder shape.
 *   3. POST to `/api/images/generate` (JSON or multipart).
 *   4. On success, remove placeholder and create an image shape with a
 *      registered asset so it round-trips through @tldraw/sync.
 *   5. On error, remove placeholder and return a user-visible error message.
 */
async function generateImage(
  editor: Editor,
  opts: GenerateImageOptions,
): Promise<ImageGenerationOutcome> {
  const { typedPrompt, selectedIds, signal } = opts;
  const selectedShapes = selectedIds
    .map((id) => editor.getShape(id))
    .filter((s): s is TLShape => s != null);

  const hasSelection = selectedShapes.length > 0;
  const textOnly = isTextOnlySelection(selectedShapes);
  const isVisual = hasSelection && !textOnly;

  // Reserve the target spot with a placeholder BEFORE doing async work so the
  // drop position is captured while the source selection is still the basis.
  const placeholderId = createPlaceholderShape(editor);
  const placeholder = editor.getShape(placeholderId);
  const targetX = placeholder?.x ?? 120;
  const targetY = placeholder?.y ?? 100;

  try {
    let request: Request;
    if (isVisual) {
      // Rasterize the selection and POST multipart.
      const image = await editor.toImage(selectedIds, {
        format: "png",
        pixelRatio: 2,
        background: true,
        padding: 16,
      });
      if (!image) throw new Error("Could not rasterize the selection");
      const form = new FormData();
      form.append("prompt", typedPrompt.trim());
      form.append(
        "image",
        new File([image.blob], "selection.png", { type: "image/png" }),
      );
      request = new Request("/api/images/generate", {
        method: "POST",
        body: form,
        signal,
      });
    } else {
      const shapeTexts = hasSelection
        ? selectedShapes.map((s) => getShapeText(editor, s))
        : [];
      const prompt = buildPromptFromSelection(typedPrompt, shapeTexts);
      request = new Request("/api/images/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
        signal,
      });
    }

    const res = await fetch(request);
    if (!res.ok) {
      let message = `Request failed with status ${res.status}`;
      try {
        const body = (await res.json()) as {
          error?: { message?: string; status?: number };
        };
        if (body?.error?.message) {
          message = body.error.message;
        }
      } catch {
        // body wasn't JSON — use the generic message above
      }
      throw new Error(message);
    }

    const body = (await res.json()) as { url?: string };
    const url = body?.url;
    if (!url) throw new Error("Backend returned no image URL");

    removePlaceholder(editor, placeholderId);
    const shapeId = createImageShape(editor, url, targetX, targetY);
    return { kind: "ok", shapeId, url };
  } catch (err) {
    removePlaceholder(editor, placeholderId);
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Failed to generate image";
    return { kind: "error", message };
  }
}

/**
 * Handle a `canvas:rasterize_request` from the Bun server: rasterize the
 * requested tldraw shapes and POST the resulting PNG data URL back to
 * /api/canvas/rasterize_response keyed by the supplied requestId.
 *
 * Non-existent shape ids are ignored silently on the frontend — the backend's
 * timeout path surfaces a clean error to the agent if nothing renderable is
 * found.
 */
async function rasterizeAndRespond(
  editor: Editor,
  requestId: string,
  shapeIds: string[],
): Promise<void> {
  try {
    const validIds = shapeIds
      .map((raw) => {
        const existing = editor.getCurrentPageShapes().find(
          (sh) => sh.id === raw || sh.id.includes(raw),
        );
        return existing?.id;
      })
      .filter((id): id is TLShapeId => !!id);
    if (validIds.length === 0) return;

    const image = await editor.toImage(validIds, {
      format: "png",
      pixelRatio: 2,
      background: true,
      padding: 16,
    });
    if (!image) return;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error("reader failed"));
      reader.readAsDataURL(image.blob);
    });

    await fetch(`${API_URL}/api/canvas/rasterize_response`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId, dataUrl }),
    });
  } catch (err) {
    // Don't crash the WS handler; the backend timeout will surface an error.
    console.error("rasterize_request handler failed:", err);
  }
}

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
  onImageClick,
}: {
  onClear: () => void;
  onSnapshot: () => void;
  onImageClick: () => void;
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
      <button
        className="dock-btn dock-image-btn"
        onClick={onImageClick}
        title="Generate image"
        aria-label="Generate image"
      >
        {IMAGE_ICON}
      </button>
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

export type PromptSubmitResult =
  | { ok: true }
  | { ok: false; hint: string };

/**
 * Shared prompt form for the image tool. Opens with focus in the input,
 * closes cleanly on Escape or cancel (no network side effects), and delegates
 * validation to the parent via `onSubmit`, which can return a hint to keep the
 * form open when the typed prompt doesn't satisfy the current selection mode.
 */
function ImagePromptForm({
  onSubmit,
  onCancel,
  placeholder,
}: {
  onSubmit: (typed: string) => Promise<PromptSubmitResult> | PromptSubmitResult;
  onCancel: () => void;
  placeholder: string;
}) {
  const [value, setValue] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Focus the input when the form opens (VAL-CANVAS-002).
    inputRef.current?.focus();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const result = await onSubmit(value);
      if (result.ok === false) {
        setHint(result.hint);
        inputRef.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  };

  // Bound to the form element so Escape closes the form regardless of
  // which internal control (input, Cancel button, Submit button) has focus.
  // Keeps VAL-CANVAS-021 working for the input-focused path.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div className="graze-image-form-overlay" onMouseDown={onCancel}>
      <form
        className="graze-image-form"
        onSubmit={handleSubmit}
        onKeyDown={handleKeyDown}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (hint) setHint(null);
          }}
          placeholder={placeholder}
          aria-label="Image prompt"
        />
        <div className="graze-image-form-actions">
          <button
            type="button"
            className="graze-image-form-cancel"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button type="submit" className="graze-image-form-submit">
            Generate
          </button>
        </div>
        {hint && <div className="graze-image-form-hint">{hint}</div>}
      </form>
    </div>
  );
}

/**
 * Floating action anchored to the current selection bounds. Visible only
 * when >=2 shapes are selected. Follows the selection as the camera pans/zooms.
 */
function FloatingGenerateAction({
  onClick,
  hidden,
}: {
  onClick: () => void;
  hidden: boolean;
}) {
  const editor = useEditor();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const update = () => {
      const ids = editor.getSelectedShapeIds();
      if (ids.length < 2) {
        setPos(null);
        return;
      }
      const bounds = editor.getSelectionPageBounds();
      if (!bounds) {
        setPos(null);
        return;
      }
      // Screen-space position: center of top edge of selection, nudged up.
      const topCenterPage = new Vec(bounds.midX, bounds.minY);
      const screen = editor.pageToScreen(topCenterPage);
      setPos({ x: screen.x, y: screen.y });
    };
    update();
    const interval = setInterval(update, 100);
    return () => clearInterval(interval);
  }, [editor]);

  if (hidden || !pos) return null;

  return (
    <button
      type="button"
      className="graze-float-generate"
      style={{ left: `${pos.x}px`, top: `${pos.y - 44}px` }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={onClick}
      title="Generate image from selection"
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="9" r="1.5" />
        <path d="M21 15l-4.5-4.5L7 20" />
      </svg>
      <span>Generate image</span>
    </button>
  );
}

/** Minimal toast for user-visible errors. Auto-hides after a few seconds. */
function Toast({
  message,
  onClose,
}: {
  message: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className="graze-toast" role="alert">
      <span>{message}</span>
      <button
        type="button"
        className="graze-toast-close"
        onClick={onClose}
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

/**
 * Owns image-generation form state + toast. Renders the floating generate
 * action, the prompt form, and the toast inside the Tldraw context so
 * `useEditor` works. The dock button triggers `onRequestOpen` on the parent.
 */
function CanvasImageTool({
  formOpen,
  onRequestOpen,
  onClose,
}: {
  formOpen: boolean;
  onRequestOpen: () => void;
  onClose: () => void;
}) {
  const editor = useEditor();
  const [toast, setToast] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Classify the current selection on each call — the parent re-mounts the
  // form by toggling `formOpen`, and submits are validated against live state.
  const classifySelection = useCallback(() => {
    const selectedIds = [...editor.getSelectedShapeIds()];
    const shapes = selectedIds
      .map((id) => editor.getShape(id))
      .filter((s): s is TLShape => s != null);
    const textOnly = isTextOnlySelection(shapes);
    const isVisual = shapes.length > 0 && !textOnly;
    return { selectedIds, shapes, isVisual };
  }, [editor]);

  const handleCancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    onClose();
  }, [onClose]);

  const handleSubmit = useCallback(
    async (typed: string): Promise<PromptSubmitResult> => {
      const { selectedIds, isVisual } = classifySelection();
      if (isVisual && !typed.trim()) {
        return {
          ok: false,
          hint: "Type a prompt to guide the image generated from your selection.",
        };
      }

      onClose();

      const abort = new AbortController();
      abortRef.current = abort;

      const outcome = await generateImage(editor, {
        typedPrompt: typed,
        selectedIds,
        signal: abort.signal,
      });
      if (abortRef.current === abort) abortRef.current = null;
      if (outcome.kind === "error") {
        setToast(outcome.message);
      }
      return { ok: true };
    },
    [editor, onClose, classifySelection],
  );

  // Only used to choose the placeholder copy in the form when it opens. Safe
  // to call during render — classifySelection reads from the reactive editor
  // store directly rather than from React state.
  const placeholder = formOpen
    ? classifySelection().isVisual
      ? "Describe how to transform the selection…"
      : "Describe the image to generate…"
    : "";

  return (
    <>
      <FloatingGenerateAction onClick={onRequestOpen} hidden={formOpen} />
      {formOpen && (
        <ImagePromptForm
          onSubmit={handleSubmit}
          onCancel={handleCancel}
          placeholder={placeholder}
        />
      )}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </>
  );
}

function App() {
  const editorRef = useRef<Editor | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Sync store via Cloudflare Durable Objects
  const store = useSync({
    uri: `${SYNC_URL}/api/connect/${ROOM_ID}`,
    assets: multiplayerAssetStore,
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
            // Server-emitted ids may be pre-prefixed ("shape:img-..."); only
            // run them through createShapeId when the prefix is missing.
            const rawId = typeof s.id === "string" ? s.id : undefined;
            const shapeId = rawId
              ? rawId.startsWith("shape:")
                ? (rawId as TLShapeId)
                : createShapeId(rawId)
              : createShapeId();

            // Special case: image shapes must go through the asset system so
            // they round-trip through @tldraw/sync (same pattern as the
            // canvas-UI feature).
            if (s.type === "image") {
              const props = (s.props as Record<string, unknown>) ?? {};
              const url = typeof props.url === "string" ? props.url : undefined;
              if (!url) return;
              const w =
                typeof props.w === "number"
                  ? props.w
                  : GENERATED_IMAGE_CANVAS;
              const h =
                typeof props.h === "number"
                  ? props.h
                  : GENERATED_IMAGE_CANVAS;
              const nativeW =
                typeof props.nativeW === "number"
                  ? props.nativeW
                  : GENERATED_IMAGE_NATIVE;
              const nativeH =
                typeof props.nativeH === "number"
                  ? props.nativeH
                  : GENERATED_IMAGE_NATIVE;

              const assetId = AssetRecordType.createId();
              editor.createAssets([
                {
                  id: assetId,
                  type: "image",
                  typeName: "asset",
                  meta: {},
                  props: {
                    name: "generated.png",
                    src: url,
                    w: nativeW,
                    h: nativeH,
                    mimeType: "image/png",
                    isAnimated: false,
                  },
                },
              ]);
              editor.createShape({
                id: shapeId,
                type: "image",
                x: (s.x as number) ?? 0,
                y: (s.y as number) ?? 0,
                props: { assetId, w, h },
              });
              return;
            }

            editor.createShape({
              id: shapeId,
              type: ((s.type as string) ?? "geo") as "geo",
              x: (s.x as number) ?? 0,
              y: (s.y as number) ?? 0,
              props: (s.props as Record<string, unknown>) ?? {},
            } as any);
          }

          // Server wants the frontend to rasterize a selection and POST the
          // resulting data URL back, correlated by requestId.
          if (
            data.type === "canvas:rasterize_request" &&
            typeof data.requestId === "string" &&
            Array.isArray(data.shapeIds)
          ) {
            void rasterizeAndRespond(
              editor,
              data.requestId as string,
              data.shapeIds as string[],
            );
          }

          // Agent updates a shape's props
          if (data.type === "canvas:update_shape") {
            const shapes = editor.getCurrentPageShapes();
            const target =
              shapes.find((sh) => sh.id === data.shapeId) ??
              shapes.find((sh) => sh.id.endsWith(data.shapeId));
            if (target) {
              try {
                editor.updateShape({
                  id: target.id,
                  type: target.type,
                  props: data.props,
                });
              } catch (err) {
                console.error("canvas:update_shape failed", err);
              }
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
    // Expose the editor on window for manual + agent-browser inspection.
    (window as unknown as { editor?: Editor }).editor = editor;
    editor.updateInstanceState({ isGridMode: true, isPenMode: false });
    editor.setCurrentTool("draw");
    editor.setStyleForNextShapes(DefaultHorizontalAlignStyle, "middle");

    editor.registerExternalAssetHandler("url", getBookmarkPreview);

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

  const [imageFormOpen, setImageFormOpen] = useState(false);
  const openImageForm = useCallback(() => setImageFormOpen(true), []);
  const closeImageForm = useCallback(() => setImageFormOpen(false), []);

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
          <ToolDock
            onClear={handleClear}
            onSnapshot={handleSnapshot}
            onImageClick={openImageForm}
          />
          <CanvasImageTool
            formOpen={imageFormOpen}
            onRequestOpen={openImageForm}
            onClose={closeImageForm}
          />
        </Tldraw>
      </div>
      <MessageInput onSend={handleSendMessage} />
    </div>
  );
}

export default App;
