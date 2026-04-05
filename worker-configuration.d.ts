declare namespace Cloudflare {
  interface Env {
    TLDRAW_DURABLE_OBJECT: DurableObjectNamespace<
      import('./worker/TldrawDurableObject').TldrawDurableObject
    >
  }
}
interface Env extends Cloudflare.Env {}
