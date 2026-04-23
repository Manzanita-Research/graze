import { error, type IRequest } from "itty-router";
import OpenAI from "openai";
import { uniqueId } from "./utils";

// Server-enforced gpt-image-2 contract.
// Any client attempt to override these is silently discarded.
const MODEL = "gpt-image-2";
const QUALITY = "low";
const SIZE = "1024x1024";
const N = 1;

interface OpenAIImagesResponse {
  data?: Array<{ b64_json?: string }>;
}

/**
 * Minimal surface of the OpenAI client we actually use. Defined here so that
 * tests can inject a fake client via `__setOpenAIClientFactory` without
 * pulling the full `OpenAI` type in.
 */
interface OpenAILike {
  images: {
    generate(body: {
      model: string;
      prompt: string;
      quality: string;
      size: string;
      n: number;
    }): Promise<OpenAIImagesResponse>;
    edit(body: {
      model: string;
      prompt: string;
      image: File[];
      quality: string;
      size: string;
      n: number;
    }): Promise<OpenAIImagesResponse>;
  };
}

type ClientFactory = (apiKey: string) => OpenAILike;

const defaultClientFactory: ClientFactory = (apiKey) =>
  new OpenAI({ apiKey }) as unknown as OpenAILike;

let clientFactory: ClientFactory = defaultClientFactory;

/** Test-only: override the OpenAI client factory for module-boundary mocking. */
export function __setOpenAIClientFactory(factory: ClientFactory) {
  clientFactory = factory;
}

/** Test-only: restore the real OpenAI client factory. */
export function __resetOpenAIClientFactory() {
  clientFactory = defaultClientFactory;
}

/**
 * POST /api/images/generate
 *
 * - `application/json` body `{ prompt }`            → openai.images.generate
 * - `multipart/form-data` with `prompt` + `image`   → openai.images.edit (image[])
 *
 * Server pins model/quality/size/n. Silently discards any client overrides.
 * Decodes the returned b64_json, persists PNG bytes to R2 under `uploads/<id>`,
 * and responds with `{ url: "/api/uploads/<id>" }` (relative — never a base64
 * payload and never an openai.com URL).
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

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return error(500, "OPENAI_API_KEY not configured");
  }

  const client = clientFactory(apiKey);

  let res: OpenAIImagesResponse;
  try {
    if (images.length > 0) {
      res = await client.images.edit({
        model: MODEL,
        prompt,
        image: images,
        quality: QUALITY,
        size: SIZE,
        n: N,
      });
    } else {
      res = await client.images.generate({
        model: MODEL,
        prompt,
        quality: QUALITY,
        size: SIZE,
        n: N,
      });
    }
  } catch (err) {
    const { status, message } = extractUpstreamError(err);
    return jsonResponse({ error: { status, message } }, 502);
  }

  const b64 = res?.data?.[0]?.b64_json;
  if (!b64) {
    return jsonResponse(
      { error: { status: 502, message: "OpenAI returned no image data" } },
      502,
    );
  }

  const bytes = decodeBase64(b64);
  const id = uniqueId();
  await env.TLDRAW_BUCKET.put(`uploads/${id}`, bytes, {
    httpMetadata: { contentType: "image/png" },
  });

  return jsonResponse({ url: `/api/uploads/${id}` }, 200);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function decodeBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function extractUpstreamError(err: unknown): {
  status: number;
  message: string;
} {
  if (err && typeof err === "object") {
    const maybe = err as {
      status?: unknown;
      message?: unknown;
      error?: { message?: unknown };
    };
    const status = typeof maybe.status === "number" ? maybe.status : 500;
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
    return { status, message: message || "OpenAI request failed" };
  }
  return { status: 500, message: String(err) };
}
