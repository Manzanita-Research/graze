import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { IncomingMessage } from 'http'

const DIR = process.env.CLAWPAD_DATA_DIR
  ? join(process.env.CLAWPAD_DATA_DIR, 'assets')
  : join(process.env.HOME || '/tmp', '.clawpad', 'assets')
mkdirSync(DIR, { recursive: true })

export async function storeAsset(id: string, request: IncomingMessage): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(chunk as Buffer)
  }
  const data = Buffer.concat(chunks)
  writeFileSync(join(DIR, id), data)
}

export function loadAsset(id: string): Buffer {
  return readFileSync(join(DIR, id))
}
