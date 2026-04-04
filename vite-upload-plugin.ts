import type { Plugin } from 'vite'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

const UPLOAD_DIR = process.env.CLAWPAD_UPLOAD_DIR
  || join(process.env.HOME || '/tmp', '.openclaw', 'workspace', 'clawpad-sketches')

export function uploadPlugin(): Plugin {
  return {
    name: 'clawpad-upload',
    configureServer(server) {
      server.middlewares.use('/clawpad/upload', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }

        try {
          // Read the multipart body as raw buffer
          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(Buffer.from(chunk))
          }
          const body = Buffer.concat(chunks)

          // Parse multipart boundary from content-type
          const contentType = req.headers['content-type'] || ''
          const boundaryMatch = contentType.match(/boundary=(.+)/)
          if (!boundaryMatch) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'No boundary in content-type' }))
            return
          }

          const boundary = boundaryMatch[1]
          const boundaryBuffer = Buffer.from(`--${boundary}`)

          // Find the file data between boundaries
          const startIdx = body.indexOf(boundaryBuffer) + boundaryBuffer.length
          const endIdx = body.indexOf(boundaryBuffer, startIdx + 1)
          const part = body.subarray(startIdx, endIdx)

          // Skip headers (separated by \r\n\r\n)
          const headerEnd = part.indexOf('\r\n\r\n')
          const fileData = part.subarray(headerEnd + 4)

          // Trim trailing \r\n
          const trimmed = fileData.subarray(
            0,
            fileData[fileData.length - 2] === 0x0d ? fileData.length - 2 : fileData.length
          )

          // Save to disk
          await mkdir(UPLOAD_DIR, { recursive: true })
          const filename = `clawpad-${Date.now()}.png`
          const filePath = join(UPLOAD_DIR, filename)
          await writeFile(filePath, trimmed)

          res.setHeader('Content-Type', 'application/json')
          res.statusCode = 200
          res.end(JSON.stringify({ path: filePath, filename }))
        } catch (err) {
          console.error('Upload error:', err)
          res.statusCode = 500
          res.end(JSON.stringify({ error: 'Upload failed' }))
        }
      })
    },
  }
}
