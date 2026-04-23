import type { ServerWebSocket } from "bun";

export type WsMessage =
  | { type: "message:created"; message: Record<string, unknown> }
  | { type: "shape:created"; message: Record<string, unknown> }
  | { type: "snapshot:created"; timestamp: string }
  | { type: "canvas:create_shape"; shape: Record<string, unknown> }
  | { type: "canvas:update_shape"; shapeId: string; props: Record<string, unknown> }
  | { type: "canvas:delete_shapes"; shapeIds: string[] }
  | { type: "canvas:move_viewport"; x: number; y: number; zoom?: number }
  | { type: "canvas:rasterize_request"; requestId: string; shapeIds: string[] };

const clients = new Set<ServerWebSocket<unknown>>();

export function addClient(ws: ServerWebSocket<unknown>) {
  clients.add(ws);
}

export function removeClient(ws: ServerWebSocket<unknown>) {
  clients.delete(ws);
}

export function broadcast(message: WsMessage) {
  const data = JSON.stringify(message);
  for (const client of clients) {
    try {
      client.send(data);
    } catch {
      clients.delete(client);
    }
  }
}
