import {
  DurableObjectSqliteSyncWrapper,
  SQLiteSyncStorage,
  TLSocketRoom,
} from "@tldraw/sync-core";
import {
  createTLSchema,
  defaultShapeSchemas,
  type TLRecord,
} from "@tldraw/tlschema";
import { DurableObject } from "cloudflare:workers";
import { AutoRouter, error, type IRequest } from "itty-router";
import {
  createCanvasShape,
  deleteCanvasShapes,
  getCanvasShapes,
  updateCanvasShape,
} from "./canvasControl";

const schema = createTLSchema({
  shapes: { ...defaultShapeSchemas },
});

interface SocketAttachment {
  sessionId: string;
}

export class TLSyncDurableObject extends DurableObject<CloudflareBindings> {
  private room: TLSocketRoom<TLRecord, void> | null = null;
  private readonly sessionIdToWs = new Map<string, WebSocket>();

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}'),
    );
  }

  private getOrCreateRoom(): TLSocketRoom<TLRecord, void> {
    if (!this.room) {
      const sql = new DurableObjectSqliteSyncWrapper(this.ctx.storage);
      const storage = new SQLiteSyncStorage<TLRecord>({ sql });

      this.room = new TLSocketRoom<TLRecord, void>({
        schema,
        storage,
        clientTimeout: Infinity,
      });

      for (const ws of this.ctx.getWebSockets()) {
        const attachment =
          ws.deserializeAttachment() as SocketAttachment | null;
        if (!attachment?.sessionId) continue;
        this.attachSocketToRoom(this.room, attachment.sessionId, ws);
      }
    }
    return this.room;
  }

  private attachSocketToRoom(
    room: TLSocketRoom<TLRecord, void>,
    sessionId: string,
    ws: WebSocket,
  ) {
    if (this.sessionIdToWs.get(sessionId) === ws) return;
    this.sessionIdToWs.set(sessionId, ws);
    room.handleSocketConnect({ sessionId, socket: ws });
  }

  private readonly router = AutoRouter({ catch: (e) => error(e) })
    .get("/api/connect/:roomId", (request) => this.handleConnect(request))
    .post("/api/rooms/:roomId/shapes", (request) =>
      this.handleCreateShape(request),
    )
    .patch("/api/rooms/:roomId/shapes/:shapeId", (request) =>
      this.handleUpdateShape(request),
    )
    .post("/api/rooms/:roomId/shapes/update", (request) =>
      this.handleUpdateShape(request),
    )
    .post("/api/rooms/:roomId/shapes/delete", (request) =>
      this.handleDeleteShapes(request),
    )
    .get("/api/rooms/:roomId/shapes", () => this.handleListShapes())
    .get("/api/rooms/:roomId/snapshot", () => this.handleSnapshot());

  fetch(request: Request): Response | Promise<Response> {
    return this.router.fetch(request);
  }

  async handleConnect(request: IRequest) {
    const sessionId = request.query.sessionId as string;
    if (!sessionId) return error(400, "Missing sessionId");

    const { 0: clientWebSocket, 1: serverWebSocket } = new WebSocketPair();
    this.ctx.acceptWebSocket(serverWebSocket);

    const attachment: SocketAttachment = { sessionId };
    serverWebSocket.serializeAttachment(attachment);

    this.attachSocketToRoom(this.getOrCreateRoom(), sessionId, serverWebSocket);
    return new Response(null, { status: 101, webSocket: clientWebSocket });
  }

  private async handleCreateShape(request: IRequest) {
    const body = await readJson(request);
    if (!body) return error(400, "invalid JSON body");
    let created: TLRecord | null = null;
    await this.getOrCreateRoom().updateStore((store) => {
      created = createCanvasShape(store, body);
    });

    return json({ ok: true, shape: created }, 201);
  }

  private async handleUpdateShape(request: IRequest) {
    const body = await readJson(request);
    if (!body) return error(400, "invalid JSON body");
    const shapeId = request.params.shapeId ?? body.shapeId;
    if (typeof shapeId !== "string" || shapeId.length === 0) {
      return error(400, "shapeId required");
    }
    let updated: TLRecord | null = null;
    await this.getOrCreateRoom().updateStore((store) => {
      updated = updateCanvasShape(store, { ...body, shapeId });
    });

    if (!updated) return error(404, "shape not found");
    return json({ ok: true, shape: updated });
  }

  private async handleDeleteShapes(request: IRequest) {
    const body = await readJson(request);
    if (!body) return error(400, "invalid JSON body");
    let deleted: string[] = [];
    await this.getOrCreateRoom().updateStore((store) => {
      deleted = deleteCanvasShapes(store, body);
    });

    return json({ ok: true, deleted });
  }

  private handleListShapes() {
    const room = this.getOrCreateRoom();
    return json({
      clock: room.getCurrentDocumentClock(),
      sessions: room.getNumActiveSessions(),
      shapes: getCanvasShapes({
        get: (id) => room.getRecord(id) ?? null,
        getAll: () =>
          room.getCurrentSnapshot().documents.map((doc) => doc.state as TLRecord),
        put: () => {
          throw new Error("read-only store");
        },
        delete: () => {
          throw new Error("read-only store");
        },
      }),
    });
  }

  private handleSnapshot() {
    const room = this.getOrCreateRoom();
    return json({
      clock: room.getCurrentDocumentClock(),
      sessions: room.getNumActiveSessions(),
      snapshot: room.getCurrentSnapshot(),
    });
  }

  private getSessionId(ws: WebSocket): string | null {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    return attachment?.sessionId ?? null;
  }

  override async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ) {
    const sessionId = this.getSessionId(ws);
    if (!sessionId) return;
    const room = this.getOrCreateRoom();
    this.attachSocketToRoom(room, sessionId, ws);
    room.handleSocketMessage(sessionId, message);
  }

  override async webSocketClose(ws: WebSocket) {
    this.handleWebSocketEnd(ws, "handleSocketClose");
  }

  override async webSocketError(ws: WebSocket) {
    this.handleWebSocketEnd(ws, "handleSocketError");
  }

  private handleWebSocketEnd(
    ws: WebSocket,
    method: "handleSocketClose" | "handleSocketError",
  ) {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null;
    if (!attachment?.sessionId) return;
    this.sessionIdToWs.delete(attachment.sessionId);
    const room = this.getOrCreateRoom();
    room[method](attachment.sessionId);
  }
}

async function readJson(
  request: IRequest,
): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) return {};
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
