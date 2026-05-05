import { handleUnfurlRequest } from "cloudflare-workers-unfurl";
import { AutoRouter, error, type IRequest } from "itty-router";
import { handleAssetDownload, handleAssetUpload } from "./assetUploads";
import { requireWorkerAccess } from "./auth";
import { handleImageGeneration } from "./images";
export { TLSyncDurableObject } from "./TLSyncDurableObject";

function roomFetch(request: IRequest, env: CloudflareBindings) {
  const id = env.TLSYNC_DURABLE_OBJECT.idFromName(request.params.roomId);
  const room = env.TLSYNC_DURABLE_OBJECT.get(id);
  return room.fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body,
  });
}

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
  .get("/api/connect/:roomId", (request, env) => roomFetch(request, env))

  .get("/api/rooms/:roomId/shapes", (request, env) =>
    roomFetch(request, env),
  )
  .get("/api/rooms/:roomId/snapshot", (request, env) =>
    roomFetch(request, env),
  )
  .post("/api/rooms/:roomId/shapes", (request, env) => {
    const denied = requireWorkerAccess(request, env);
    if (denied) return denied;
    return roomFetch(request, env);
  })
  .patch("/api/rooms/:roomId/shapes/:shapeId", (request, env) => {
    const denied = requireWorkerAccess(request, env);
    if (denied) return denied;
    return roomFetch(request, env);
  })
  .post("/api/rooms/:roomId/shapes/update", (request, env) => {
    const denied = requireWorkerAccess(request, env);
    if (denied) return denied;
    return roomFetch(request, env);
  })
  .post("/api/rooms/:roomId/shapes/delete", (request, env) => {
    const denied = requireWorkerAccess(request, env);
    if (denied) return denied;
    return roomFetch(request, env);
  })

  .post("/api/uploads/:uploadId", (request, env) => {
    const denied = requireWorkerAccess(request, env);
    if (denied) return denied;
    return handleAssetUpload(request, env);
  })
  .get("/api/uploads/:uploadId", handleAssetDownload)

  .get("/api/unfurl", (request, env) => {
    const denied = requireWorkerAccess(request, env);
    if (denied) return denied;
    return handleUnfurlRequest(request);
  })

  .post("/api/images/generate", (request, env) => {
    const denied = requireWorkerAccess(request, env);
    if (denied) return denied;
    return handleImageGeneration(request, env);
  })

  .all("*", () => new Response("Not found", { status: 404 }));

export default { fetch: router.fetch };
