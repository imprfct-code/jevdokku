import { afterEach, describe, expect, test, vi } from 'vite-plus/test'
import { convexTest } from 'convex-test'
import schema from '../convex/schema'
import { internal } from '../convex/_generated/api'

const modules = import.meta.glob('../convex/**/*.{ts,js}')
afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const finish = { status: 200, inputTokens: 10, outputTokens: 3, cost: 0.1 }

describe('shared accounting', () => {
  test('limits concurrent admissions and records a response exactly once', async () => {
    vi.stubEnv('PUBLIC_DAILY_BUDGET_USD', '1')
    vi.stubEnv('PUBLIC_MAX_CONCURRENT_REQUESTS', '2')
    const t = convexTest(schema, modules)
    const admissions = await Promise.all(
      ['a', 'b', 'c'].map((requestId) =>
        t.mutation(internal.usage.reserve, { requestId, runId: 'run-1' }),
      ),
    )
    expect(admissions.filter((entry) => entry.status === 200)).toHaveLength(2)
    expect(admissions.filter((entry) => entry.status === 429)).toHaveLength(1)
    const requestId = ['a', 'b', 'c'][admissions.findIndex((entry) => entry.status === 200)]
    await t.mutation(internal.usage.finish, { requestId, ...finish })
    await t.mutation(internal.usage.finish, { requestId, ...finish })
    expect(await t.query(internal.usage.snapshot, {})).toMatchObject({
      requests: 2,
      runs: 1,
      responses: 1,
      cost: 0.1,
      inputTokens: 10,
    })
    expect(
      (await t.mutation(internal.usage.reserve, { requestId: 'd', runId: 'run-1' })).status,
    ).toBe(200)
  })

  test('enforces the daily budget and disables shared access at zero', async () => {
    vi.stubEnv('PUBLIC_DAILY_BUDGET_USD', '0.1')
    vi.stubEnv('PUBLIC_MAX_CONCURRENT_REQUESTS', '2')
    const t = convexTest(schema, modules)
    await t.mutation(internal.usage.reserve, { requestId: 'a', runId: null })
    await t.mutation(internal.usage.finish, { requestId: 'a', ...finish })
    expect((await t.mutation(internal.usage.reserve, { requestId: 'b', runId: null })).status).toBe(
      403,
    )
    vi.stubEnv('PUBLIC_DAILY_BUDGET_USD', '0')
    expect(
      (
        await convexTest(schema, modules).mutation(internal.usage.reserve, {
          requestId: 'a',
          runId: null,
        })
      ).status,
    ).toBe(403)
  })

  test('expires abandoned slots while preserving unpriced request counts', async () => {
    vi.useFakeTimers()
    vi.stubEnv('PUBLIC_MAX_CONCURRENT_REQUESTS', '2')
    const t = convexTest(schema, modules)
    for (const requestId of ['a', 'b'])
      await t.mutation(internal.usage.reserve, { requestId, runId: null })
    vi.setSystemTime(Date.now() + 91_000)
    expect((await t.mutation(internal.usage.reserve, { requestId: 'c', runId: null })).status).toBe(
      200,
    )
    expect((await t.query(internal.usage.snapshot, {})).unpricedRequests).toBe(3)
  })

  test('rate limit survives completion and resets after its window', async () => {
    vi.useFakeTimers()
    vi.stubEnv('PUBLIC_REQUESTS_PER_MINUTE', '1')
    vi.stubEnv('PUBLIC_MAX_CONCURRENT_REQUESTS', '2')
    const t = convexTest(schema, modules)
    await t.mutation(internal.usage.reserve, { requestId: 'a', runId: null })
    await t.mutation(internal.usage.finish, { requestId: 'a', ...finish })
    expect((await t.mutation(internal.usage.reserve, { requestId: 'b', runId: null })).status).toBe(
      429,
    )
    vi.setSystemTime(Date.now() + 61_000)
    expect((await t.mutation(internal.usage.reserve, { requestId: 'b', runId: null })).status).toBe(
      200,
    )
  })
})

test('HTTP validation rejects bad requests before calling the provider', async () => {
  const t = convexTest(schema, modules)
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  for (const [body, status] of [
    ['broken', 400],
    [JSON.stringify({ size: 2, board: [0, 0, 0, 0], targets: [0], apiKey: 'personal' }), 400],
  ] as const) {
    expect((await t.fetch('/api/decide', { method: 'POST', body })).status).toBe(status)
  }
  expect(
    (
      await t.fetch('/api/decide', {
        method: 'POST',
        headers: { Origin: 'https://unrelated.example' },
        body: '{}',
      })
    ).status,
  ).toBe(403)
  expect(fetch).not.toHaveBeenCalled()
})

test('shared HTTP request accounts usage and redacts credentials', async () => {
  vi.stubEnv('OPENROUTER_API_KEY', 'test-private-server-key')
  const t = convexTest(schema, modules)
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          answers: {
            cell_0: { choice: '1', probabilities: { '1': 0.7, '2': 0.3 }, confidence: 0.7 },
          },
          usage: { input_tokens: 10, output_tokens: 3, cost: 0.1 },
          debug: 'test-private-server-key',
        }),
        { status: 200 },
      ),
    ),
  )
  const result = await t.fetch('/api/decide', {
    method: 'POST',
    body: JSON.stringify({ size: 2, board: [0, 0, 0, 0], targets: [0], runId: 'test' }),
  })
  expect(result.status).toBe(200)
  expect(await result.text()).not.toContain('test-private-server-key')
  expect(await t.query(internal.usage.snapshot, {})).toMatchObject({
    runs: 1,
    requests: 1,
    cost: 0.1,
  })
})
