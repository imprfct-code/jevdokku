import { appendFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import express from 'express'
import { createServer, loadEnv } from 'vite-plus'
import { parseDecisionInput } from './src/requestValidation.ts'
import { makeRequest, readDecisions, type JevResponse } from './src/protocol.ts'
import { loadUsage } from './server/usage.ts'

const env = { ...loadEnv(process.env.NODE_ENV || 'development', process.cwd(), ''), ...process.env }
const serverKey = env.OPENROUTER_API_KEY || env['OPEN-ROUTER-API-KEY']
await mkdir('logs', { recursive: true })
const usage = await loadUsage('logs/requests.jsonl')
const sharedDailyBudget = Math.max(0, Number(env.PUBLIC_DAILY_BUDGET_USD ?? 5) || 0)
const sharedRateLimit = Math.max(1, Number(env.PUBLIC_REQUESTS_PER_MINUTE ?? 600) || 600)
const sharedConcurrency = Math.max(
  1,
  Math.min(100, Number(env.PUBLIC_MAX_CONCURRENT_REQUESTS ?? 20) || 20),
)
const visitors = new Map<string, { started: number; requests: number }>()
let sharedInFlight = 0
async function record(entry: Record<string, unknown>) {
  const event = { time: new Date().toISOString(), ...entry }
  usage.record(event)
  try {
    await appendFile('logs/requests.jsonl', JSON.stringify(event) + '\n')
  } catch {
    console.error('Could not save request log.')
  }
}
const app = express()
app.disable('x-powered-by')
app.use(express.json({ limit: '1mb' }))
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  const origin = req.get('origin')
  if (req.method !== 'GET' && origin) {
    try {
      if (new URL(origin).host !== req.get('host')) {
        res.status(403).json({ error: 'Use this site to make requests.' })
        return
      }
    } catch {
      res.status(403).json({ error: 'Invalid origin.' })
      return
    }
  }
  next()
})
app.get('/api/config', (_req, res) =>
  res.json({
    hasKey: Boolean(serverKey) && sharedDailyBudget > 0,
    sharedDailyBudget,
  }),
)
app.get('/api/stats', (_req, res) => res.json(usage.snapshot()))
app.post('/api/decide', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  let input: ReturnType<typeof parseDecisionInput>
  try {
    if (req.get('authorization'))
      throw new Error('Personal keys connect directly to OpenRouter from the browser.')
    input = parseDecisionInput(req.body)
  } catch (error) {
    res.status(400).json({ error: (error as Error).message })
    return
  }
  const { board, size, targets, rejectedChoices, runId } = input
  const key = serverKey
  if (!key) {
    res.status(401).json({ error: 'Add an OpenRouter key in .env or settings.' })
    return
  }
  {
    if (usage.sharedCostToday() >= sharedDailyBudget) {
      res
        .status(403)
        .json({ error: 'Shared daily budget reached. Connect your own key in settings.' })
      return
    }
    const now = Date.now()
    for (const [ip, visitor] of visitors) if (now - visitor.started >= 60_000) visitors.delete(ip)
    const ip = req.ip || 'unknown'
    const visitor = visitors.get(ip) ?? { started: now, requests: 0 }
    if (visitor.requests >= sharedRateLimit || sharedInFlight >= sharedConcurrency) {
      res.status(429).json({
        error: 'Shared access is busy. Retry shortly or connect your own key.',
        retryAfter: 10,
      })
      return
    }
    visitor.requests++
    visitors.set(ip, visitor)
    sharedInFlight++
  }
  const requestId = randomUUID()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 60_000)
  res.on('close', () => {
    if (!res.writableEnded) controller.abort()
  })
  try {
    const started = performance.now()
    const { request, context } = makeRequest(board, size, targets, rejectedChoices)
    if (JSON.stringify(request).length > 48_000) {
      res
        .status(413)
        .json({ error: 'Batch exceeds the context budget. Reduce batch size and retry.' })
      return
    }
    await record({
      event: 'request',
      requestId,
      runId,
      funding: 'shared',
      size,
      board,
      targets,
      request,
    })
    const upstream = await fetch('https://openrouter.ai/api/alpha/decisions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'jevdokku',
      },
      body: JSON.stringify(request),
    })
    const response = JSON.parse(
      JSON.stringify(await upstream.json()).replaceAll(key, '[redacted]'),
    ) as JevResponse
    await record({
      event: 'response',
      requestId,
      runId,
      status: upstream.status,
      latency: Math.round(performance.now() - started),
      response,
    })
    if (!upstream.ok) {
      if (upstream.status === 429) {
        const header = upstream.headers.get('retry-after')
        const retryAfter = header
          ? Number(header) || Math.ceil((Date.parse(header) - Date.now()) / 1000)
          : 10
        res.status(429).json({
          error: 'Rate limit reached.',
          retryAfter: Math.max(1, Math.min(120, retryAfter || 10)),
        })
        return
      }
      const messages: Record<number, string> = {
        401: 'OpenRouter rejected the key.',
        402: 'OpenRouter needs credits.',
        403: 'This key cannot access Jev.',
        429: 'Rate limit reached. Wait and retry.',
      }
      res.status(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502).json({
        error:
          messages[upstream.status] ||
          String(response.error?.message || `OpenRouter error ${upstream.status}`).slice(0, 240),
      })
      return
    }
    const decisions = readDecisions(response, targets, size)
    if (!decisions) {
      res.status(502).json({ error: 'Invalid model response format. No changes applied.' })
      return
    }
    res.json({
      requestId,
      decisions,
      latency: Math.round(performance.now() - started),
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
    })
  } catch {
    await record({
      event: 'error',
      requestId,
      runId,
      error: controller.signal.aborted ? 'aborted' : 'upstream-failure',
    })
    if (!res.destroyed)
      res.status(502).json({
        error: controller.signal.aborted
          ? 'Request timed out. Retry this batch.'
          : 'Cannot reach OpenRouter. Retry this batch.',
      })
  } finally {
    sharedInFlight--
    clearTimeout(timeout)
  }
})
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }))
if (process.env.NODE_ENV === 'production') app.use(express.static('dist'))
else {
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' })
  app.use(vite.middlewares)
}
const port = Number(env.PORT || 4444)
const host = env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : 'localhost')
app.listen(port, host, () => console.log(`jevdokku is running at http://localhost:${port}`))
