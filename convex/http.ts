import { httpRouter } from 'convex/server'
import { httpAction } from './_generated/server'
import { internal } from './_generated/api'
import { parseDecisionInput } from '../src/requestValidation'
import { makeRequest, readDecisions, type JevResponse } from '../src/protocol'

const http = httpRouter()
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })

http.route({
  path: '/api/config',
  method: 'GET',
  handler: httpAction(async () => {
    const sharedDailyBudget = Math.max(0, Number(process.env.PUBLIC_DAILY_BUDGET_USD ?? 5) || 0)
    return json({
      hasKey: Boolean(process.env.OPENROUTER_API_KEY) && sharedDailyBudget > 0,
      sharedDailyBudget,
    })
  }),
})

http.route({
  path: '/api/stats',
  method: 'GET',
  handler: httpAction(async (ctx) => {
    return json(await ctx.runQuery(internal.usage.snapshot, {}))
  }),
})

http.route({
  path: '/api/decide',
  method: 'POST',
  handler: httpAction(async (ctx, incoming) => {
    const origin = incoming.headers.get('origin')
    const allowed = (process.env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim())
    if (origin && !allowed.includes(origin))
      return json({ error: 'Use this site to make requests.' }, 403)
    if (incoming.headers.has('authorization'))
      return json({ error: 'Personal keys connect directly to OpenRouter from the browser.' }, 400)
    if (Number(incoming.headers.get('content-length')) > 131_072)
      return json({ error: 'Request is too large.' }, 413)
    let input: ReturnType<typeof parseDecisionInput>
    try {
      const text = await incoming.text()
      if (text.length > 131_072) return json({ error: 'Request is too large.' }, 413)
      input = parseDecisionInput(JSON.parse(text))
    } catch (error) {
      return json(
        { error: error instanceof SyntaxError ? 'Invalid JSON.' : (error as Error).message },
        400,
      )
    }
    const key = process.env.OPENROUTER_API_KEY
    if (!key)
      return json({ error: 'Shared access is unavailable. Connect your own key in settings.' }, 401)
    const { board, size, targets, rejectedChoices, runId } = input
    const { request, context } = makeRequest(board, size, targets, rejectedChoices)
    if (JSON.stringify(request).length > 48_000)
      return json({ error: 'Batch exceeds the context budget. Reduce batch size and retry.' }, 413)
    const requestId = crypto.randomUUID()
    const reservation = await ctx.runMutation(internal.usage.reserve, { requestId, runId })
    if (reservation.status !== 200)
      return json(
        { error: reservation.error, ...(reservation.status === 429 ? { retryAfter: 10 } : {}) },
        reservation.status,
      )
    let response: JevResponse | undefined
    let status = 502
    let result: unknown = { error: 'Cannot reach OpenRouter. Retry this batch.' }
    const started = Date.now()
    try {
      const upstream = await fetch('https://openrouter.ai/api/alpha/decisions', {
        method: 'POST',
        signal: AbortSignal.timeout(60_000),
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
          'X-Title': 'jevdokku',
        },
        body: JSON.stringify(request),
      })
      const parsed: unknown = JSON.parse(
        JSON.stringify(await upstream.json()).replaceAll(key, '[redacted]'),
      )
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid provider response.')
      response = parsed as JevResponse
      status = upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502
      if (!upstream.ok) {
        const messages: Record<number, string> = {
          401: 'OpenRouter rejected the key.',
          402: 'OpenRouter needs credits.',
          403: 'This key cannot access Jev.',
          429: 'Rate limit reached. Wait and retry.',
        }
        result = { error: messages[status] ?? 'OpenRouter request failed.' }
        if (status === 429) {
          const header = upstream.headers.get('retry-after')
          const retryAfter = header
            ? Number(header) || Math.ceil((Date.parse(header) - Date.now()) / 1000)
            : 10
          result = {
            error: messages[429],
            retryAfter: Math.max(1, Math.min(120, retryAfter || 10)),
          }
        }
      } else {
        const decisions = readDecisions(response, targets, size)
        if (!decisions) result = { error: 'Invalid model response format. No changes applied.' }
        else {
          status = 200
          result = {
            requestId,
            decisions,
            latency: Date.now() - started,
            source: 'jev',
            request,
            response,
            usage: {
              inputTokens: response.usage?.input_tokens ?? 0,
              outputTokens: response.usage?.output_tokens ?? 0,
              cost: response.usage?.cost ?? null,
            },
            context,
            model: response.model ?? request.model,
          }
        }
      }
    } catch {
      result = { error: 'OpenRouter request failed or timed out. Retry this batch.' }
    }
    const finite = (value: unknown) =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
    // Persist accounting before returning the result. Provider calls are never retried here.
    try {
      await ctx.runMutation(internal.usage.finish, {
        requestId,
        status,
        inputTokens: finite(response?.usage?.input_tokens) ?? 0,
        outputTokens: finite(response?.usage?.output_tokens) ?? 0,
        cost: finite(response?.usage?.cost),
      })
    } catch {
      return json(
        { error: 'Could not save request usage. The provider may have charged this request.' },
        503,
      )
    }
    return json(result, status)
  }),
})

export default http
