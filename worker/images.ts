import { error, type IRequest } from "itty-router";
import OpenAI from "openai";
import { uniqueId } from "./utils";

interface ImageGenerationRequest {
  prompt: string;
  model?: string;
  n?: number;
  size?: string;
  quality?: string;
  style?: string;
  response_format?: "url" | "b64_json";
}

/**
 * Proxy image generation requests to OpenAI, optionally uploading results to R2.
 *
 * POST /api/images/generate
 * Body: { prompt, model?, n?, size?, quality?, style? }
 *
 * If the request includes `?store=1` we fetch the generated image bytes and
 * save them in the R2 bucket under `uploads/`, returning a local URL.
 */
export async function handleImageGeneration(
  request: IRequest,
  env: CloudflareBindings,
) {
  const body = (await request.json()) as ImageGenerationRequest;
  if (!body.prompt || typeof body.prompt !== "string") {
    return error(400, "prompt is required");
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    return error(500, "OPENAI_API_KEY not configured");
  }

  const client = new OpenAI({ apiKey });

  const res = await client.images.generate({
    prompt: body.prompt,
    model: body.model ?? "gpt-image-2",
    n: Math.min(Math.max(body.n ?? 1, 1), 10) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10,
    size: (body.size ?? "1024x1024") as
      | "256x256"
      | "512x512"
      | "1024x1024"
      | "1792x1024"
      | "1024x1792",
    quality: (body.quality ?? "standard") as "standard" | "hd",
    style: (body.style ?? "vivid") as "vivid" | "natural",
    response_format: "url",
  });

  const data = {
    created: res.created,
    data: res.data.map((d) => ({
      url: d.url,
      b64_json: d.b64_json,
      revised_prompt: d.revised_prompt,
    })),
  };

  // If ?store=1, download each image and save to R2
  const store = request.query.store === "1" || request.query.store === "true";
  if (store) {
    const stored = await Promise.all(
      data.data.map(async (img) => {
        if (!img.url) return img;
        const imageRes = await fetch(img.url);
        if (!imageRes.ok) return img;

        const id = uniqueId();
        const objectName = `uploads/${id}`;
        const contentType =
          imageRes.headers.get("content-type") ?? "image/png";

        await env.TLDRAW_BUCKET.put(objectName, imageRes.body!, {
          httpMetadata: { contentType },
        });

        return {
          ...img,
          url: `/api/uploads/${id}`,
        };
      }),
    );
    return { created: data.created, data: stored };
  }

  return data;
}
