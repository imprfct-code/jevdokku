import assert from 'node:assert/strict'
import fs from 'node:fs'
import { applyBatch, candidateMap, createRun, validBoard } from '../src/sudoku.ts'
import { boardChanges } from '../src/boardChanges.ts'

const trace = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const solution = [...trace.initial]
while (solution.includes(0)) {
  const singles = [...candidateMap(solution, trace.size)].filter(([, values]) => values.size === 1)
  assert(singles.length, 'This audit requires a puzzle solvable by single candidates')
  for (const [index, values] of singles) solution[index] = [...values][0]
}
assert(validBoard(solution, trace.size), 'Forced restoration must produce a valid solution')

let run = createRun(trace.initial)
const totals = {
  choices: 0,
  singleOption: 0,
  exact100: 0,
  confidence100: 0,
  wrong: 0,
  removed: 0,
  replaced: 0,
  backtracks: 0,
}
for (const [index, round] of trace.rounds.entries()) {
  const options = candidateMap(round.before, trace.size)
  const changes = [...boardChanges(run.board, round.before).values()]
  const removed = changes.filter((change) => change.kind === 'removed').length
  const replaced = changes.filter((change) => change.kind === 'replaced').length
  const counts = {
    choices: round.decisions.length,
    singleOption: 0,
    exact100: 0,
    confidence100: 0,
    wrong: 0,
    removed,
    replaced,
    backtracks: round.backtracks,
  }
  for (const decision of round.decisions) {
    const key = `cell_${decision.index}`
    const criteria = Object.keys(round.request.questions[key].criteria).map(Number)
    assert.deepEqual(
      criteria,
      [...options.get(decision.index)],
      'Request must match immediate candidates',
    )
    const raw = round.response.answers[key]
    assert.equal(Number(raw.choice), decision.choice, 'Choice must match the raw response')
    assert.deepEqual(raw.probabilities, decision.probabilities)
    assert.equal(raw.confidence, decision.confidence)
    counts.singleOption += Number(criteria.length === 1)
    counts.exact100 += Number(raw.probabilities[raw.choice] === 1)
    counts.confidence100 += Number(raw.confidence === 1)
    counts.wrong += Number(decision.choice !== solution[decision.index])
  }
  // Reproduce application independently of the saved after-state when no rollback occurred.
  if (!changes.length) {
    run = applyBatch(
      { ...run, targets: round.decisions.map((decision) => decision.index), backtracks: 0 },
      trace.size,
      round,
    )
    assert.deepEqual(run.board, round.board, 'Replayed board must match the saved board')
  } else run = createRun(round.board)
  assert(validBoard(round.board, trace.size))
  for (const key of Object.keys(totals)) totals[key] += counts[key]
  console.log(JSON.stringify({ batch: index + 1, ...counts, applied: round.applied.length }))
}
console.log(
  JSON.stringify({
    size: trace.size,
    rounds: trace.rounds.length,
    ...totals,
    solved: run.board.every((value, index) => value === solution[index]),
    cost: trace.totals.cost,
  }),
)
