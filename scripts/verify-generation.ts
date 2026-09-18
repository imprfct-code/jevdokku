import assert from 'node:assert/strict'
import {
  boxShape,
  candidateMap,
  countSolutions,
  generatePuzzle,
  validBoard,
} from '../src/sudoku.ts'
import type { Difficulty } from '../src/sudoku.ts'

let seed = 20260918
Math.random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
const sizes = [2, 3, 4, 6, 7, 9, 12, 16, 17, 25, 31, 32, 64]
for (const size of sizes) {
  const started = performance.now()
  for (const difficulty of ['Easy', 'Medium', 'Hard'] satisfies Difficulty[]) {
    const board = generatePuzzle(size, difficulty)
    assert(board.includes(0), `${size}: puzzle must have empty cells`)
    assert(validBoard(board, size), `${size}: conflicting clues`)
    if (size <= 16) {
      assert.equal(countSolutions(board, size, 2, 1_000_000), 1, `${size}: not unique`)
    } else {
      const solved = [...board]
      let neededHiddenSingle = false
      while (solved.includes(0)) {
        const options = candidateMap(solved, size)
        const moves = new Map(
          [...options]
            .filter(([, values]) => values.size === 1)
            .map(([index, values]) => [index, [...values][0]]),
        )
        if (!moves.size) {
          if (!neededHiddenSingle) {
            assert(
              options.size >= Math.ceil(board.filter((value) => !value).length / 4),
              `${size}: too much of the puzzle is solved by naked singles`,
            )
          }
          neededHiddenSingle = true
          const shape = boxShape(size)
          const groups = Array.from({ length: size * 3 }, () => new Map<number, number[]>())
          for (const [index, values] of options) {
            const row = Math.floor(index / size),
              col = index % size
            const box = Math.floor(row / shape.rows) * shape.rows + Math.floor(col / shape.cols)
            for (const group of [groups[row], groups[size + col], groups[size * 2 + box]]) {
              for (const value of values) group.set(value, [...(group.get(value) ?? []), index])
            }
          }
          for (const group of groups) {
            for (const [value, cells] of group) {
              if (cells.length !== 1) continue
              assert(
                !moves.has(cells[0]) || moves.get(cells[0]) === value,
                'Forced values must agree',
              )
              moves.set(cells[0], value)
            }
          }
        }
        assert(moves.size, `${size}: uniqueness proof stalled`)
        for (const [index, value] of moves) solved[index] = value
        assert(validBoard(solved, size), `${size}: forced moves conflict`)
      }
      assert(
        neededHiddenSingle,
        `${size} ${difficulty}: local candidate filtering solves the whole puzzle`,
      )
    }
  }
  console.log(
    `${size}x${size}: unique at all 3 densities (${Math.round(performance.now() - started)} ms)`,
  )
}
assert.equal(countSolutions(Array(16).fill(0), 4), 2, 'Must detect multiple solutions')
assert.equal(countSolutions([1, 1, ...Array(14).fill(0)], 4), 0, 'Must reject conflicting clues')
