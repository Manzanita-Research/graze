import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  __resetOpenAIClientFactory,
  __setOpenAIClientFactory,
  handleImageGeneration,
} from "./images";

// A tiny but valid 1x1 PNG (red pixel) – base64-encoded.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGP4DwABAQEAWk1v8QAAAABJRU5ErkJggg==";
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

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
  method: "generate" | "edit";
  body: Record<string, unknown>;
}

interface FakeOpenAIResponse {
  data?: Array<{ b64_json?: string }>;
}

function createFakeOpenAI(
  impl: {
    generate?: (body: Record<string, unknown>) => FakeOpenAIResponse;
    edit?: (body: Record<string, unknown>) => FakeOpenAIResponse;
  },
  calls: FakeCall[],
) {
  return {
    images: {
      async generate(
        body: Record<string, unknown>,
      ): Promise<FakeOpenAIResponse> {
        calls.push({ method: "generate", body });
        if (impl.generate) return impl.generate(body);
        return { data: [{ b64_json: TINY_PNG_B64 }] };
      },
      async edit(body: Record<string, unknown>): Promise<FakeOpenAIResponse> {
        calls.push({ method: "edit", body });
        if (impl.edit) return impl.edit(body);
        return { data: [{ b64_json: TINY_PNG_B64 }] };
      },
    },
  };
}

function makeEnv(
  bucket: R2Bucket,
  apiKey: string | undefined = "test-key",
): CloudflareBindings {
  return {
    TLDRAW_BUCKET: bucket,
    OPENAI_API_KEY: apiKey as string,
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

describe("handleImageGeneration", () => {
  let calls: FakeCall[];

  beforeEach(() => {
    calls = [];
  });

  afterEach(() => {
    __resetOpenAIClientFactory();
  });

  test("pure-prompt JSON returns 200 with a relative /api/uploads/<id> URL", async () => {
    const fakeR2 = createFakeR2();
    __setOpenAIClientFactory(() => createFakeOpenAI({}, calls));

    const res = await handleImageGeneration(
      makeJsonRequest({ prompt: "a red square" }),
      makeEnv(fakeR2.bucket),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.url).toBe("string");
    expect(body.url as string).toMatch(/^\/api\/uploads\/[A-Za-z0-9_-]+$/);
    expect(body).not.toHaveProperty("b64_json");
    expect(body).not.toHaveProperty("revised_prompt");
    expect(body).not.toHaveProperty("created");
    expect(body).not.toHaveProperty("data");
    expect(JSON.stringify(body)).not.toContain("openai.com");
  });

  test("pure-prompt decoded PNG bytes are stored in R2 with contentType image/png", async () => {
    const fakeR2 = createFakeR2();
    __setOpenAIClientFactory(() => createFakeOpenAI({}, calls));

    const res = await handleImageGeneration(
      makeJsonRequest({ prompt: "a red square" }),
      makeEnv(fakeR2.bucket),
    );
    expect(res.status).toBe(200);

    expect(fakeR2.puts).toHaveLength(1);
    const put = fakeR2.puts[0];
    expect(put.key).toMatch(/^uploads\/[A-Za-z0-9_-]+$/);
    expect(put.contentType).toBe("image/png");

    // Byte-for-byte match with decoded base64 input.
    const expected = decodeB64(TINY_PNG_B64);
    expect(put.bytes.length).toBe(expected.length);
    for (let i = 0; i < PNG_MAGIC.length; i++) {
      expect(put.bytes[i]).toBe(PNG_MAGIC[i]);
    }
    for (let i = 0; i < expected.length; i++) {
      expect(put.bytes[i]).toBe(expected[i]);
    }
  });

  test("multipart request with one image file calls images.edit with image as an array", async () => {
    const fakeR2 = createFakeR2();
    __setOpenAIClientFactory(() => createFakeOpenAI({}, calls));

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
    expect(calls[0].method).toBe("edit");
    expect(Array.isArray(calls[0].body.image)).toBe(true);
    expect((calls[0].body.image as unknown[]).length).toBe(1);
    expect(calls[0].body.prompt).toBe("make it blue");
  });

  test("multipart request with multiple image files forwards all of them in image[]", async () => {
    const fakeR2 = createFakeR2();
    __setOpenAIClientFactory(() => createFakeOpenAI({}, calls));

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

    expect(calls[0].method).toBe("edit");
    expect((calls[0].body.image as unknown[]).length).toBe(2);
  });

  test("outgoing OpenAI request hardcodes model/quality/size/n and omits deprecated fields (generate)", async () => {
    const fakeR2 = createFakeR2();
    __setOpenAIClientFactory(() => createFakeOpenAI({}, calls));

    await handleImageGeneration(
      makeJsonRequest({ prompt: "x" }),
      makeEnv(fakeR2.bucket),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("generate");
    const body = calls[0].body;
    expect(body.model).toBe("gpt-image-2");
    expect(body.quality).toBe("low");
    expect(body.size).toBe("1024x1024");
    expect(body.n).toBe(1);
    expect(body).not.toHaveProperty("style");
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("input_fidelity");
  });

  test("client overrides for model/quality/size/n are silently discarded (JSON)", async () => {
    const fakeR2 = createFakeR2();
    __setOpenAIClientFactory(() => createFakeOpenAI({}, calls));

    const res = await handleImageGeneration(
      makeJsonRequest({
        prompt: "x",
        model: "dall-e-3",
        quality: "hd",
        size: "512x512",
        n: 5,
        style: "vivid",
        response_format: "url",
        input_fidelity: "high",
      }),
      makeEnv(fakeR2.bucket),
    );
    expect(res.status).toBe(200);

    const body = calls[0].body;
    expect(body.model).toBe("gpt-image-2");
    expect(body.quality).toBe("low");
    expect(body.size).toBe("1024x1024");
    expect(body.n).toBe(1);
    expect(body).not.toHaveProperty("style");
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("input_fidelity");
  });

  test("client overrides for model/quality/size/n are silently discarded (multipart)", async () => {
    const fakeR2 = createFakeR2();
    __setOpenAIClientFactory(() => createFakeOpenAI({}, calls));

    const form = new FormData();
    form.append("prompt", "edit me");
    form.append(
      "image",
      new File([decodeB64(TINY_PNG_B64)], "ref.png", { type: "image/png" }),
    );
    form.append("model", "dall-e-3");
    form.append("quality", "hd");
    form.append("size", "512x512");
    form.append("n", "5");
    form.append("style", "vivid");
    form.append("response_format", "url");
    form.append("input_fidelity", "high");

    const res = await handleImageGeneration(
      makeFormRequest(form),
      makeEnv(fakeR2.bucket),
    );
    expect(res.status).toBe(200);

    const body = calls[0].body;
    expect(body.model).toBe("gpt-image-2");
    expect(body.quality).toBe("low");
    expect(body.size).toBe("1024x1024");
    expect(body.n).toBe(1);
    expect(body).not.toHaveProperty("style");
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("input_fidelity");
  });

  test("missing prompt (JSON) returns 400 mentioning 'prompt'", async () => {
    const fakeR2 = createFakeR2();
    let callCount = 0;
    __setOpenAIClientFactory(() => {
      callCount++;
      return createFakeOpenAI({}, calls);
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
    expect(callCount).toBe(0);
  });

  test("empty prompt string returns 400 mentioning 'prompt'", async () => {
    const fakeR2 = createFakeR2();
    __setOpenAIClientFactory(() => createFakeOpenAI({}, calls));

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
    __setOpenAIClientFactory(() => createFakeOpenAI({}, calls));

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

  test("missing OPENAI_API_KEY returns 500 mentioning OPENAI_API_KEY and does not call OpenAI", async () => {
    const fakeR2 = createFakeR2();
    let factoryCallCount = 0;
    __setOpenAIClientFactory(() => {
      factoryCallCount++;
      return createFakeOpenAI({}, calls);
    });

    const res = await handleImageGeneration(
      makeJsonRequest({ prompt: "x" }),
      makeEnv(fakeR2.bucket, ""),
    );

    expect(res.status).toBe(500);
    expect(await res.text()).toContain("OPENAI_API_KEY");
    expect(fakeR2.puts).toHaveLength(0);
    expect(calls).toHaveLength(0);
    expect(factoryCallCount).toBe(0);
  });

  test("OpenAI upstream error is surfaced as HTTP 502 with status+message", async () => {
    const fakeR2 = createFakeR2();
    const upstream = Object.assign(new Error("invalid_api_key"), {
      status: 401,
    });
    __setOpenAIClientFactory(() =>
      createFakeOpenAI(
        {
          generate: () => {
            throw upstream;
          },
        },
        calls,
      ),
    );

    const res = await handleImageGeneration(
      makeJsonRequest({ prompt: "x" }),
      makeEnv(fakeR2.bucket),
    );

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error?: Record<string, unknown> };
    expect(body.error).toBeDefined();
    expect(body.error?.status).toBe(401);
    expect(body.error?.message).toBe("invalid_api_key");
    expect(fakeR2.puts).toHaveLength(0);
  });

  test("?store flag is ignored - persistence is unconditional", async () => {
    const fakeR2 = createFakeR2();
    __setOpenAIClientFactory(() => createFakeOpenAI({}, calls));

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

  test("response body for successful generate never contains b64_json/revised_prompt/created", async () => {
    const fakeR2 = createFakeR2();
    __setOpenAIClientFactory(() =>
      createFakeOpenAI(
        {
          generate: () => ({
            created: 123456,
            data: [
              {
                b64_json: TINY_PNG_B64,
                revised_prompt: "definitely not user-visible",
              },
            ],
          }),
        },
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
    const body = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(["url"]);
  });
});
