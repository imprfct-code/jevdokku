import type { Batch, Board, Size, RejectedChoice } from './sudoku.ts'
import { makeRequest, readDecisions, type JevResponse } from './protocol.ts'

export class RateLimitError extends Error {
  retryAfter: number
  constructor(message: string, retryAfter: number) {
    super(message)
    this.retryAfter = retryAfter
  }
}

export async function askJev(
  board: Board,
  size: Size,
  targets: number[],
  signal: AbortSignal,
  runId: string,
  rejectedChoices: RejectedChoice[],
  personalKey: string,
): Promise<Batch> {
  if (!personalKey) {
    const response = await fetch('/api/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board, size, targets, runId, rejectedChoices }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(70_000)]),
    })
    if (!response.headers.get('content-type')?.includes('application/json'))
      throw new Error(`Shared service is unavailable (${response.status}). Retry shortly.`)
    const result = (await response.json()) as Batch & { error?: string; retryAfter?: number }
    if (response.status === 429)
      throw new RateLimitError(result.error || 'Rate limit reached.', result.retryAfter ?? 10)
    if (!response.ok) throw new Error(result.error || 'Request failed.')
    return result
  }
  const { request, context } = makeRequest(board, size, targets, rejectedChoices)
  const started = performance.now()
  const response = await fetch('https://openrouter.ai/api/alpha/decisions', {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${personalKey}` },
    body: JSON.stringify(request),
    signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
  })
  if (response.status === 429) {
    const header = response.headers.get('retry-after')
    const delay = header
      ? Number(header) || Math.ceil((Date.parse(header) - Date.now()) / 1000)
      : 10
    throw new RateLimitError('Rate limit reached.', Math.max(1, Math.min(120, delay || 10)))
  }
  if (!response.ok) {
    const errors: Record<number, string> = {
      401: 'OpenRouter rejected your key.',
      402: 'Your OpenRouter account needs credits.',
      403: 'Your key cannot access Jev.',
    }
    throw new Error(errors[response.status] || `OpenRouter error ${response.status}.`)
  }
  const result = JSON.parse(
    JSON.stringify(await response.json()).replaceAll(personalKey, '[redacted]'),
  ) as JevResponse
  const decisions = readDecisions(result, targets, size)
  if (!decisions) throw new Error('Invalid model response format. No changes applied.')
  return {
    requestId: crypto.randomUUID(),
    decisions,
    latency: Math.round(performance.now() - started),
    source: 'jev',
    request,
    response: result,
    usage: {
      inputTokens: result.usage?.input_tokens ?? 0,
      outputTokens: result.usage?.output_tokens ?? 0,
      cost: result.usage?.cost ?? null,
    },
    context,
    model: result.model ?? request.model,
  }
}
