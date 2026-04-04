import { TLSocketRoom, NodeSqliteWrapper, SQLiteSyncStorage } from '@tldraw/sync-core'
import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join } from 'path'

const DIR = process.env.CLAWPAD_DATA_DIR || join(process.env.HOME || '/tmp', '.clawpad', 'rooms')
mkdirSync(DIR, { recursive: true })

function sanitizeRoomId(roomId: string): string {
  return roomId.replace(/[^a-zA-Z0-9_-]/g, '_')
}

const rooms = new Map<string, TLSocketRoom<any, void>>()

export function makeOrLoadRoom(roomId: string): TLSocketRoom<any, void> {
  roomId = sanitizeRoomId(roomId)

  const existing = rooms.get(roomId)
  if (existing && !existing.isClosed()) {
    return existing
  }

  console.log(`[clawpad-sync] loading room: ${roomId}`)
  const db = new Database(join(DIR, `${roomId}.db`))
  const sql = new NodeSqliteWrapper(db)
  const storage = new SQLiteSyncStorage({ sql })

  const room = new TLSocketRoom({
    storage,
    onSessionRemoved(room, args) {
      console.log(`[clawpad-sync] client disconnected: ${args.sessionId} from ${roomId}`)
      if (args.numSessionsRemaining === 0) {
        console.log(`[clawpad-sync] closing room: ${roomId}`)
        room.close()
        db.close()
        rooms.delete(roomId)
      }
    },
  })

  rooms.set(roomId, room)
  return room
}
