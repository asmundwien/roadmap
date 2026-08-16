import type { Server } from 'node:http'
import type { ServerMessage, Snapshot } from '@roadmap/contracts'
import { WebSocket, WebSocketServer } from 'ws'

export interface SnapshotSocket {
  /** Sends the snapshot, whole, to every connected client. */
  broadcast(snapshot: Snapshot): void
  clientCount(): number
  close(): void
}

/**
 * The wire to the SPA: full-snapshot replace, nothing else. A client that connects mid-life
 * immediately gets the current snapshot, so the SPA never has to ask.
 */
export function createSnapshotSocket(server: Server, path = '/ws'): SnapshotSocket {
  const wss = new WebSocketServer({ server, path })
  let lastMessage: string | null = null

  wss.on('connection', (client) => {
    if (lastMessage !== null) client.send(lastMessage)
  })

  return {
    broadcast(snapshot) {
      const message: ServerMessage = { type: 'snapshot', snapshot }
      lastMessage = JSON.stringify(message)
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) client.send(lastMessage)
      }
    },
    clientCount: () => wss.clients.size,
    close() {
      for (const client of wss.clients) client.terminate()
      wss.close()
    },
  }
}
