import {
  DurableObjectSqliteSyncWrapper,
  type SessionStateSnapshot,
  SQLiteSyncStorage,
  TLSocketRoom,
} from '@tldraw/sync-core'
import {
  createTLSchema,
  defaultShapeSchemas,
  TLRecord,
} from '@tldraw/tlschema'
import { DurableObject } from 'cloudflare:workers'
import { AutoRouter, error, IRequest } from 'itty-router'

const schema = createTLSchema({
  shapes: { ...defaultShapeSchemas },
})

interface SocketAttachment {
  sessionId: string
  snapshot: SessionStateSnapshot | null
}

export class TldrawDurableObject extends DurableObject {
  private room: TLSocketRoom<TLRecord, void> | null = null
  private readonly sessionIdToWs = new Map<string, WebSocket>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair('{"type":"ping"}', '{"type":"pong"}')
    )
  }

  private getOrCreateRoom(): TLSocketRoom<TLRecord, void> {
    if (!this.room) {
      const sql = new DurableObjectSqliteSyncWrapper(this.ctx.storage)
      const storage = new SQLiteSyncStorage<TLRecord>({ sql })

      this.room = new TLSocketRoom<TLRecord, void>({
        schema,
        storage,
        clientTimeout: Infinity,
        onSessionSnapshot: (sessionId, snapshot) => {
          const ws = this.sessionIdToWs.get(sessionId)
          if (ws) ws.serializeAttachment({ sessionId, snapshot })
        },
      })

      for (const ws of this.ctx.getWebSockets()) {
        const attachment = ws.deserializeAttachment() as SocketAttachment | null
        if (!attachment?.sessionId) continue
        if (attachment.snapshot) {
          this.room.handleSocketResume({
            sessionId: attachment.sessionId,
            socket: ws,
            snapshot: attachment.snapshot,
          })
        }
      }
    }
    return this.room
  }

  private readonly router = AutoRouter({ catch: (e) => error(e) }).get(
    '/api/connect/:roomId',
    (request) => this.handleConnect(request)
  )

  fetch(request: Request): Response | Promise<Response> {
    return this.router.fetch(request)
  }

  async handleConnect(request: IRequest) {
    const sessionId = request.query.sessionId as string
    if (!sessionId) return error(400, 'Missing sessionId')

    const { 0: clientWebSocket, 1: serverWebSocket } = new WebSocketPair()
    this.ctx.acceptWebSocket(serverWebSocket)

    const attachment: SocketAttachment = { sessionId, snapshot: null }
    serverWebSocket.serializeAttachment(attachment)

    this.getOrCreateRoom().handleSocketConnect({ sessionId, socket: serverWebSocket })
    return new Response(null, { status: 101, webSocket: clientWebSocket })
  }

  private getSessionId(ws: WebSocket): string | null {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null
    return attachment?.sessionId ?? null
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const sessionId = this.getSessionId(ws)
    if (!sessionId) return
    this.sessionIdToWs.set(sessionId, ws)
    this.getOrCreateRoom().handleSocketMessage(sessionId, message)
  }

  override async webSocketClose(ws: WebSocket) {
    this.handleWebSocketEnd(ws, 'handleSocketClose')
  }

  override async webSocketError(ws: WebSocket) {
    this.handleWebSocketEnd(ws, 'handleSocketError')
  }

  private handleWebSocketEnd(ws: WebSocket, method: 'handleSocketClose' | 'handleSocketError') {
    const attachment = ws.deserializeAttachment() as SocketAttachment | null
    if (!attachment?.sessionId) return
    this.sessionIdToWs.delete(attachment.sessionId)
    const room = this.getOrCreateRoom()
    if (attachment.snapshot && !room.getSessionSnapshot(attachment.sessionId)) {
      room.handleSocketResume({
        sessionId: attachment.sessionId,
        socket: ws,
        snapshot: attachment.snapshot,
      })
    }
    room[method](attachment.sessionId)
  }
}
