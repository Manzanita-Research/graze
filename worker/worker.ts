import { AutoRouter, error, IRequest } from 'itty-router'

export { TldrawDurableObject } from './TldrawDurableObject'

const router = AutoRouter<IRequest, [env: Env, ctx: ExecutionContext]>({
  catch: (e) => {
    console.error(e)
    return error(e)
  },
})
  // WebSocket sync — route to Durable Object
  .get('/api/connect/:roomId', (request, env) => {
    const id = env.TLDRAW_DURABLE_OBJECT.idFromName(request.params.roomId)
    const room = env.TLDRAW_DURABLE_OBJECT.get(id)
    return room.fetch(request.url, { headers: request.headers, body: request.body })
  })
  .all('*', () => new Response('Not found', { status: 404 }))

export default { fetch: router.fetch }
