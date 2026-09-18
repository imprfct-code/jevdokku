import assert from 'node:assert/strict'
import { createRun, generatePuzzle, prepareBatch, MAX_BATCH_SIZE } from '../src/sudoku.ts'
import { makeRequest } from '../src/protocol.ts'

for (const size of [4, 9, 16, 25, 32, 64]) {
  const board = generatePuzzle(size, 'Hard')
  const empty = board.flatMap((value, index) => (value ? [] : [index]))
  for (const limit of [64, MAX_BATCH_SIZE]) {
    const { targets } = prepareBatch(createRun(board), size, limit)
    assert.deepEqual(
      targets,
      empty.slice(0, limit),
      'Batch selection must not skip shared units or prefer forced cells',
    )
    const { request } = makeRequest(board, size, targets)
    for (const question of Object.values(request.questions)) {
      assert.deepEqual(
        Object.keys(question.criteria).map(Number),
        Array.from({ length: size }, (_, index) => index + 1),
        'Every question must include all values',
      )
    }
    assert(!('deductions' in request.state), 'Request exposes computed answers')
    console.log(
      `${size}x${size}: ${targets.length}/${limit} cells, every question has ${size} values`,
    )
  }
}
