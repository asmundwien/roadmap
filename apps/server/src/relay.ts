import { SmeeClient } from 'smee-client'

export interface RelayOptions {
  /** The smee.io channel the GitHub App delivers to. */
  source: string
  /** The local webhook endpoint deliveries are re-POSTed to. */
  target: string
  /** Fired on every re-connect after the first: the window smee silently dropped deliveries in.
   * The caller answers with a reconcile — the only way to see what was missed. */
  onReconnect: () => void
}

export interface Relay {
  stop(): Promise<void>
}

/**
 * The smee relay: subscribes to the channel over SSE and re-POSTs each delivery to the local
 * webhook receiver. smee buffers nothing and tells GitHub 200 regardless, so every disconnect is
 * a silent-loss window — hence `onReconnect`.
 */
export async function startRelay(options: RelayOptions): Promise<Relay> {
  let everOpened = false

  const client = new SmeeClient({
    source: options.source,
    target: options.target,
    logger: { info: (...args: unknown[]) => console.info('[smee]', ...args), error: console.error },
  })

  client.onopen = () => {
    if (everOpened) {
      console.info('[smee] reconnected — reconciling the gap')
      options.onReconnect()
    }
    everOpened = true
  }
  client.onerror = () => {
    // The client retries on its own; this is just so a dead channel is visible in the log.
    console.warn('[smee] connection error (will retry)')
  }

  await client.start()
  return {
    stop: () => client.stop(),
  }
}
