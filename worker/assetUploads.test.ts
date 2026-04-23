import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { handleAssetDownload } from "./assetUploads";

// Simulates wrangler's R2 simulator behavior: `object.range` is populated even
// when the caller did NOT send a Range header. The numeric fields it fills in
// can be `undefined`, and the existing length math then produces a malformed
// `bytes NaN-.../...` header. The fix under test must branch on the presence
// of the incoming `Range` header, not on `object.range`.
function createFakeR2Object(
  bytes: Uint8Array,
  range: { offset?: number; length?: number } | { suffix: number } | undefined,
) {
  const size = bytes.length;
  return {
    size,
    httpEtag: '"test-etag"',
    body: new Response(bytes).body,
    range,
    writeHttpMetadata(headers: Headers) {
      headers.set("content-type", "image/png");
    },
  };
}

function createFakeR2Bucket(
  bytes: Uint8Array,
  range: { offset?: number; length?: number } | { suffix: number } | undefined,
) {
  return {
    async get() {
      return createFakeR2Object(bytes, range);
    },
  } as unknown as R2Bucket;
}

function makeEnv(bucket: R2Bucket): CloudflareBindings {
  return {
    TLDRAW_BUCKET: bucket,
    REPLICATE_API_TOKEN: "",
    TLSYNC_DURABLE_OBJECT:
      undefined as unknown as CloudflareBindings["TLSYNC_DURABLE_OBJECT"],
  } as CloudflareBindings;
}

function createFakeCtx(): ExecutionContext & { waited: Promise<unknown>[] } {
  const waited: Promise<unknown>[] = [];
  return {
    waitUntil(p: Promise<unknown>) {
      waited.push(p);
    },
    passThroughOnException() {},
    waited,
  } as unknown as ExecutionContext & { waited: Promise<unknown>[] };
}

interface CachePut {
  key: Request;
  response: Response;
}

function installFakeCaches(): { puts: CachePut[] } {
  const puts: CachePut[] = [];
  (globalThis as unknown as { caches: unknown }).caches = {
    default: {
      async match() {
        return undefined;
      },
      async put(req: Request, response: Response) {
        puts.push({ key: req, response });
      },
    },
  };
  return { puts };
}

function uninstallFakeCaches() {
  delete (globalThis as unknown as { caches?: unknown }).caches;
}

type AssetDownloadRequest = Parameters<typeof handleAssetDownload>[0];

function makeAssetRequest(
  url: string,
  headers: Record<string, string> = {},
): AssetDownloadRequest {
  const req = new Request(url, { headers });
  const wrapped = req as unknown as AssetDownloadRequest & { params: { uploadId: string } };
  const uploadId = url.split("/").pop() ?? "test-id";
  wrapped.params = { uploadId };
  return wrapped;
}

// A tiny but valid PNG byte pattern for the fake bucket body. Content doesn't
// matter for these tests — only lengths and headers do.
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG magic
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk header
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde,
]);

describe("handleAssetDownload", () => {
  beforeEach(() => {
    installFakeCaches();
  });

  afterEach(() => {
    uninstallFakeCaches();
  });

  test("plain GET (no Range header) returns 200 and no content-range, even when object.range is populated with garbage", async () => {
    // Simulate the wrangler R2 simulator: on a plain GET it still fills in
    // `object.range`, and in real-world dev the numeric fields come back as
    // NaN, which made the old code emit a malformed
    // `content-range: bytes NaN-.../...` with status 206. The fix must branch
    // on the presence of the incoming `Range` request header — not on
    // `object.range` — so this worst-case simulator output cannot leak
    // through.
    const bucket = createFakeR2Bucket(PNG_BYTES, {
      offset: Number.NaN,
      length: Number.NaN,
    });
    const ctx = createFakeCtx();

    const res = (await handleAssetDownload(
      makeAssetRequest("http://worker.local/api/uploads/abc123"),
      makeEnv(bucket),
      ctx,
    )) as Response;

    expect(res.status).toBe(200);
    expect(res.headers.get("content-range")).toBeNull();
    // metadata + CORS + CSP + cache-control must still be present on the plain path.
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(res.headers.get("etag")).toBe('"test-etag"');
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");

    // Body must be the full PNG bytes.
    const bodyBytes = new Uint8Array(await res.arrayBuffer());
    expect(bodyBytes.length).toBe(PNG_BYTES.length);
    for (let i = 0; i < PNG_BYTES.length; i++) {
      expect(bodyBytes[i]).toBe(PNG_BYTES[i]);
    }
  });

  test("plain GET with entirely absent object.range also yields 200 and no content-range", async () => {
    const bucket = createFakeR2Bucket(PNG_BYTES, undefined);
    const ctx = createFakeCtx();

    const res = (await handleAssetDownload(
      makeAssetRequest("http://worker.local/api/uploads/abc123"),
      makeEnv(bucket),
      ctx,
    )) as Response;

    expect(res.status).toBe(200);
    expect(res.headers.get("content-range")).toBeNull();
  });

  test("Range: bytes=0-9 request yields 206 and a well-formed content-range (not NaN)", async () => {
    // Simulate what R2 returns when the caller DID send a Range header:
    // object.range has explicit offset/length matching the requested window.
    const bucket = createFakeR2Bucket(PNG_BYTES, { offset: 0, length: 10 });
    const ctx = createFakeCtx();

    const res = (await handleAssetDownload(
      makeAssetRequest("http://worker.local/api/uploads/abc123", {
        range: "bytes=0-9",
      }),
      makeEnv(bucket),
      ctx,
    )) as Response;

    expect(res.status).toBe(206);
    const contentRange = res.headers.get("content-range");
    expect(contentRange).toBe(`bytes 0-9/${PNG_BYTES.length}`);
    expect(contentRange).not.toContain("NaN");
    // Headers preserved on the partial path too.
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(res.headers.get("etag")).toBe('"test-etag"');
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
