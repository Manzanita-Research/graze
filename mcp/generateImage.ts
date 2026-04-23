/**
 * MCP tool helper for `generate_image`.
 *
 * This module owns the zod input schema and the HTTP orchestration against the
 * Bun server's `/api/canvas/generate_image` endpoint. It is deliberately
 * side-effect-free on import so it can be exercised directly in unit tests.
 *
 * Invariant: the MCP tool ALWAYS goes through the Bun server (never the
 * Cloudflare worker directly) so the rasterize protocol and canvas broadcast
 * happen in a single place.
 */

import * as z from "zod/v4";

export const generateImageInputSchema = {
  prompt: z
    .string()
    .min(1)
    .describe("Text prompt describing the image to generate."),
  referenceShapeIds: z
    .optional(z.array(z.string()))
    .describe(
      "Optional tldraw shape ids to rasterize on the canvas and use as " +
        "a reference image for the generation. When provided, the server " +
        "asks the frontend to rasterize the shapes, then calls the worker " +
        "with the PNG bytes as a reference image.",
    ),
  x: z
    .optional(z.number())
    .describe("Optional x position (canvas pixels) for the new image shape."),
  y: z
    .optional(z.number())
    .describe("Optional y position (canvas pixels) for the new image shape."),
};

export interface GenerateImageInput {
  prompt: string;
  referenceShapeIds?: string[];
  x?: number;
  y?: number;
}

export interface GenerateImageContext {
  /** Base URL of the Graze Bun server (usually `$GRAZE_URL`). */
  baseUrl: string;
  /** Optional fetch override for testing. Defaults to global `fetch`. */
  fetch?: typeof fetch;
}

interface GenerateImageContent {
  type: "text";
  text: string;
}

export interface GenerateImageResult {
  content: GenerateImageContent[];
  isError?: true;
}

/**
 * Instructions fragment appended to the MCP server's top-level INSTRUCTIONS
 * so agents discover the tool and the response shape.
 */
export const GENERATE_IMAGE_INSTRUCTIONS = `**Image generation:**
- generate_image(prompt, referenceShapeIds?, x?, y?) — generate a new image on the Graze canvas using gpt-image-2. The \`prompt\` describes the desired image. If you pass \`referenceShapeIds\` (an array of existing tldraw shape ids), those shapes are rasterized on the canvas and forwarded to OpenAI as a visual reference for an edit-style generation. Optional \`x\`/\`y\` choose where the new image shape is placed (defaults to the server's default offset). The tool's \`content[0].text\` is JSON-parseable and contains \`{ "url": "/api/uploads/<id>", "shapeId": "<tldraw shape id>" }\` so you can link subsequent updates to the shape or embed the URL.`;

function buildBody(input: GenerateImageInput): Record<string, unknown> {
  const body: Record<string, unknown> = { prompt: input.prompt };
  if (input.referenceShapeIds !== undefined) {
    body.referenceShapeIds = input.referenceShapeIds;
  }
  if (input.x !== undefined) body.x = input.x;
  if (input.y !== undefined) body.y = input.y;
  return body;
}

function errorResult(text: string): GenerateImageResult {
  return { isError: true, content: [{ type: "text", text }] };
}

function extractUpstreamReason(rawBody: string): string {
  const trimmed = rawBody.trim();
  if (!trimmed) return "(empty response body)";
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      const err = obj.error as Record<string, unknown> | string | undefined;
      if (typeof err === "string" && err.length > 0) return err;
      if (err && typeof err === "object") {
        const message = err.message;
        if (typeof message === "string" && message.length > 0) return message;
      }
      if (typeof obj.message === "string" && obj.message.length > 0) {
        return obj.message as string;
      }
    }
  } catch {
    // fall through to raw text
  }
  return trimmed;
}

export async function runGenerateImage(
  input: GenerateImageInput,
  ctx: GenerateImageContext,
): Promise<GenerateImageResult> {
  const fetchImpl = ctx.fetch ?? fetch;
  const url = `${ctx.baseUrl}/api/canvas/generate_image`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildBody(input)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(
      `Graze Bun server unreachable at ${ctx.baseUrl} (GRAZE_URL): ${message}`,
    );
  }

  if (!res.ok) {
    let rawBody = "";
    try {
      rawBody = await res.text();
    } catch {
      rawBody = "";
    }
    const reason = extractUpstreamReason(rawBody);
    return errorResult(`Bun server error ${res.status}: ${reason}`);
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult(
      `Bun server returned a malformed (non-JSON) response: ${message}`,
    );
  }

  const obj =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  const urlField = obj.url;
  const shapeIdField = obj.shapeId;
  if (typeof urlField !== "string" || typeof shapeIdField !== "string") {
    return errorResult(
      `Bun server returned a malformed response: ${JSON.stringify(parsed)}`,
    );
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({ url: urlField, shapeId: shapeIdField }),
      },
    ],
  };
}
