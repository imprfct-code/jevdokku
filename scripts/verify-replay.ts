import assert from 'node:assert/strict'
import { boardChanges } from '../src/boardChanges.ts'
import { MAX_SIZE, validSize } from '../src/sudoku.ts'

const first = [1, 2, 3, 0]
const second = [1, 0, 4, 2]
const third = [1, 5, 0, 2]
const changes = boardChanges(first, second)
assert.deepEqual(
  [...changes],
  [
    [1, { from: 2, to: 0, kind: 'removed' }],
    [2, { from: 3, to: 4, kind: 'replaced' }],
    [3, { from: 0, to: 2, kind: 'added' }],
  ],
)
for (const [from, to] of [
  [first, second],
  [second, first],
  [first, third],
  [third, second],
]) {
  const restored = [...from]
  for (const [index, change] of boardChanges(from, to)) restored[index] = change.to
  assert.deepEqual(
    restored,
    to,
    'Forward, backward and skipped-batch navigation must preserve the target snapshot',
  )
}
assert.equal(boardChanges(second, second).size, 0)
assert.equal(MAX_SIZE, 64)
assert(validSize(64))
assert(!validSize(65))
console.log(
  'Replay differences preserve additions, removals, replacements and direct jumps; size is capped at 64.',
)
