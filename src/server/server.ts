import cors from '@fastify/cors'
import websocketPlugin from '@fastify/websocket'
import fastify from 'fastify'
import type { RawData } from 'ws'
import { loadAsset, storeAsset } from './assets'
import { makeOrLoadRoom } from './rooms'

const PORT = parseInt(process.env.SYNC_PORT || '5858', 10)

const app = fastify()
app.register(websocketPlugin)
app.register(cors, { origin: '*' })

app.register(async (app) => {
  // WebSocket sync endpoint
  app.get('/connect/:roomId', { websocket: true }, async (socket, req) => {
    const roomId = (req.params as any).roomId as string
    const sessionId = (req.query as any)?.['sessionId'] as string

    const caughtMessages: RawData[] = []
    const collectMessagesListener = (message: RawData) => {
      caughtMessages.push(message)
    }
    socket.on('message', collectMessagesListener)

    const room = makeOrLoadRoom(roomId)
    room.handleSocketConnect({ sessionId, socket })

    socket.off('message', collectMessagesListener)
    for (const message of caughtMessages) {
      socket.emit('message', message)
    }
  })

  // Asset storage
  app.addContentTypeParser('*', (_: any, __: any, done: any) => done(null))

  app.put('/uploads/:id', async (req, res) => {
    const id = (req.params as any).id as string
    await storeAsset(id, req.raw)
    res.send({ ok: true })
  })

  app.get('/uploads/:id', async (req, res) => {
    const id = (req.params as any).id as string
    const data = loadAsset(id)
    res.header('Content-Security-Policy', "default-src 'none'")
    res.header('X-Content-Type-Options', 'nosniff')
    res.send(data)
  })

  // Health check
  app.get('/health', async () => ({ ok: true, rooms: 'active' }))
})

app.listen({ host: '127.0.0.1', port: PORT }, (err) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }
  console.log(`[clawpad-sync] server listening on port ${PORT}`)
})
