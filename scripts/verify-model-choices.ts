import assert from 'node:assert/strict'
import {
  applyBatch,
  candidateMap,
  createRun,
  hasDeadEnd,
  prepareBatch,
  validBoard,
} from '../src/sudoku.ts'
import type { Batch } from '../src/sudoku.ts'
import { makeRequest } from '../src/protocol.ts'

const board = [1, 2, 3, 0, ...Array<number>(12).fill(0)]
const request = makeRequest(board, 4, [3]).request
const allValues = { 1: '1', 2: '2', 3: '3', 4: '4' }
assert.deepEqual(request.questions.cell_3.criteria, allValues)
const batch = (index: number, choice: number): Batch => ({
  decisions: [
    { index, choice, probabilities: { 1: 0.25, 2: 0.25, 3: 0.25, 4: 0.25 }, confidence: 0 },
  ],
  latency: 0,
  source: 'jev',
  request,
  response: null,
  usage: { inputTokens: 0, outputTokens: 0, cost: 0 },
  context: 'full',
  model: 'test',
})
const prepared = { ...createRun(board), targets: [3], backtracks: 0, rejectedChoices: [] }
const rejected = applyBatch(prepared, 4, batch(3, 1))
assert.deepEqual(rejected.board, board, 'Invalid model choices must not fill the board')
assert.equal(rejected.rounds[0].applied.length, 0, 'Invalid choices remain recorded')
const accepted = applyBatch(prepared, 4, batch(3, 4))
assert.equal(accepted.board[3], 4)
const completeSolution = [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1]
const firstAttempt = prepareBatch(createRun(board), 4, 64)
const fullAnswer = {
  ...batch(3, 4),
  decisions: firstAttempt.targets.map((index) => ({
    ...batch(index, completeSolution[index]).decisions[0],
  })),
}
const solvedOnce = applyBatch(firstAttempt, 4, fullAnswer)
assert.deepEqual(
  solvedOnce.board,
  completeSolution,
  'A correct complete guess must solve the puzzle in one request',
)
assert.equal(solvedOnce.rounds.length, 1)
const badAnswer = {
  ...fullAnswer,
  decisions: firstAttempt.targets.map(
    (index) => batch(index, index === 7 ? 4 : index === 6 ? 3 : 1).decisions[0],
  ),
}
const checkedAll = applyBatch(firstAttempt, 4, badAnswer).rounds[0]
assert.equal(
  checkedAll.applied.length + checkedAll.rejected!.length,
  firstAttempt.targets.length,
  'A contradiction must not leave later answers unprocessed',
)
assert.equal(checkedAll.proposal?.[7], 4, 'The complete raw guess must remain in the export')
const failed = applyBatch({ ...prepared, targets: [7] }, 4, batch(7, 4))
const rolledBack = prepareBatch(failed, 4, 64)
assert.equal(rolledBack.backtracks, 1)
assert.deepEqual(
  rolledBack.board,
  board,
  'Rollback may erase values but must not choose replacements',
)
assert.deepEqual(
  makeRequest(rolledBack.board, 4, [7], rolledBack.rejectedChoices).request.questions.cell_7
    .criteria,
  allValues,
  'Rejected values must remain in the complete model distribution',
)
assert.deepEqual(
  makeRequest(board, 4, [7]).request.questions.cell_7.criteria,
  allValues,
  'Every cell must receive all values, including locally invalid ones',
)
const retried = applyBatch({ ...rolledBack, targets: [7] }, 4, batch(7, 4))
assert.deepEqual(retried.board, board, 'A previously failed choice must not be applied again')
const feedback = makeRequest(rolledBack.board, 4, [7], rolledBack.rejectedChoices).request.state
assert.deepEqual(feedback.rejectedChoices, [{ row: 2, column: 4, value: 4 }])

const parent = applyBatch({ ...prepared, targets: [10] }, 4, batch(10, 1))
const child = applyBatch(
  { ...parent, targets: [7], backtracks: 0, rejectedChoices: [] },
  4,
  batch(7, 4),
)
const restored = prepareBatch(child, 4, 64)
assert.equal(restored.board[10], 1, 'Rollback must preserve the earlier assumption')
assert(restored.rejectedChoices.some((item) => item.index === 7 && item.choice === 4))
const changedParent = [...restored.board]
changedParent[10] = 2
const otherBranch = prepareBatch({ ...restored, board: changedParent }, 4, 64)
assert.deepEqual(
  makeRequest(otherBranch.board, 4, [7], otherBranch.rejectedChoices).request.questions.cell_7
    .criteria,
  allValues,
  'Every branch retains a complete probability distribution',
)

assert(
  !otherBranch.rejectedChoices.some((item) => item.index === 7 && item.choice === 4),
  'Changing the earlier assumption must release its failure feedback',
)

const exhausted = prepareBatch(
  {
    ...restored,
    rejections: [1, 2, 4].map((choice) => ({
      index: 7,
      choice,
      assumptions: [{ index: 10, choice: 1 }],
    })),
  },
  4,
  64,
)
assert.deepEqual(exhausted.board, board, 'Exhausting a cell must roll back the earlier assumption')
assert(exhausted.rejectedChoices.some((item) => item.index === 10 && item.choice === 1))
assert(
  !exhausted.rejectedChoices.some((item) => item.index === 7),
  'Child rejections must not escape their branch',
)
const conflictingSingles = [
  6, 1, 2, 0, 5, 3, 0, 0, 0, 0, 8, 7, 1, 0, 0, 6, 0, 0, 5, 0, 0, 0, 4, 7, 9, 2, 0, 0, 7, 0, 2, 0, 5,
  0, 6, 0, 0, 0, 6, 7, 0, 0, 4, 5, 0, 4, 2, 0, 6, 8, 0, 0, 9, 7, 0, 0, 8, 0, 0, 6, 0, 4, 9, 0, 6, 0,
  0, 0, 4, 3, 0, 5, 2, 0, 0, 5, 0, 0, 0, 1, 6,
]
assert(validBoard(conflictingSingles, 9), 'The captured board has no duplicate placed digits')
assert([...candidateMap(conflictingSingles, 9).values()].every((values) => values.size > 0))
assert(
  hasDeadEnd(candidateMap(conflictingSingles, 9), 9),
  'Two forced copies of a digit in one unit are a dead end',
)
assert.throws(
  () => prepareBatch(createRun(conflictingSingles), 9, 64),
  /No solution remains/,
  'Contradictory forced cells must not become a model request',
)
console.log(
  'Full distributions, failed-choice feedback, rejection scope and exhausted-branch rollback pass.',
)
