import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadEnv } from 'vite-plus'
import { askJev } from '../src/jev.ts'
import { loadUsage } from '../server/usage.ts'

const directory = await mkdtemp(join(tmpdir(), 'jevdokku-usage-'))
try {
  const path = join(directory, 'requests.jsonl')
  const usage = await loadUsage(path)
  const time = new Date().toISOString()
  const events = [
    { event: 'request', requestId: 'a', runId: 'one', funding: 'shared', time },
    {
      event: 'response',
      requestId: 'a',
      response: { usage: { input_tokens: 10, output_tokens: 5, cost: 0.1 } },
      time,
    },
    { event: 'request', requestId: 'b', runId: 'one', funding: 'personal', time },
    {
      event: 'response',
      requestId: 'b',
      response: { usage: { input_tokens: 20, output_tokens: 3, cost: 0.2 } },
      time,
    },
    { event: 'request', requestId: 'c', runId: 'two', funding: 'shared', time },
    { event: 'error', requestId: 'c', time },
  ]
  for (const event of [...events, ...events]) usage.record(event)
  assert.equal(usage.snapshot().runs, 2)
  assert.equal(usage.snapshot().requests, 3)
  assert.equal(usage.snapshot().failed, 1)
  assert.equal(usage.snapshot().inputTokens, 30)
  assert.equal(usage.snapshot().outputTokens, 8)
  assert.equal(usage.snapshot().unpricedRequests, 1)
  assert.equal(usage.sharedCostToday(), 0.1)
  await writeFile(path, events.map((event) => JSON.stringify(event)).join('\n') + '\n{"incomplete')
  assert.deepEqual((await loadUsage(path)).snapshot(), usage.snapshot())
} finally {
  await rm(directory, { recursive: true })
}
const base = process.env.TEST_URL || 'http://localhost:4444'
const key = 'sk-or-v1-client-test-not-a-real-key'
const session = await fetch(`${base}/api/session`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ apiKey: key }),
})
assert.equal(session.status, 404)
assert.equal(session.headers.get('set-cookie'), null)
const blocked = await fetch(`${base}/api/decide`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' },
  body: '{}',
})
assert.equal(blocked.status, 403)
const personal = await fetch(`${base}/api/decide`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ size: 2, board: [0, 0, 0, 0], targets: [0], keyMode: 'personal' }),
})
assert.equal(personal.status, 400)

const originalFetch = globalThis.fetch
const calls: { url: string; options: RequestInit | undefined }[] = []
let status = 200
const fixture = {
  answers: { cell_0: { choice: '1', probabilities: { '1': 0.7, '2': 0.3 }, confidence: 0.7 } },
  usage: { input_tokens: 12, output_tokens: 4, cost: 0.01 },
  debug: key,
}
try {
  globalThis.fetch = async (url, options) => {
    calls.push({
      url: typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      options,
    })
    return new Response(JSON.stringify(fixture), { status })
  }
  const result = await askJev([0, 0, 0, 0], 2, [0], new AbortController().signal, 'test', [], key)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://openrouter.ai/api/alpha/decisions')
  assert.equal(new Headers(calls[0].options?.headers).get('authorization'), `Bearer ${key}`)
  assert.equal(calls[0].options?.credentials, 'omit')
  assert.ok(!JSON.stringify(calls[0].options?.body).includes(key))
  assert.ok(!JSON.stringify(result).includes(key))
  assert.equal(result.decisions[0].choice, 1)
  assert.equal(result.usage.cost, 0.01)
  status = 401
  await assert.rejects(
    askJev([0, 0, 0, 0], 2, [0], new AbortController().signal, 'test', [], key),
    /rejected your key/,
  )
  assert.equal(calls.length, 2, 'A personal-key failure must never fall back to shared funds')
  status = 200
  await askJev([0, 0, 0, 0], 2, [0], new AbortController().signal, 'test', [], '')
  assert.equal(calls[2].url, '/api/decide')
  assert.equal(new Headers(calls[2].options?.headers).get('authorization'), null)
} finally {
  globalThis.fetch = originalFetch
}

const env = loadEnv('development', process.cwd(), '')
const sharedKey = env.OPENROUTER_API_KEY || env['OPEN-ROUTER-API-KEY']
const assets = await readdir('dist/assets')
const surfaces = await Promise.all([
  readFile('logs/requests.jsonl', 'utf8'),
  ...['/api/config', '/api/stats', '/'].map(async (path) => (await fetch(base + path)).text()),
  ...assets
    .filter((file) => /\.(js|css)$/.test(file))
    .map((file) => readFile(join('dist/assets', file), 'utf8')),
])
for (const surface of surfaces) {
  assert.ok(!surface.includes(key), 'Personal key must not appear in logs or public responses')
  if (sharedKey)
    assert.ok(
      !surface.includes(sharedKey),
      'Shared key must not appear in logs, public responses or built assets',
    )
}
const persisted = await loadUsage('logs/requests.jsonl')
assert.deepEqual(await (await fetch(`${base}/api/stats`)).json(), persisted.snapshot())
console.log(
  'Verified direct personal-key transport, no server sessions or fallback, origin checks, secret isolation, usage totals and log replay.',
)
