import { internalMutation, internalQuery } from './_generated/server'
import { v } from 'convex/values'

const emptyTotals = {
  runs: 0,
  requests: 0,
  responses: 0,
  failed: 0,
  inputTokens: 0,
  outputTokens: 0,
  cost: 0,
  priced: 0,
}

export const snapshot = internalQuery({
  args: {},
  handler: async (ctx) => {
    const totals = await ctx.db.query('totals').unique()
    const { runs, requests, responses, failed, inputTokens, outputTokens, cost, priced } =
      totals ?? emptyTotals
    return {
      runs,
      requests,
      responses,
      failed,
      inputTokens,
      outputTokens,
      cost,
      unpricedRequests: requests - priced,
      startedAt: totals?.startedAt ?? null,
    }
  },
})

export const reserve = internalMutation({
  args: { requestId: v.string(), runId: v.union(v.string(), v.null()) },
  handler: async (ctx, { requestId, runId }) => {
    const now = Date.now()
    const day = new Date(now).toISOString().slice(0, 10)
    const budget = Math.max(0, Number(process.env.PUBLIC_DAILY_BUDGET_USD ?? 5) || 0)
    const rate = Math.max(1, Number(process.env.PUBLIC_REQUESTS_PER_MINUTE ?? 600) || 600)
    const concurrency = Math.max(
      1,
      Math.min(100, Number(process.env.PUBLIC_MAX_CONCURRENT_REQUESTS ?? 20) || 20),
    )
    const daily = await ctx.db
      .query('days')
      .withIndex('by_day', (q) => q.eq('day', day))
      .unique()
    if (!budget || (daily?.cost ?? 0) >= budget)
      return {
        status: 403,
        error: 'Shared daily budget reached. Connect your own key in settings.',
      }
    const previous = await ctx.db
      .query('requests')
      .withIndex('by_request', (q) => q.eq('requestId', requestId))
      .unique()
    if (previous) return { status: 409, error: 'Request already started.' }
    const active = await ctx.db
      .query('requests')
      .withIndex('by_state', (q) => q.eq('state', 'pending').gt('expiresAt', now))
      .take(concurrency)
    const inWindow = daily && now - daily.windowStart < 60_000
    if (active.length >= concurrency || (inWindow && daily.requests >= rate))
      return { status: 429, error: 'Shared access is busy. Retry shortly or connect your own key.' }
    // Mutations serialize admissions, so limits apply across all function instances.
    const window = {
      windowStart: inWindow ? daily.windowStart : now,
      requests: inWindow ? daily.requests + 1 : 1,
    }
    if (daily) await ctx.db.patch(daily._id, window)
    else await ctx.db.insert('days', { day, cost: 0, ...window })
    const totals = await ctx.db.query('totals').unique()
    let newRun = false
    if (
      runId &&
      !(await ctx.db
        .query('runs')
        .withIndex('by_run', (q) => q.eq('runId', runId))
        .unique())
    ) {
      await ctx.db.insert('runs', { runId })
      newRun = true
    }
    const counters = {
      requests: (totals?.requests ?? 0) + 1,
      runs: (totals?.runs ?? 0) + Number(newRun),
    }
    if (totals) await ctx.db.patch(totals._id, counters)
    else
      await ctx.db.insert('totals', {
        ...emptyTotals,
        ...counters,
        startedAt: new Date(now).toISOString(),
      })
    await ctx.db.insert('requests', { requestId, day, state: 'pending', expiresAt: now + 90_000 })
    return { status: 200, error: null }
  },
})

export const finish = internalMutation({
  args: {
    requestId: v.string(),
    status: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cost: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db
      .query('requests')
      .withIndex('by_request', (q) => q.eq('requestId', args.requestId))
      .unique()
    if (!request || request.state === 'finished') return
    const totals = await ctx.db.query('totals').unique()
    const daily = await ctx.db
      .query('days')
      .withIndex('by_day', (q) => q.eq('day', request.day))
      .unique()
    if (!totals || !daily) throw new Error('Missing usage ledger.')
    const amount = (value: number | null) =>
      value !== null && Number.isFinite(value) && value >= 0 ? value : 0
    const cost = amount(args.cost)
    await ctx.db.patch(request._id, { state: 'finished', status: args.status, cost })
    await ctx.db.patch(daily._id, { cost: daily.cost + cost })
    await ctx.db.patch(totals._id, {
      responses: totals.responses + 1,
      failed: totals.failed + Number(args.status >= 400),
      inputTokens: totals.inputTokens + amount(args.inputTokens),
      outputTokens: totals.outputTokens + amount(args.outputTokens),
      cost: totals.cost + cost,
      priced:
        totals.priced + Number(args.cost !== null && Number.isFinite(args.cost) && args.cost >= 0),
    })
  },
})
