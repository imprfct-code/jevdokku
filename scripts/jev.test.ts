import { afterEach, expect, test, vi } from 'vite-plus/test'
import { askJev, RateLimitError } from '../src/jev'

afterEach(() => vi.unstubAllGlobals())
const request = (signal = new AbortController().signal) =>
  askJev([0, 0, 0, 0], 2, [0], signal, 'test-run', [], '')

test('reports unavailable shared routing without a JSON parsing error', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not found', { status: 404 })))
  await expect(request()).rejects.toThrow('Shared service is unavailable (404)')
})

test('preserves the retry delay when shared capacity is full', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(Response.json({ error: 'Busy', retryAfter: 12 }, { status: 429 })),
  )
  await expect(request()).rejects.toMatchObject({ constructor: RateLimitError, retryAfter: 12 })
})

test('a caller can cancel its own pending request without cancelling another run', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url, options: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          options.signal!.addEventListener('abort', () => reject(options.signal!.reason), {
            once: true,
          })
          if (JSON.parse(options.body as string).runId === 'other-run')
            resolve(Response.json({ requestId: 'other-response' }))
        }),
    ),
  )
  const controller = new AbortController()
  const pending = request(controller.signal)
  const rejection = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await rejection
  await expect(
    askJev([0, 0, 0, 0], 2, [0], new AbortController().signal, 'other-run', [], ''),
  ).resolves.toMatchObject({ requestId: 'other-response' })
})
