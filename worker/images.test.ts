import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  __resetReplicateClientFactory,
  __resetReplicateOutputFetcher,
  __setReplicateClientFactory,
  __setReplicateOutputFetcher,
  handleImageGeneration,
} from "./images";

// A tiny but valid 1x1 PNG (red pixel) – base64-encoded.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAWk1v8QAAAABJRU5ErkJggg==";
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const FAKE_REPLICATE_URI = "https://replicate.delivery/test/fake.png";

interface R2Put {
  key: string;
  bytes: Uint8Array;
  contentType: string;
}

function createFakeR2() {
  const puts: R2Put[] = [];
  return {
    puts,
    bucket: {
      async put(
        key: string,
        body: ArrayBuffer | Uint8Array | ReadableStream | null | undefined,
        opts?: { httpMetadata?: { contentType?: string } },
      ) {
        let bytes: Uint8Array;
        if (body instanceof Uint8Array) {
          bytes = new Uint8Array(body);
        } else if (body instanceof ArrayBuffer) {
          bytes = new Uint8Array(body);
        } else {
          throw new Error("fake R2 only supports Uint8Array / ArrayBuffer");
        }
        puts.push({
          key,
          bytes,
          contentType: opts?.httpMetadata?.contentType ?? "",
        });
        return { key };
      },
    } as unknown as R2Bucket,
  };
}

interface FakeCall {
  model: string;
  input: Record<string, unknown>;
}

type RunImpl = (
  model: string,
  input: Record<string, unknown>,
) => Promise<unknown> | unknown;

function createFakeReplicate(
  impl: RunImpl | undefined,
  calls: FakeCall[],
) {
  return {
    async run(model: string, options: { input: Record<string, unknown> }) {
      calls.push({ model, input: options.input });
      if (impl) return await impl(model, options.input);
      // default: return a FileOutput-like object whose url() returns the
      // fake replicate.delivery URI.
      return [
        {
          url: () => new URL(FAKE_REPLICATE_URI),
        },
      ];
    },
  };
}

function makeEnv(
  bucket: R2Bucket,
  apiToken: string | undefined = "r8_test-token",
): CloudflareBindings {
  return {
    TLDRAW_BUCKET: bucket,
    REPLICATE_API_TOKEN: apiToken as string,
    TLSYNC_DURABLE_OBJECT:
      undefined as unknown as CloudflareBindings["TLSYNC_DURABLE_OBJECT"],
  } as CloudflareBindings;
}

function makeJsonRequest(
  body: unknown,
  url = "http://worker.local/api/images/generate",
) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof handleImageGeneration>[0];
}

function makeFormRequest(
  form: FormData,
  url = "http://worker.local/api/images/generate",
) {
  return new Request(url, {
    method: "POST",
    body: form,
  }) as unknown as Parameters<typeof handleImageGeneration>[0];
}

function decodeB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Default fake fetcher that responds to the canonical fake replicate URI with
 * a known PNG byte sequence. Installed at the start of every success-path test
 * so the worker can "download" the output and re-host it in R2.
 */
const DOWNLOADED_PNG_BYTES = decodeB64(TINY_PNG_B64);

function installDefaultFakeFetcher() {
  __setReplicateOutputFetcher(async (url) => {
    const u = typeof url === "string" ? url : url.toString();
    if (u === FAKE_REPLICATE_URI) {
      return new Response(DOWNLOADED_PNG_BYTES, {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    return new Response("not found", { status: 404 });
  });
}

describe("handleImageGeneration (Replicate)", () => {
  let calls: FakeCall[];

  beforeEach(() => {
    calls = [];
    installDefaultFakeFetcher();
  });

  afterEach(() => {
    __resetReplicateClientFactory();
    __resetReplicateOutputFetcher();
  });

  test("pure-prompt JSON returns 200 with a relative /api/uploads/<id> URL", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() => createFakeReplicate(undefined, calls));

    const res = await handleImageGeneration(
      makeJsonRequest({ prompt: "a red square" }),
      makeEnv(fakeR2.bucket),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.url).toBe("string");
    expect(body.url as string).toMatch(/^\/api\/uploads\/[A-Za-z0-9_-]+$/);
    // OpenAI-era keys are absent under Replicate too.
    expect(body).not.toHaveProperty("b64_json");
    expect(body).not.toHaveProperty("revised_prompt");
    expect(body).not.toHaveProperty("created");
    expect(body).not.toHaveProperty("data");
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("openai.com");
    expect(raw).not.toContain("replicate.com");
    expect(raw).not.toContain("replicate.delivery");
  });

  test("pure-prompt: fetched PNG bytes from Replicate URI are stored in R2 byte-for-byte", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() => createFakeReplicate(undefined, calls));

    const res = await handleImageGeneration(
      makeJsonRequest({ prompt: "a red square" }),
      makeEnv(fakeR2.bucket),
    );
    expect(res.status).toBe(200);

    expect(fakeR2.puts).toHaveLength(1);
    const put = fakeR2.puts[0];
    expect(put.key).toMatch(/^uploads\/[A-Za-z0-9_-]+$/);
    expect(put.contentType).toBe("image/png");

    // Byte-for-byte match with what the fake fetcher returned for the Replicate URI.
    expect(put.bytes.length).toBe(DOWNLOADED_PNG_BYTES.length);
    for (let i = 0; i < PNG_MAGIC.length; i++) {
      expect(put.bytes[i]).toBe(PNG_MAGIC[i]);
    }
    for (let i = 0; i < DOWNLOADED_PNG_BYTES.length; i++) {
      expect(put.bytes[i]).toBe(DOWNLOADED_PNG_BYTES[i]);
    }
  });

  test("multipart with one image populates input.input_images with a data URL", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() => createFakeReplicate(undefined, calls));

    const refBytes = decodeB64(TINY_PNG_B64);
    const form = new FormData();
    form.append("prompt", "make it blue");
    form.append(
      "image",
      new File([refBytes], "ref.png", { type: "image/png" }),
    );

    const res = await handleImageGeneration(
      makeFormRequest(form),
      makeEnv(fakeR2.bucket),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.url as string).toMatch(/^\/api\/uploads\/[A-Za-z0-9_-]+$/);

    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("openai/gpt-image-2");
    expect(calls[0].input.prompt).toBe("make it blue");
    const inputImages = calls[0].input.input_images as unknown;
    expect(Array.isArray(inputImages)).toBe(true);
    expect((inputImages as unknown[]).length).toBe(1);
    const first = (inputImages as string[])[0];
    expect(typeof first).toBe("string");
    expect(first.startsWith("data:image/png;base64,")).toBe(true);
    // And the base64 suffix decodes back to the multipart bytes byte-for-byte.
    const decoded = decodeB64(first.slice("data:image/png;base64,".length));
    expect(decoded.length).toBe(refBytes.length);
    for (let i = 0; i < refBytes.length; i++) {
      expect(decoded[i]).toBe(refBytes[i]);
    }
  });

  test("multipart with multiple image files forwards all of them in input.input_images", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() => createFakeReplicate(undefined, calls));

    const form = new FormData();
    form.append("prompt", "combine");
    form.append(
      "image",
      new File([decodeB64(TINY_PNG_B64)], "a.png", { type: "image/png" }),
    );
    form.append(
      "image",
      new File([decodeB64(TINY_PNG_B64)], "b.png", { type: "image/png" }),
    );

    const res = await handleImageGeneration(
      makeFormRequest(form),
      makeEnv(fakeR2.bucket),
    );
    expect(res.status).toBe(200);

    const inputImages = calls[0].input.input_images as string[];
    expect(inputImages.length).toBe(2);
    for (const url of inputImages) {
      expect(url.startsWith("data:image/png;base64,")).toBe(true);
    }
  });

  test("outgoing Replicate input hardcodes quality/aspect_ratio/output_format/number_of_images (pure prompt)", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() => createFakeReplicate(undefined, calls));

    await handleImageGeneration(
      makeJsonRequest({ prompt: "x" }),
      makeEnv(fakeR2.bucket),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].model).toBe("openai/gpt-image-2");
    const input = calls[0].input;
    expect(input.prompt).toBe("x");
    expect(input.quality).toBe("low");
    expect(input.aspect_ratio).toBe("1:1");
    expect(input.output_format).toBe("png");
    expect(input.number_of_images).toBe(1);
    // No reference images in a pure-prompt request.
    expect(input).not.toHaveProperty("input_images");
  });

  test("client overrides for model/quality/aspect_ratio/output_format/number_of_images are silently discarded (JSON)", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() => createFakeReplicate(undefined, calls));

    const res = await handleImageGeneration(
      makeJsonRequest({
        prompt: "x",
        model: "black-forest-labs/flux-schnell",
        quality: "hd",
        aspect_ratio: "16:9",
        output_format: "webp",
        number_of_images: 5,
      }),
      makeEnv(fakeR2.bucket),
    );
    expect(res.status).toBe(200);

    expect(calls[0].model).toBe("openai/gpt-image-2");
    const input = calls[0].input;
    expect(input.quality).toBe("low");
    expect(input.aspect_ratio).toBe("1:1");
    expect(input.output_format).toBe("png");
    expect(input.number_of_images).toBe(1);
  });

  test("client overrides for model/quality/aspect_ratio/output_format/number_of_images are silently discarded (multipart)", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() => createFakeReplicate(undefined, calls));

    const form = new FormData();
    form.append("prompt", "edit me");
    form.append(
      "image",
      new File([decodeB64(TINY_PNG_B64)], "ref.png", { type: "image/png" }),
    );
    form.append("model", "black-forest-labs/flux-schnell");
    form.append("quality", "hd");
    form.append("aspect_ratio", "16:9");
    form.append("output_format", "webp");
    form.append("number_of_images", "5");

    const res = await handleImageGeneration(
      makeFormRequest(form),
      makeEnv(fakeR2.bucket),
    );
    expect(res.status).toBe(200);

    expect(calls[0].model).toBe("openai/gpt-image-2");
    const input = calls[0].input;
    expect(input.quality).toBe("low");
    expect(input.aspect_ratio).toBe("1:1");
    expect(input.output_format).toBe("png");
    expect(input.number_of_images).toBe(1);
  });

  test("forbidden Replicate input params are never forwarded (JSON path)", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() => createFakeReplicate(undefined, calls));

    const res = await handleImageGeneration(
      makeJsonRequest({
        prompt: "x",
        openai_api_key: "sk-should-not-leak",
        user_id: "evil",
        background: "transparent",
        moderation: "low",
        output_compression: 90,
      }),
      makeEnv(fakeR2.bucket),
    );
    expect(res.status).toBe(200);

    const input = calls[0].input as Record<string, unknown>;
    expect(input).not.toHaveProperty("openai_api_key");
    expect(input).not.toHaveProperty("user_id");
    expect(input).not.toHaveProperty("background");
    expect(input).not.toHaveProperty("moderation");
    expect(input).not.toHaveProperty("output_compression");
  });

  test("forbidden Replicate input params are never forwarded (multipart path)", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() => createFakeReplicate(undefined, calls));

    const form = new FormData();
    form.append("prompt", "edit me");
    form.append(
      "image",
      new File([decodeB64(TINY_PNG_B64)], "ref.png", { type: "image/png" }),
    );
    form.append("openai_api_key", "sk-should-not-leak");
    form.append("user_id", "evil");
    form.append("background", "transparent");
    form.append("moderation", "low");
    form.append("output_compression", "90");

    const res = await handleImageGeneration(
      makeFormRequest(form),
      makeEnv(fakeR2.bucket),
    );
    expect(res.status).toBe(200);

    const input = calls[0].input as Record<string, unknown>;
    expect(input).not.toHaveProperty("openai_api_key");
    expect(input).not.toHaveProperty("user_id");
    expect(input).not.toHaveProperty("background");
    expect(input).not.toHaveProperty("moderation");
    expect(input).not.toHaveProperty("output_compression");
  });

  test("missing prompt (JSON) returns 400 mentioning 'prompt' and makes no outbound call", async () => {
    const fakeR2 = createFakeR2();
    let factoryCallCount = 0;
    __setReplicateClientFactory(() => {
      factoryCallCount++;
      return createFakeReplicate(undefined, calls);
    });

    const res = await handleImageGeneration(
      makeJsonRequest({}),
      makeEnv(fakeR2.bucket),
    );

    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("prompt");
    expect(fakeR2.puts).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(factoryCallCount).toBe(0);
  });

  test("empty prompt string returns 400 mentioning 'prompt'", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() => createFakeReplicate(undefined, calls));

    const res = await handleImageGeneration(
      makeJsonRequest({ prompt: "" }),
      makeEnv(fakeR2.bucket),
    );

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("prompt");
    expect(fakeR2.puts).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  test("multipart without a prompt field returns 400", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() => createFakeReplicate(undefined, calls));

    const form = new FormData();
    form.append(
      "image",
      new File([decodeB64(TINY_PNG_B64)], "ref.png", { type: "image/png" }),
    );

    const res = await handleImageGeneration(
      makeFormRequest(form),
      makeEnv(fakeR2.bucket),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("prompt");
    expect(fakeR2.puts).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  test("missing REPLICATE_API_TOKEN returns 500 mentioning REPLICATE_API_TOKEN and does not call Replicate", async () => {
    const fakeR2 = createFakeR2();
    let factoryCallCount = 0;
    __setReplicateClientFactory(() => {
      factoryCallCount++;
      return createFakeReplicate(undefined, calls);
    });

    const res = await handleImageGeneration(
      makeJsonRequest({ prompt: "x" }),
      makeEnv(fakeR2.bucket, ""),
    );

    expect(res.status).toBe(500);
    expect(await res.text()).toContain("REPLICATE_API_TOKEN");
    expect(fakeR2.puts).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(factoryCallCount).toBe(0);
  });

  test("Replicate upstream error is surfaced as HTTP 502 with status+message", async () => {
    const fakeR2 = createFakeR2();
    const upstream = Object.assign(new Error("moderation_blocked"), {
      status: 422,
    });
    __setReplicateClientFactory(() =>
      createFakeReplicate(() => {
        throw upstream;
      }, calls),
    );

    const res = await handleImageGeneration(
      makeJsonRequest({ prompt: "x" }),
      makeEnv(fakeR2.bucket),
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: Record<string, unknown> };
    expect(body.error).toBeDefined();
    expect(body.error?.status).toBe(422);
    expect(body.error?.message).toBe("moderation_blocked");
    expect(fakeR2.puts).toHaveLength(0);
  });

  test("Replicate ApiError-style rejection (response.status) is surfaced with upstream status", async () => {
    const fakeR2 = createFakeR2();
    const upstream = Object.assign(new Error("invalid_token"), {
      response: { status: 401 },
    });
    __setReplicateClientFactory(() =>
      createFakeReplicate(() => {
        throw upstream;
      }, calls),
    );

    const res = await handleImageGeneration(
      makeJsonRequest({ prompt: "x" }),
      makeEnv(fakeR2.bucket),
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: Record<string, unknown> };
    expect(body.error?.status).toBe(401);
    expect(body.error?.message).toBe("invalid_token");
  });

  test("?store flag is ignored - persistence is unconditional", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() => createFakeReplicate(undefined, calls));

    for (const url of [
      "http://worker.local/api/images/generate",
      "http://worker.local/api/images/generate?store=1",
      "http://worker.local/api/images/generate?store=0",
    ]) {
      const res = await handleImageGeneration(
        makeJsonRequest({ prompt: "x" }, url),
        makeEnv(fakeR2.bucket),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { url: string };
      expect(body.url).toMatch(/^\/api\/uploads\/[A-Za-z0-9_-]+$/);
    }

    // Every request must have resulted in exactly one R2 put.
    expect(fakeR2.puts.length).toBe(3);
  });

  test("response body keys are exactly ['url'] – never leaks upstream fields", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() =>
      createFakeReplicate(
        () => [
          {
            url: () => new URL(FAKE_REPLICATE_URI),
          },
        ],
        calls,
      ),
    );

    const res = await handleImageGeneration(
      makeJsonRequest({ prompt: "x" }),
      makeEnv(fakeR2.bucket),
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("b64_json");
    expect(raw).not.toContain("revised_prompt");
    expect(raw).not.toContain("created");
    expect(raw).not.toContain("replicate.com");
    expect(raw).not.toContain("replicate.delivery");
    const body = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["url"]);
  });

  test("Replicate output as array of plain string URLs is also handled", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() =>
      createFakeReplicate(() => [FAKE_REPLICATE_URI], calls),
    );

    const res = await handleImageGeneration(
      makeJsonRequest({ prompt: "x" }),
      makeEnv(fakeR2.bucket),
    );
    expect(res.status).toBe(200);
    expect(fakeR2.puts).toHaveLength(1);
  });

  test("Replicate output URI download failure surfaces as 502", async () => {
    const fakeR2 = createFakeR2();
    __setReplicateClientFactory(() => createFakeReplicate(undefined, calls));
    __setReplicateOutputFetcher(async () => {
      return new Response("bad gateway", { status: 503 });
    });

    const res = await handleImageGeneration(
      makeJsonRequest({ prompt: "x" }),
      makeEnv(fakeR2.bucket),
    );
    expect(res.status).toBe(502);
    expect(fakeR2.puts).toHaveLength(0);
  });
});
