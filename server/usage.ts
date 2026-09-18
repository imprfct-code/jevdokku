import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'

type Event = Record<string, unknown>

export async function loadUsage(path: string) {
  const requests = new Set<string>()
  const runs = new Set<string>()
  const responses = new Set<string>()
  const errors = new Set<string>()
  const personal = new Set<string>()
  const dailySharedCost = new Map<string, number>()
  let inputTokens = 0,
    outputTokens = 0,
    cost = 0,
    priced = 0
  let startedAt: string | null = null

  function record(event: Event) {
    const id = typeof event.requestId === 'string' ? event.requestId : null
    if (!id) return
    const time = typeof event.time === 'string' ? event.time : new Date().toISOString()
    startedAt ??= time
    if (event.event === 'request' && !requests.has(id)) {
      requests.add(id)
      if (typeof event.runId === 'string') runs.add(event.runId)
      if (event.funding === 'personal') personal.add(id)
    }
    if (event.event === 'error') errors.add(id)
    if (event.event !== 'response' || responses.has(id)) return
    responses.add(id)
    if (typeof event.status === 'number' && event.status >= 400) errors.add(id)
    const usage = (event.response as { usage?: Record<string, unknown> } | undefined)?.usage
    const amount = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0
    inputTokens += amount(usage?.input_tokens)
    outputTokens += amount(usage?.output_tokens)
    cost += amount(usage?.cost)
    if (typeof usage?.cost === 'number') priced++
    if (!personal.has(id))
      dailySharedCost.set(
        time.slice(0, 10),
        (dailySharedCost.get(time.slice(0, 10)) ?? 0) + amount(usage?.cost),
      )
  }
  try {
    const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
    for await (const line of lines) {
      try {
        record(JSON.parse(line))
      } catch {
        /* Ignore an incomplete final log line. */
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  return {
    record,
    sharedCostToday: () => dailySharedCost.get(new Date().toISOString().slice(0, 10)) ?? 0,
    snapshot: () => ({
      runs: runs.size,
      requests: requests.size,
      responses: responses.size,
      failed: errors.size,
      inputTokens,
      outputTokens,
      cost,
      unpricedRequests: Math.max(0, requests.size - priced),
      startedAt,
    }),
  }
}
