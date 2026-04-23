import { handleUnfurlRequest } from "cloudflare-workers-unfurl";
import { AutoRouter, error, type IRequest } from "itty-router";
import { handleAssetDownload, handleAssetUpload } from "./assetUploads";
export { TLSyncDurableObject } from "./TLSyncDurableObject";

const router = AutoRouter<
  IRequest,
  [env: CloudflareBindings, ctx: ExecutionContext]
>({
  catch: (e) => {
    console.error(e);
    return error(e);
  },
})
  // WebSocket sync — route to Durable Object
  .get("/api/connect/:roomId", (request, env) => {
    const id = env.TLSYNC_DURABLE_OBJECT.idFromName(request.params.roomId);
    const room = env.TLSYNC_DURABLE_OBJECT.get(id);
    return room.fetch(request.url, {
      headers: request.headers,
      body: request.body,
    });
  })

  .post("/api/uploads/:uploadId", handleAssetUpload)
  .get("/api/uploads/:uploadId", handleAssetDownload)

  .get("/api/unfurl", handleUnfurlRequest)

  .all("*", () => new Response("Not found", { status: 404 }));

export default { fetch: router.fetch };
