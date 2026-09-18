import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  totals: defineTable({
    runs: v.number(),
    requests: v.number(),
    responses: v.number(),
    failed: v.number(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cost: v.number(),
    priced: v.number(),
    startedAt: v.string(),
  }),
  days: defineTable({
    day: v.string(),
    cost: v.number(),
    windowStart: v.number(),
    requests: v.number(),
  }).index('by_day', ['day']),
  runs: defineTable({ runId: v.string() }).index('by_run', ['runId']),
  requests: defineTable({
    requestId: v.string(),
    day: v.string(),
    state: v.union(v.literal('pending'), v.literal('finished')),
    expiresAt: v.number(),
    status: v.optional(v.number()),
    cost: v.optional(v.number()),
  })
    .index('by_request', ['requestId'])
    .index('by_state', ['state', 'expiresAt']),
})
