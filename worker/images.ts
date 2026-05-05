import { error, type IRequest } from "itty-router";
import Replicate from "replicate";
import { uniqueId } from "./utils";

// Server-enforced gpt-image-2 contract on Replicate.
// Any client attempt to override any of these (or the model slug) is silently discarded.
const MODEL = "openai/gpt-image-2" as const;
const QUALITY = "low" as const;
const ASPECT_RATIO = "1:1" as const;
const OUTPUT_FORMAT = "png" as const;
const NUMBER_OF_IMAGES = 1 as const;
const MAX_INPUT_IMAGES = 3;
const MAX_INPUT_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_INPUT_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 12 * 1024 * 1024;
const ACCEPTED_INPUT_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

interface ReplicateInput {
  prompt: string;
  quality: typeof QUALITY;
  aspect_ratio: typeof ASPECT_RATIO;
  output_format: typeof OUTPUT_FORMAT;
  number_of_images: typeof NUMBER_OF_IMAGES;
  input_images?: string[];
}

/**
 * Minimal surface of the Replicate client we actually use. Defined here so
 * tests can inject a fake via `__setReplicateClientFactory` without pulling
 * the full `Replicate` type in.
 */
interface ReplicateLike {
  run(
    model: `${string}/${string}` | `${string}/${string}:${string}`,
    options: { input: ReplicateInput },
  ): Promise<unknown>;
}

type ClientFactory = (apiToken: string) => ReplicateLike;
type Fetcher = (url: string | URL) => Promise<Response>;

const defaultClientFactory: ClientFactory = (auth) =>
  new Replicate({ auth }) as unknown as ReplicateLike;

const defaultFetcher: Fetcher = (url) =>
  fetch(typeof url === "string" ? url : url.toString());

let clientFactory: ClientFactory = defaultClientFactory;
let outputFetcher: Fetcher = defaultFetcher;

/** Test-only: override the Replicate client factory for module-boundary mocking. */
export function __setReplicateClientFactory(factory: ClientFactory) {
  clientFactory = factory;
}

/** Test-only: restore the real Replicate client factory. */
export function __resetReplicateClientFactory() {
  clientFactory = defaultClientFactory;
}

/** Test-only: override the fetcher used to download the Replicate output URI. */
export function __setReplicateOutputFetcher(fetcher: Fetcher) {
  outputFetcher = fetcher;
}

/** Test-only: restore the real output fetcher. */
export function __resetReplicateOutputFetcher() {
  outputFetcher = defaultFetcher;
}

/**
 * POST /api/images/generate
 *
 * - `application/json` body `{ prompt }`
 * - `multipart/form-data` with `prompt` + `image` file(s) — reference images
 *   are converted to `data:image/png;base64,...` URLs and passed in
 *   `input.input_images`.
 *
 * Both paths are a single Replicate call:
 *   replicate.run("openai/gpt-image-2", { input })
 *
 * Server pins the model slug plus `quality`/`aspect_ratio`/`output_format`/
 * `number_of_images`. Client overrides for any of those (or `model`) are
 * silently discarded. `openai_api_key`, `user_id`, `background`, `moderation`,
 * and `output_compression` are NEVER forwarded — Replicate's defaults apply.
 *
 * The worker fetches the returned Replicate output URI, persists the PNG
 * bytes to R2 under `uploads/<id>`, and responds with
 * `{ url: "/api/uploads/<id>" }` (relative — never a Replicate URL).
 */
export async function handleImageGeneration(
  request: IRequest,
  env: CloudflareBindings,
) {
  const contentType = request.headers.get("content-type") ?? "";
  const isMultipart = contentType
    .toLowerCase()
    .startsWith("multipart/form-data");

  let prompt: string | undefined;
  let images: File[] = [];

  if (isMultipart) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return error(400, "prompt is required (invalid multipart body)");
    }
    const rawPrompt = form.get("prompt");
    if (typeof rawPrompt === "string") prompt = rawPrompt;
    images = form
      .getAll("image")
      .filter((entry): entry is File => entry instanceof File);
    const validationError = validateInputImages(images);
    if (validationError) return validationError;
  } else {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return error(400, "prompt is required (invalid JSON body)");
    }
    if (body && typeof body === "object") {
      const rawPrompt = (body as Record<string, unknown>).prompt;
      if (typeof rawPrompt === "string") prompt = rawPrompt;
    }
  }

  if (!prompt || prompt.trim() === "") {
    return error(400, "prompt is required");
  }

  const apiToken = env.REPLICATE_API_TOKEN;
  if (!apiToken) {
    return error(500, "REPLICATE_API_TOKEN not configured");
  }

  const input: ReplicateInput = {
    prompt,
    quality: QUALITY,
    aspect_ratio: ASPECT_RATIO,
    output_format: OUTPUT_FORMAT,
    number_of_images: NUMBER_OF_IMAGES,
  };

  if (images.length > 0) {
    const inputImages: string[] = [];
    for (const file of images) {
      const buf = await file.arrayBuffer();
      const b64 = bytesToBase64(new Uint8Array(buf));
      inputImages.push(`${file.type};base64,${b64}`.replace(/^/, "data:"));
    }
    input.input_images = inputImages;
  }

  const client = clientFactory(apiToken);

  let output: unknown;
  try {
    output = await client.run(MODEL, { input });
  } catch (err) {
    const { status, message } = extractUpstreamError(err);
    return jsonResponse({ error: { status, message } }, 502);
  }

  const outputUri = resolveFirstOutputUri(output);
  if (!outputUri) {
    return jsonResponse(
      { error: { status: 502, message: "Replicate returned no output URIs" } },
      502,
    );
  }

  let bytes: Uint8Array;
  try {
    const res = await outputFetcher(outputUri);
    if (!res.ok) {
      return jsonResponse(
        {
          error: {
            status: res.status,
            message: `Failed to fetch Replicate output (status ${res.status})`,
          },
        },
        502,
      );
    }
    const contentLength = parseContentLength(res.headers.get("content-length"));
    if (contentLength !== null && contentLength > MAX_OUTPUT_BYTES) {
      return error(413, "generated image output is too large");
    }
    bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_OUTPUT_BYTES) {
      return error(413, "generated image output is too large");
    }
  } catch (err) {
    const { status, message } = extractUpstreamError(err);
    return jsonResponse({ error: { status, message } }, 502);
  }

  const id = uniqueId();
  await env.TLDRAW_BUCKET.put(`uploads/${id}`, bytes, {
    httpMetadata: { contentType: "image/png" },
  });

  return jsonResponse({ url: `/api/uploads/${id}` }, 200);
}

function validateInputImages(images: File[]): Response | null {
  if (images.length > MAX_INPUT_IMAGES) {
    return error(413, `too many image inputs (max ${MAX_INPUT_IMAGES})`);
  }

  let total = 0;
  for (const file of images) {
    if (!ACCEPTED_INPUT_IMAGE_TYPES.has(file.type)) {
      return error(415, `unsupported image type: ${file.type || "unknown"}`);
    }
    if (file.size > MAX_INPUT_IMAGE_BYTES) {
      return error(413, "image input is too large");
    }
    total += file.size;
  }
  if (total > MAX_TOTAL_INPUT_IMAGE_BYTES) {
    return error(413, "total image input size is too large");
  }
  return null;
}

function parseContentLength(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  // btoa works on binary strings; chunk to avoid spreading megabytes of args.
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, bytes.length);
    binary += String.fromCharCode(...bytes.subarray(i, end));
  }
  return btoa(binary);
}

function resolveFirstOutputUri(output: unknown): string | null {
  if (Array.isArray(output)) {
    if (output.length === 0) return null;
    return resolveUri(output[0]);
  }
  return resolveUri(output);
}

function resolveUri(item: unknown): string | null {
  if (item == null) return null;
  if (typeof item === "string") return item;
  if (item instanceof URL) return item.toString();
  if (typeof item === "object") {
    const maybe = item as { url?: unknown };
    if (typeof maybe.url === "function") {
      try {
        const result = (maybe.url as () => unknown)();
        if (typeof result === "string") return result;
        if (result instanceof URL) return result.toString();
        if (result && typeof result === "object") return String(result);
      } catch {
        return null;
      }
    } else if (typeof maybe.url === "string") {
      return maybe.url;
    }
  }
  return null;
}

function extractUpstreamError(err: unknown): {
  status: number;
  message: string;
} {
  if (err && typeof err === "object") {
    const maybe = err as {
      status?: unknown;
      message?: unknown;
      response?: { status?: unknown };
      error?: { message?: unknown };
    };
    let status = 500;
    if (typeof maybe.status === "number") {
      status = maybe.status;
    } else if (
      maybe.response &&
      typeof maybe.response === "object" &&
      typeof maybe.response.status === "number"
    ) {
      status = maybe.response.status;
    }
    let message: string | undefined;
    if (
      maybe.error &&
      typeof maybe.error === "object" &&
      typeof maybe.error.message === "string"
    ) {
      message = maybe.error.message;
    } else if (typeof maybe.message === "string") {
      message = maybe.message;
    }
    return { status, message: message || "Replicate request failed" };
  }
  return { status: 500, message: String(err) };
}
