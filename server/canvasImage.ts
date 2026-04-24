/**
 * Agent-facing image generation endpoints for the Bun server.
 *
 * Flow:
 *   1. POST /api/canvas/generate_image { prompt, referenceShapeIds?, x?, y? }
 *   2. If referenceShapeIds present, broadcast a WS `canvas:rasterize_request`
 *      with a freshly-minted requestId and hold the request in a Map with a
 *      bounded timeout. The frontend listens for this and POSTs back to
 *      /api/canvas/rasterize_response.
 *   3. Once the reference PNG (if any) is in hand, call the Cloudflare worker's
 *      /api/images/generate endpoint (JSON for pure-prompt, multipart with the
 *      decoded PNG bytes for reference-edit).
 *   4. Broadcast a WS `canvas:create_shape` of type `image` carrying the
 *      returned URL so the frontend can register an asset and create the
 *      shape.
 *   5. Respond to the HTTP caller with { url, shapeId } matching the
 *      broadcast shape id.
 *
 * Deps are injected so the flow is testable without a real worker or socket.
 */

import type { WsMessage } from "./ws";

/** Native size of gpt-image-2 output (keeps in sync with `src/App.tsx`). */
const GENERATED_IMAGE_W = 1024;
const GENERATED_IMAGE_H = 1024;
/** Canvas display size chosen by the UI for generated images. */
const GENERATED_IMAGE_CANVAS = 384;

/** Default rasterize timeout. Matches the feature spec (~10s). */
const DEFAULT_RASTERIZE_TIMEOUT_MS = 10_000;

export interface CanvasImageDeps {
  broadcast: (message: WsMessage) => void;
  /**
   * Called with a Request targeted at the Cloudflare worker's
   * /api/images/generate endpoint. The returned Response is forwarded (for
   * non-2xx) or its body is read on success.
   */
  fetchWorker: (req: Request) => Promise<Response>;
  rasterizeTimeoutMs?: number;
  newId?: () => string;
}

interface PendingRasterize {
  resolve: (dataUrl: string) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

interface GenerateImageBody {
  prompt?: unknown;
  referenceShapeIds?: unknown;
  x?: unknown;
  y?: unknown;
}

interface RasterizeResponseBody {
  requestId?: unknown;
  dataUrl?: unknown;
}

export function createCanvasImageHandlers(deps: CanvasImageDeps) {
  const pending = new Map<string, PendingRasterize>();
  const timeoutMs = deps.rasterizeTimeoutMs ?? DEFAULT_RASTERIZE_TIMEOUT_MS;
  const newId = deps.newId ?? (() => crypto.randomUUID());

  async function handleGenerateImage(req: Request): Promise<Response> {
    let body: GenerateImageBody;
    try {
      body = (await req.json()) as GenerateImageBody;
    } catch {
      return jsonResponse({ error: "invalid JSON body" }, 400);
    }

    const prompt =
      typeof body.prompt === "string" ? body.prompt : undefined;
    if (!prompt || prompt.trim() === "") {
      return jsonResponse({ error: "prompt is required" }, 400);
    }

    const referenceShapeIds = Array.isArray(body.referenceShapeIds)
      ? body.referenceShapeIds.filter(
          (s): s is string => typeof s === "string" && s.length > 0,
        )
      : [];
    const x = typeof body.x === "number" ? body.x : 120;
    const y = typeof body.y === "number" ? body.y : 100;

    // Step 1: get reference PNG bytes if requested.
    let referencePng: Uint8Array | undefined;
    if (referenceShapeIds.length > 0) {
      const requestId = newId();
      try {
        const dataUrl = await awaitRasterize(
          pending,
          requestId,
          timeoutMs,
          () => {
            deps.broadcast({
              type: "canvas:rasterize_request",
              requestId,
              shapeIds: referenceShapeIds,
            });
          },
        );
        referencePng = decodeDataUrlToBytes(dataUrl);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "rasterize failed";
        return jsonResponse(
          { error: { status: 504, message } },
          504,
        );
      }
    }

    // Step 2: forward to the worker image endpoint.
    const workerReq = buildWorkerRequest(prompt, referencePng);

    let workerRes: Response;
    try {
      workerRes = await deps.fetchWorker(workerReq);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "worker unreachable";
      return jsonResponse({ error: { status: 502, message } }, 502);
    }

    if (!workerRes.ok) {
      // Pass the upstream error through to the caller as-is so the agent sees
      // the real reason (e.g. OpenAI org-verification).
      const passThroughBody = await workerRes.text();
      return new Response(passThroughBody, {
        status: workerRes.status,
        headers: {
          "content-type":
            workerRes.headers.get("content-type") ?? "application/json",
        },
      });
    }

    let workerBody: { url?: unknown };
    try {
      workerBody = (await workerRes.json()) as { url?: unknown };
    } catch {
      return jsonResponse(
        { error: { status: 502, message: "invalid worker response" } },
        502,
      );
    }
    const url = typeof workerBody.url === "string" ? workerBody.url : undefined;
    if (!url) {
      return jsonResponse(
        { error: { status: 502, message: "worker returned no url" } },
        502,
      );
    }

    // Step 3: broadcast canvas:create_shape so the frontend materialises a
    // real tldraw image shape (asset registration happens on the frontend).
    const shapeId = `shape:img-${newId()}`;
    deps.broadcast({
      type: "canvas:create_shape",
      shape: {
        id: shapeId,
        type: "image",
        x,
        y,
        props: {
          url,
          w: GENERATED_IMAGE_CANVAS,
          h: GENERATED_IMAGE_CANVAS,
          nativeW: GENERATED_IMAGE_W,
          nativeH: GENERATED_IMAGE_H,
        },
      },
    });

    return jsonResponse({ url, shapeId }, 200);
  }

  async function handleRasterizeResponse(req: Request): Promise<Response> {
    let body: RasterizeResponseBody;
    try {
      body = (await req.json()) as RasterizeResponseBody;
    } catch {
      return jsonResponse({ error: "invalid JSON body" }, 400);
    }

    const requestId =
      typeof body.requestId === "string" && body.requestId.length > 0
        ? body.requestId
        : undefined;
    if (!requestId) {
      return jsonResponse({ error: "requestId is required" }, 400);
    }
    const dataUrl =
      typeof body.dataUrl === "string" ? body.dataUrl : undefined;
    if (!dataUrl || !/^data:image\/[a-z0-9+.-]+;base64,/i.test(dataUrl)) {
      // Known-but-bad dataUrl is still a 400 even if the requestId exists.
      return jsonResponse({ error: "valid dataUrl is required" }, 400);
    }

    // The prefix is right, but the base64 payload may still be garbage or
    // empty. Without this check a well-prefixed but undecodable body would
    // resolve the pending request and make the downstream worker call fail
    // later as a confusing 5xx. Leave the pending request untouched so the
    // caller can retry with a valid rasterize or time out cleanly.
    const commaIdx = dataUrl.indexOf(",");
    const b64Payload = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : "";
    let decodedLength: number;
    try {
      decodedLength = atob(b64Payload).length;
    } catch {
      return jsonResponse(
        { error: "invalid base64 payload in dataUrl" },
        400,
      );
    }
    if (decodedLength === 0) {
      return jsonResponse(
        { error: "invalid base64 payload in dataUrl (empty)" },
        400,
      );
    }

    const entry = pending.get(requestId);
    if (!entry) {
      return jsonResponse({ error: "unknown requestId" }, 404);
    }
    clearTimeout(entry.timeout);
    pending.delete(requestId);
    entry.resolve(dataUrl);
    return jsonResponse({ ok: true }, 200);
  }

  /** Test helper: pending Map size. Intentionally underscored. */
  function _pendingRequestCount(): number {
    return pending.size;
  }

  return {
    handleGenerateImage,
    handleRasterizeResponse,
    _pendingRequestCount,
  };
}

function buildWorkerRequest(
  prompt: string,
  referencePng: Uint8Array | undefined,
): Request {
  const url = "http://worker.local/api/images/generate";
  if (referencePng) {
    const form = new FormData();
    form.append("prompt", prompt);
    form.append(
      "image",
      new File([referencePng], "reference.png", { type: "image/png" }),
    );
    return new Request(url, { method: "POST", body: form });
  }
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
}

function awaitRasterize(
  pending: Map<string, PendingRasterize>,
  requestId: string,
  timeoutMs: number,
  afterRegister: () => void,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (pending.delete(requestId)) {
        reject(
          new Error(
            `rasterize request ${requestId} timed out after ${timeoutMs}ms`,
          ),
        );
      }
    }, timeoutMs);
    pending.set(requestId, { resolve, reject, timeout });
    // Broadcast only AFTER the entry is in the Map so a synchronous rasterize
    // reply cannot race ahead of us.
    try {
      afterRegister();
    } catch (err) {
      clearTimeout(timeout);
      pending.delete(requestId);
      reject(err as Error);
    }
  });
}

function decodeDataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
