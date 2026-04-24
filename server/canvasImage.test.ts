import { beforeEach, describe, expect, test } from "bun:test";
import { createCanvasImageHandlers } from "./canvasImage";
import type { WsMessage } from "./ws";

// A tiny but valid 1x1 PNG (red pixel) – base64-encoded.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAWk1v8QAAAABJRU5ErkJggg==";
const TINY_PNG_DATAURL = `data:image/png;base64,${TINY_PNG_B64}`;

function decodeB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

interface TestHarness {
  broadcasts: WsMessage[];
  workerCalls: Array<{
    method: string;
    contentType: string;
    body: string | FormData;
    bodyBytes?: Uint8Array;
  }>;
  handlers: ReturnType<typeof createCanvasImageHandlers>;
}

function makeHarness(
  opts: {
    workerResponse?: () =>
      | Response
      | Promise<Response>
      | Error
      | Promise<Error>;
    rasterizeTimeoutMs?: number;
    idSequence?: string[];
  } = {},
): TestHarness {
  const broadcasts: WsMessage[] = [];
  const workerCalls: TestHarness["workerCalls"] = [];
  const idSequence = opts.idSequence ? [...opts.idSequence] : null;
  let idCounter = 0;

  const handlers = createCanvasImageHandlers({
    broadcast: (msg) => {
      broadcasts.push(msg);
    },
    fetchWorker: async (req) => {
      const contentType = req.headers.get("content-type") ?? "";
      const entry: TestHarness["workerCalls"][number] = {
        method: req.method,
        contentType,
        body: "",
      };
      if (contentType.toLowerCase().startsWith("multipart/form-data")) {
        const form = await req.formData();
        entry.body = form;
        const image = form.get("image");
        if (image instanceof File) {
          const buf = new Uint8Array(await image.arrayBuffer());
          entry.bodyBytes = buf;
        }
      } else {
        entry.body = await req.text();
      }
      workerCalls.push(entry);
      const r = opts.workerResponse?.();
      if (r instanceof Error) throw r;
      if (r instanceof Promise) {
        const resolved = await r;
        if (resolved instanceof Error) throw resolved;
        return resolved;
      }
      if (r) return r;
      return new Response(
        JSON.stringify({ url: "/api/uploads/fake-upload-1" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    },
    rasterizeTimeoutMs: opts.rasterizeTimeoutMs ?? 10_000,
    newId: () => {
      if (idSequence && idSequence.length > 0) return idSequence.shift()!;
      idCounter += 1;
      return `id-${idCounter}`;
    },
  });

  return { broadcasts, workerCalls, handlers };
}

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/canvas/generate_image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function rasterizeReq(body: unknown) {
  return new Request("http://localhost/api/canvas/rasterize_response", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/canvas/generate_image (no referenceShapeIds)", () => {
  let h: TestHarness;
  beforeEach(() => {
    h = makeHarness();
  });

  test("with prompt only returns 200 + { url, shapeId } and broadcasts canvas:create_shape", async () => {
    const res = await h.handlers.handleGenerateImage(jsonReq({ prompt: "x" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { url: string; shapeId: string };
    expect(body.url).toBe("/api/uploads/fake-upload-1");
    expect(typeof body.shapeId).toBe("string");
    expect(body.shapeId.startsWith("shape:img-")).toBe(true);

    // No rasterize broadcast happens on pure-prompt path.
    const rasterizes = h.broadcasts.filter(
      (m) => m.type === "canvas:rasterize_request",
    );
    expect(rasterizes).toHaveLength(0);

    // A canvas:create_shape broadcast is emitted with type=image and the same id.
    const creates = h.broadcasts.filter(
      (m) => m.type === "canvas:create_shape",
    );
    expect(creates).toHaveLength(1);
    const shape = (creates[0] as { shape: Record<string, unknown> }).shape;
    expect(shape.type).toBe("image");
    expect(shape.id).toBe(body.shapeId);
    const props = shape.props as Record<string, unknown>;
    expect(props.url).toBe("/api/uploads/fake-upload-1");
  });

  test("missing prompt returns 400", async () => {
    const res = await h.handlers.handleGenerateImage(jsonReq({}));
    expect(res.status).toBe(400);
    expect(h.workerCalls).toHaveLength(0);
  });

  test("empty prompt returns 400", async () => {
    const res = await h.handlers.handleGenerateImage(jsonReq({ prompt: "" }));
    expect(res.status).toBe(400);
    expect(h.workerCalls).toHaveLength(0);
  });

  test("whitespace-only prompt returns 400", async () => {
    const res = await h.handlers.handleGenerateImage(
      jsonReq({ prompt: "   " }),
    );
    expect(res.status).toBe(400);
    expect(h.workerCalls).toHaveLength(0);
  });

  test("invalid JSON body returns 400", async () => {
    const req = new Request("http://localhost/api/canvas/generate_image", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    const res = await h.handlers.handleGenerateImage(req);
    expect(res.status).toBe(400);
  });

  test("uses JSON content-type when calling worker (no reference images)", async () => {
    await h.handlers.handleGenerateImage(jsonReq({ prompt: "hello" }));
    expect(h.workerCalls).toHaveLength(1);
    expect(h.workerCalls[0].contentType.toLowerCase()).toContain(
      "application/json",
    );
    expect(typeof h.workerCalls[0].body).toBe("string");
    const body = JSON.parse(h.workerCalls[0].body as string) as {
      prompt: string;
    };
    expect(body.prompt).toBe("hello");
  });

  test("respects x/y in canvas:create_shape payload", async () => {
    const res = await h.handlers.handleGenerateImage(
      jsonReq({ prompt: "p", x: 250, y: 300 }),
    );
    expect(res.status).toBe(200);
    const creates = h.broadcasts.filter(
      (m) => m.type === "canvas:create_shape",
    );
    const shape = (creates[0] as { shape: Record<string, unknown> }).shape;
    expect(shape.x).toBe(250);
    expect(shape.y).toBe(300);
  });
});

describe("POST /api/canvas/generate_image (with referenceShapeIds)", () => {
  test("emits canvas:rasterize_request BEFORE calling worker, matches by requestId", async () => {
    const h = makeHarness({
      idSequence: ["REQ1", "SHAPE1"],
    });

    const p = h.handlers.handleGenerateImage(
      jsonReq({ prompt: "redraw", referenceShapeIds: ["shape:a", "shape:b"] }),
    );

    // Spin until broadcast happens (it happens synchronously inside the
    // promise constructor below but we still give the microtask a cycle).
    await Promise.resolve();
    await Promise.resolve();

    const rasterizes = h.broadcasts.filter(
      (m) => m.type === "canvas:rasterize_request",
    );
    expect(rasterizes).toHaveLength(1);
    const rr = rasterizes[0] as {
      requestId: string;
      shapeIds: string[];
    };
    expect(rr.requestId).toBe("REQ1");
    expect(rr.shapeIds).toEqual(["shape:a", "shape:b"]);

    // Worker should NOT have been called yet.
    expect(h.workerCalls).toHaveLength(0);

    // Now simulate the frontend responding.
    const resp = await h.handlers.handleRasterizeResponse(
      rasterizeReq({ requestId: "REQ1", dataUrl: TINY_PNG_DATAURL }),
    );
    expect(resp.status).toBe(200);

    const finalRes = await p;
    expect(finalRes.status).toBe(200);
    const body = (await finalRes.json()) as { url: string; shapeId: string };
    expect(body.url).toBe("/api/uploads/fake-upload-1");
    expect(body.shapeId).toBe("shape:img-SHAPE1");

    // Worker was called as multipart with the PNG bytes.
    expect(h.workerCalls).toHaveLength(1);
    const call = h.workerCalls[0];
    expect(call.contentType.toLowerCase()).toContain("multipart/form-data");
    const expected = decodeB64(TINY_PNG_B64);
    expect(call.bodyBytes).toBeDefined();
    expect(call.bodyBytes!.length).toBe(expected.length);
    for (let i = 0; i < expected.length; i++) {
      expect(call.bodyBytes![i]).toBe(expected[i]);
    }
  });

  test("concurrent requests get distinct requestIds and do not cross-wire", async () => {
    const h = makeHarness({
      idSequence: ["REQ1", "REQ2", "SHAPE1", "SHAPE2"],
      workerResponse: () =>
        new Response(
          JSON.stringify({ url: `/api/uploads/u-${Math.random()}` }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    const p1 = h.handlers.handleGenerateImage(
      jsonReq({ prompt: "a", referenceShapeIds: ["shape:x"] }),
    );
    const p2 = h.handlers.handleGenerateImage(
      jsonReq({ prompt: "b", referenceShapeIds: ["shape:y"] }),
    );
    await Promise.resolve();
    await Promise.resolve();

    const rasterizes = h.broadcasts.filter(
      (m) => m.type === "canvas:rasterize_request",
    ) as Array<{ requestId: string; shapeIds: string[] }>;
    expect(rasterizes).toHaveLength(2);
    expect(rasterizes[0].requestId).toBe("REQ1");
    expect(rasterizes[1].requestId).toBe("REQ2");
    expect(rasterizes[0].shapeIds).toEqual(["shape:x"]);
    expect(rasterizes[1].shapeIds).toEqual(["shape:y"]);
    expect(rasterizes[0].requestId).not.toBe(rasterizes[1].requestId);

    // Reply out-of-order: second first, then first.
    const r2 = await h.handlers.handleRasterizeResponse(
      rasterizeReq({ requestId: "REQ2", dataUrl: TINY_PNG_DATAURL }),
    );
    expect(r2.status).toBe(200);
    const r1 = await h.handlers.handleRasterizeResponse(
      rasterizeReq({ requestId: "REQ1", dataUrl: TINY_PNG_DATAURL }),
    );
    expect(r1.status).toBe(200);

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
  });

  test("rasterize timeout cleans up the pending map and returns 504", async () => {
    const h = makeHarness({
      rasterizeTimeoutMs: 50,
      idSequence: ["REQ-timeout"],
    });

    const res = await h.handlers.handleGenerateImage(
      jsonReq({ prompt: "x", referenceShapeIds: ["shape:z"] }),
    );
    expect(res.status).toBe(504);
    // Pending map empty after timeout.
    expect(h.handlers._pendingRequestCount()).toBe(0);
    // Worker never called.
    expect(h.workerCalls).toHaveLength(0);

    // Late response for the timed-out requestId yields 404.
    const late = await h.handlers.handleRasterizeResponse(
      rasterizeReq({ requestId: "REQ-timeout", dataUrl: TINY_PNG_DATAURL }),
    );
    expect(late.status).toBe(404);
  });

  test("empty referenceShapeIds array behaves like no references (pure prompt)", async () => {
    const h = makeHarness();
    const res = await h.handlers.handleGenerateImage(
      jsonReq({ prompt: "p", referenceShapeIds: [] }),
    );
    expect(res.status).toBe(200);
    const rasterizes = h.broadcasts.filter(
      (m) => m.type === "canvas:rasterize_request",
    );
    expect(rasterizes).toHaveLength(0);
    expect(h.workerCalls[0].contentType.toLowerCase()).toContain(
      "application/json",
    );
  });
});

describe("POST /api/canvas/rasterize_response", () => {
  test("unknown requestId returns 404", async () => {
    const h = makeHarness();
    const res = await h.handlers.handleRasterizeResponse(
      rasterizeReq({ requestId: "does-not-exist", dataUrl: TINY_PNG_DATAURL }),
    );
    expect(res.status).toBe(404);
  });

  test("unknown requestId with garbage base64 dataUrl still returns 404 (404 wins over bad payload)", async () => {
    const h = makeHarness();
    const res = await h.handlers.handleRasterizeResponse(
      rasterizeReq({
        requestId: "does-not-exist",
        dataUrl: "data:image/png;base64,not-real-base64!!!",
      }),
    );
    expect(res.status).toBe(404);
  });

  test("unknown requestId with empty base64 dataUrl still returns 404 (404 wins over empty payload)", async () => {
    const h = makeHarness();
    const res = await h.handlers.handleRasterizeResponse(
      rasterizeReq({
        requestId: "does-not-exist",
        dataUrl: "data:image/png;base64,",
      }),
    );
    expect(res.status).toBe(404);
  });

  test("unknown requestId with missing dataUrl still returns 404 (404 wins over missing dataUrl)", async () => {
    const h = makeHarness();
    const res = await h.handlers.handleRasterizeResponse(
      rasterizeReq({ requestId: "does-not-exist" }),
    );
    expect(res.status).toBe(404);
  });

  test("unknown requestId with non-data-URL still returns 404 (404 wins over bad prefix)", async () => {
    const h = makeHarness();
    const res = await h.handlers.handleRasterizeResponse(
      rasterizeReq({
        requestId: "does-not-exist",
        dataUrl: "not a data url",
      }),
    );
    expect(res.status).toBe(404);
  });

  test("missing requestId returns 400", async () => {
    const h = makeHarness();
    const res = await h.handlers.handleRasterizeResponse(
      rasterizeReq({ dataUrl: TINY_PNG_DATAURL }),
    );
    expect(res.status).toBe(400);
  });

  test("missing dataUrl returns 400 (for a known requestId)", async () => {
    const h = makeHarness({ idSequence: ["REQ1"] });
    const p = h.handlers.handleGenerateImage(
      jsonReq({ prompt: "x", referenceShapeIds: ["shape:a"] }),
    );
    await Promise.resolve();
    await Promise.resolve();

    const res = await h.handlers.handleRasterizeResponse(
      rasterizeReq({ requestId: "REQ1" }),
    );
    expect(res.status).toBe(400);

    // Clean up the pending request so we don't leak a timer into the next test.
    await h.handlers.handleRasterizeResponse(
      rasterizeReq({ requestId: "REQ1", dataUrl: TINY_PNG_DATAURL }),
    );
    await p;
  });

  test("non-data-URL rejected with 400", async () => {
    const h = makeHarness({ idSequence: ["REQ1"] });
    const p = h.handlers.handleGenerateImage(
      jsonReq({ prompt: "x", referenceShapeIds: ["shape:a"] }),
    );
    await Promise.resolve();
    await Promise.resolve();

    const res = await h.handlers.handleRasterizeResponse(
      rasterizeReq({ requestId: "REQ1", dataUrl: "not a data url" }),
    );
    expect(res.status).toBe(400);

    // Release the pending request to avoid leaks.
    await h.handlers.handleRasterizeResponse(
      rasterizeReq({ requestId: "REQ1", dataUrl: TINY_PNG_DATAURL }),
    );
    await p;
  });

  test("garbage base64 body after a valid prefix returns 400 mentioning 'dataUrl' and 'invalid base64', leaves pending request intact", async () => {
    const h = makeHarness({
      idSequence: ["REQ1", "SHAPE1"],
      rasterizeTimeoutMs: 5_000,
    });
    const p = h.handlers.handleGenerateImage(
      jsonReq({ prompt: "x", referenceShapeIds: ["shape:a"] }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(h.handlers._pendingRequestCount()).toBe(1);

    const res = await h.handlers.handleRasterizeResponse(
      rasterizeReq({
        requestId: "REQ1",
        dataUrl: "data:image/png;base64,not-real-base64!!!",
      }),
    );
    expect(res.status).toBe(400);
    const errBody = await res.text();
    expect(errBody.toLowerCase()).toContain("dataurl");
    expect(errBody.toLowerCase()).toContain("invalid base64");

    // Pending request NOT resolved — it is still awaiting a valid rasterize.
    expect(h.handlers._pendingRequestCount()).toBe(1);
    // Worker never called because rasterize never resolved.
    expect(h.workerCalls).toHaveLength(0);

    // A retry with a valid dataUrl still resolves the original pending request.
    const retry = await h.handlers.handleRasterizeResponse(
      rasterizeReq({ requestId: "REQ1", dataUrl: TINY_PNG_DATAURL }),
    );
    expect(retry.status).toBe(200);
    const finalRes = await p;
    expect(finalRes.status).toBe(200);
    expect(h.workerCalls).toHaveLength(1);
  });

  test("zero-byte base64 body (data:image/png;base64,) returns 400 mentioning 'dataUrl', leaves pending request intact", async () => {
    const h = makeHarness({
      idSequence: ["REQ1", "SHAPE1"],
      rasterizeTimeoutMs: 5_000,
    });
    const p = h.handlers.handleGenerateImage(
      jsonReq({ prompt: "x", referenceShapeIds: ["shape:a"] }),
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(h.handlers._pendingRequestCount()).toBe(1);

    const res = await h.handlers.handleRasterizeResponse(
      rasterizeReq({
        requestId: "REQ1",
        dataUrl: "data:image/png;base64,",
      }),
    );
    expect(res.status).toBe(400);
    const errBody = await res.text();
    expect(errBody.toLowerCase()).toContain("dataurl");

    // Pending request is still there.
    expect(h.handlers._pendingRequestCount()).toBe(1);
    expect(h.workerCalls).toHaveLength(0);

    // Release the pending request with a valid dataUrl so we don't leak the
    // generateImage promise or timer into the next test.
    await h.handlers.handleRasterizeResponse(
      rasterizeReq({ requestId: "REQ1", dataUrl: TINY_PNG_DATAURL }),
    );
    await p;
  });

  test("invalid JSON body returns 400", async () => {
    const h = makeHarness();
    const req = new Request("http://localhost/api/canvas/rasterize_response", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "garbage",
    });
    const res = await h.handlers.handleRasterizeResponse(req);
    expect(res.status).toBe(400);
  });
});

describe("worker error handling", () => {
  test("worker 5xx response is surfaced to the caller (no canvas:create_shape)", async () => {
    const h = makeHarness({
      workerResponse: () =>
        new Response(
          JSON.stringify({
            error: { status: 502, message: "openai verification required" },
          }),
          { status: 502, headers: { "content-type": "application/json" } },
        ),
    });

    const res = await h.handlers.handleGenerateImage(jsonReq({ prompt: "p" }));
    expect(res.status).toBeGreaterThanOrEqual(500);

    // No canvas:create_shape on failure.
    const creates = h.broadcasts.filter(
      (m) => m.type === "canvas:create_shape",
    );
    expect(creates).toHaveLength(0);
  });

  test("worker fetch throws is surfaced as 502 with no ghost shape", async () => {
    const h = makeHarness({
      workerResponse: () => new Error("network down"),
    });

    const res = await h.handlers.handleGenerateImage(jsonReq({ prompt: "p" }));
    expect(res.status).toBeGreaterThanOrEqual(500);
    const creates = h.broadcasts.filter(
      (m) => m.type === "canvas:create_shape",
    );
    expect(creates).toHaveLength(0);
  });
});
