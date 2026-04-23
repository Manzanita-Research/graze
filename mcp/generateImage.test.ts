import { describe, expect, test } from "bun:test";
import {
  GENERATE_IMAGE_INSTRUCTIONS,
  generateImageInputSchema,
  runGenerateImage,
} from "./generateImage";
import * as z from "zod/v4";

/**
 * Build a zod object from the raw shape used by the tool so we can exercise
 * the schema directly (the MCP SDK does the same internally).
 */
const schemaObject = z.object(generateImageInputSchema);

interface StubFetchCall {
  url: string;
  init: RequestInit;
  bodyJson: unknown;
}

interface StubFetchOptions {
  response?: () => Response | Promise<Response>;
  throwErr?: Error;
}

function stubFetch(opts: StubFetchOptions = {}) {
  const calls: StubFetchCall[] = [];
  const impl: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input as URL | Request).toString();
    const bodyStr = typeof init?.body === "string" ? init.body : "";
    let bodyJson: unknown;
    try {
      bodyJson = bodyStr ? JSON.parse(bodyStr) : undefined;
    } catch {
      bodyJson = bodyStr;
    }
    calls.push({ url, init: init ?? {}, bodyJson });
    if (opts.throwErr) throw opts.throwErr;
    const r = opts.response?.();
    if (r instanceof Promise) return r;
    if (r) return r;
    return new Response(
      JSON.stringify({ url: "/api/uploads/fake-1", shapeId: "shape:img-abc" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
  return { impl, calls };
}

describe("generateImageInputSchema", () => {
  test("requires prompt to be a string", () => {
    const r = schemaObject.safeParse({});
    expect(r.success).toBe(false);
  });

  test("rejects non-string prompt", () => {
    const r = schemaObject.safeParse({ prompt: 123 });
    expect(r.success).toBe(false);
  });

  test("rejects empty prompt", () => {
    const r = schemaObject.safeParse({ prompt: "" });
    expect(r.success).toBe(false);
  });

  test("accepts prompt only", () => {
    const r = schemaObject.safeParse({ prompt: "hi" });
    expect(r.success).toBe(true);
  });

  test("accepts referenceShapeIds as array of strings", () => {
    const r = schemaObject.safeParse({
      prompt: "hi",
      referenceShapeIds: ["shape:a", "shape:b"],
    });
    expect(r.success).toBe(true);
  });

  test("rejects referenceShapeIds with non-string entries", () => {
    const r = schemaObject.safeParse({
      prompt: "hi",
      referenceShapeIds: [1, 2],
    });
    expect(r.success).toBe(false);
  });

  test("accepts x/y as numbers", () => {
    const r = schemaObject.safeParse({ prompt: "hi", x: 10, y: 20 });
    expect(r.success).toBe(true);
  });

  test("rejects x as a non-number", () => {
    const r = schemaObject.safeParse({ prompt: "hi", x: "ten" });
    expect(r.success).toBe(false);
  });
});

describe("runGenerateImage — happy path", () => {
  test("pure-prompt posts JSON body to /api/canvas/generate_image and returns text payload with { url, shapeId }", async () => {
    const { impl, calls } = stubFetch({
      response: () =>
        new Response(
          JSON.stringify({
            url: "/api/uploads/abc123",
            shapeId: "shape:img-xyz",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    const result = await runGenerateImage(
      { prompt: "a red square" },
      { baseUrl: "http://bun.local", fetch: impl },
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    const parsed = JSON.parse(result.content[0].text) as {
      url: string;
      shapeId: string;
    };
    expect(parsed.url).toBe("/api/uploads/abc123");
    expect(parsed.shapeId).toBe("shape:img-xyz");

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://bun.local/api/canvas/generate_image");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    const ct = headers["Content-Type"] ?? headers["content-type"];
    expect(ct?.toLowerCase()).toContain("application/json");
    expect(calls[0].bodyJson).toEqual({ prompt: "a red square" });
  });

  test("referenceShapeIds are forwarded verbatim in the POST body", async () => {
    const { impl, calls } = stubFetch();
    await runGenerateImage(
      { prompt: "redraw", referenceShapeIds: ["shape:a", "shape:b"] },
      { baseUrl: "http://bun.local", fetch: impl },
    );
    expect(calls[0].bodyJson).toEqual({
      prompt: "redraw",
      referenceShapeIds: ["shape:a", "shape:b"],
    });
  });

  test("x/y are forwarded in the POST body when provided", async () => {
    const { impl, calls } = stubFetch();
    await runGenerateImage(
      { prompt: "p", x: 50, y: 60 },
      { baseUrl: "http://bun.local", fetch: impl },
    );
    expect(calls[0].bodyJson).toEqual({ prompt: "p", x: 50, y: 60 });
  });

  test("omits optional fields when absent (no 'referenceShapeIds' / 'x' / 'y' keys)", async () => {
    const { impl, calls } = stubFetch();
    await runGenerateImage(
      { prompt: "p" },
      { baseUrl: "http://bun.local", fetch: impl },
    );
    const body = calls[0].bodyJson as Record<string, unknown>;
    expect(body).toEqual({ prompt: "p" });
    expect(Object.prototype.hasOwnProperty.call(body, "referenceShapeIds")).toBe(
      false,
    );
    expect(Object.prototype.hasOwnProperty.call(body, "x")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(body, "y")).toBe(false);
  });
});

describe("runGenerateImage — HTTP error surfacing", () => {
  test("upstream 502 with JSON error body surfaces status + reason in content[0].text (isError: true)", async () => {
    const { impl } = stubFetch({
      response: () =>
        new Response(
          JSON.stringify({
            error: {
              status: 502,
              message: "OpenAI upstream failure: moderation_blocked",
            },
          }),
          { status: 502, headers: { "content-type": "application/json" } },
        ),
    });
    const result = await runGenerateImage(
      { prompt: "x" },
      { baseUrl: "http://bun.local", fetch: impl },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].type).toBe("text");
    const text = result.content[0].text;
    expect(text).toContain("502");
    expect(text).toContain("moderation_blocked");
  });

  test("rasterize timeout (504 from server) propagates the verbatim timeout message", async () => {
    const { impl } = stubFetch({
      response: () =>
        new Response(
          JSON.stringify({
            error: {
              status: 504,
              message: "rasterize request r-1 timed out after 10000ms",
            },
          }),
          { status: 504, headers: { "content-type": "application/json" } },
        ),
    });
    const result = await runGenerateImage(
      { prompt: "x", referenceShapeIds: ["shape:z"] },
      { baseUrl: "http://bun.local", fetch: impl },
    );
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain("rasterize");
    expect(text.toLowerCase()).toContain("timed out");
    expect(text).toContain("504");
  });

  test("plain-text error body still includes upstream status", async () => {
    const { impl } = stubFetch({
      response: () =>
        new Response("server exploded", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
    });
    const result = await runGenerateImage(
      { prompt: "x" },
      { baseUrl: "http://bun.local", fetch: impl },
    );
    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    expect(text).toContain("500");
    expect(text).toContain("server exploded");
  });

  test("malformed success body returns error result", async () => {
    const { impl } = stubFetch({
      response: () =>
        new Response(JSON.stringify({ notWhatWeWant: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const result = await runGenerateImage(
      { prompt: "x" },
      { baseUrl: "http://bun.local", fetch: impl },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text.toLowerCase()).toContain("malformed");
  });
});

describe("runGenerateImage — network error surfacing", () => {
  test("fetch rejection mentions the Bun server URL (GRAZE_URL) in the error text", async () => {
    const err = new Error("connect ECONNREFUSED 127.0.0.1:3737");
    const { impl } = stubFetch({ throwErr: err });

    const start = Date.now();
    const result = await runGenerateImage(
      { prompt: "x" },
      { baseUrl: "http://localhost:3737", fetch: impl },
    );
    const elapsed = Date.now() - start;

    expect(result.isError).toBe(true);
    const text = result.content[0].text;
    // Must mention unreachable (or the URL / GRAZE_URL) for the agent.
    expect(text.toLowerCase()).toMatch(/unreachable|connect|refused/);
    expect(text).toContain("http://localhost:3737");
    // Way under the 5s deadline for an unreachable server.
    expect(elapsed).toBeLessThan(500);
  });
});

describe("GENERATE_IMAGE_INSTRUCTIONS", () => {
  test("documents the tool name and referenceShapeIds semantics", () => {
    expect(GENERATE_IMAGE_INSTRUCTIONS).toContain("generate_image");
    expect(GENERATE_IMAGE_INSTRUCTIONS).toContain("referenceShapeIds");
  });

  test("documents the structured response shape with both url and shapeId", () => {
    expect(GENERATE_IMAGE_INSTRUCTIONS).toContain("url");
    expect(GENERATE_IMAGE_INSTRUCTIONS).toContain("shapeId");
  });
});
