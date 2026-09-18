import { generateLarge } from './generateLarge.ts'

export type Size = number
export type Difficulty = 'Easy' | 'Medium' | 'Hard'
export type Board = number[]
export const MAX_SIZE = 64
export const MAX_BATCH_SIZE = 128
export const validSize = (size: number) => Number.isInteger(size) && size >= 2 && size <= MAX_SIZE
export function boxShape(size: Size) {
  let rows = Math.floor(Math.sqrt(size))
  while (size % rows) rows--
  return { rows, cols: size / rows }
}
export const symbol = (value: number) => String(value)
export const coordinate = (index: number, size: Size) =>
  `r${Math.floor(index / size) + 1}:c${(index % size) + 1}`

export function candidateMap(board: Board, size: Size): Map<number, Set<number>> {
  const shape = boxShape(size)
  const rows = Array.from({ length: size }, () => new Set<number>())
  const cols = Array.from({ length: size }, () => new Set<number>())
  const boxes = Array.from({ length: size }, () => new Set<number>())
  const boxAt = (row: number, col: number) =>
    Math.floor(row / shape.rows) * shape.rows + Math.floor(col / shape.cols)
  board.forEach((value, index) => {
    if (!value) return
    const row = Math.floor(index / size),
      col = index % size
    rows[row].add(value)
    cols[col].add(value)
    boxes[boxAt(row, col)].add(value)
  })
  const result = new Map<number, Set<number>>()
  board.forEach((value, index) => {
    if (value) return
    const row = Math.floor(index / size),
      col = index % size
    const options = new Set<number>()
    for (let digit = 1; digit <= size; digit++) {
      if (!rows[row].has(digit) && !cols[col].has(digit) && !boxes[boxAt(row, col)].has(digit))
        options.add(digit)
    }
    result.set(index, options)
  })
  return result
}

export function validBoard(board: Board, size: Size) {
  const { rows, cols } = boxShape(size)
  const groups = Array.from({ length: size * 3 }, () => new Set<number>())
  for (let index = 0; index < board.length; index++) {
    const value = board[index]
    if (!value) continue
    const row = Math.floor(index / size),
      col = index % size
    const box = Math.floor(row / rows) * rows + Math.floor(col / cols)
    for (const group of [groups[row], groups[size + col], groups[size * 2 + box]]) {
      if (group.has(value)) return false
      group.add(value)
    }
  }
  return true
}

export const emptyCells = (board: Board, size: Size) =>
  [...candidateMap(board, size)].map(([index, options]) => ({ index, options: [...options] }))
export const candidates = (board: Board, size: Size, index: number) => [
  ...(candidateMap(board, size).get(index) ?? []),
]

export function countSolutions(input: Board, size: Size, limit = 2, budget = 10_000): number {
  if (!validBoard(input, size)) return 0
  if (size > 16) {
    const board = [...input]
    let visited = 0
    function search(): number {
      if (++visited > budget) return limit
      const cells = emptyCells(board, size).sort((a, b) => a.options.length - b.options.length)
      if (!cells.length) return 1
      const cell = cells[0]
      let count = 0
      for (const value of cell.options) {
        board[cell.index] = value
        count += search()
        if (count >= limit) break
      }
      board[cell.index] = 0
      return Math.min(limit, count)
    }
    return search()
  }
  const shape = boxShape(size)
  const rows = new Uint32Array(size)
  const cols = new Uint32Array(size)
  const boxes = new Uint32Array(size)
  const blanks: { row: number; col: number; box: number }[] = []
  input.forEach((value, index) => {
    const row = Math.floor(index / size),
      col = index % size
    const box = Math.floor(row / shape.rows) * shape.rows + Math.floor(col / shape.cols)
    if (!value) blanks.push({ row, col, box })
    else {
      const bit = 1 << (value - 1)
      rows[row] |= bit
      cols[col] |= bit
      boxes[box] |= bit
    }
  })
  const full = (1 << size) - 1
  let visited = 0
  function search(depth: number): number {
    if (++visited > budget) return limit
    if (depth === blanks.length) return 1
    let selected = depth,
      fewest = size + 1,
      choices = 0
    for (let i = depth; i < blanks.length; i++) {
      const { row, col, box } = blanks[i]
      const mask = full & ~(rows[row] | cols[col] | boxes[box])
      if (!mask) return 0
      let count = 0
      for (let bits = mask; bits; bits &= bits - 1) count++
      if (count < fewest) {
        selected = i
        fewest = count
        choices = mask
      }
      if (count === 1) break
    }
    ;[blanks[depth], blanks[selected]] = [blanks[selected], blanks[depth]]
    const { row, col, box } = blanks[depth]
    let count = 0
    while (choices && count < limit) {
      const bit = choices & -choices
      choices &= ~bit
      rows[row] |= bit
      cols[col] |= bit
      boxes[box] |= bit
      count += search(depth + 1)
      rows[row] &= ~bit
      cols[col] &= ~bit
      boxes[box] &= ~bit
    }
    ;[blanks[depth], blanks[selected]] = [blanks[selected], blanks[depth]]
    return Math.min(limit, count)
  }
  return search(0)
}

function shuffle<T>(values: T[]): T[] {
  const result = [...values]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

export function generatePuzzle(size: Size, difficulty: Difficulty): Board {
  if (!validSize(size)) throw new Error(`Choose a size between 2 and ${MAX_SIZE}.`)
  const { rows, cols } = boxShape(size)
  const range = (length: number) => Array.from({ length }, (_, i) => i)
  const rowOrder = shuffle(range(size / rows)).flatMap((group) =>
    shuffle(range(rows)).map((row) => group * rows + row),
  )
  const colOrder = shuffle(range(size / cols)).flatMap((group) =>
    shuffle(range(cols)).map((col) => group * cols + col),
  )
  const digits = shuffle(range(size).map((i) => i + 1))
  const board = rowOrder.flatMap((row) =>
    colOrder.map((col) => digits[(row * cols + Math.floor(row / rows) + col) % size]),
  )
  if (size > 16) return generateLarge(board, size, rows, cols, difficulty)
  const target = Math.floor(size * size * { Easy: 0.35, Medium: 0.5, Hard: 0.62 }[difficulty])
  let removed = 0
  for (const index of shuffle(range(board.length))) {
    const value = board[index]
    board[index] = 0
    if (countSolutions(board, size) !== 1) board[index] = value
    else removed++
    if (removed >= target) break
  }
  return board
}

export interface Decision {
  index: number
  choice: number
  probabilities: Record<string, number> | null
  confidence: number | null
}
export interface Batch {
  requestedCells?: number
  requestId?: string
  decisions: Decision[]
  latency: number
  source: 'jev' | 'demo'
  request: unknown
  response: unknown
  usage: { inputTokens: number; outputTokens: number; cost: number | null }
  context: 'full' | 'local'
  model: string
}
export interface Round extends Batch {
  before: Board
  board: Board
  applied: number[]
  backtracks: number
  forced: number
  rejected?: number[]
  rejectedReasons?: Record<number, string>
  proposal?: Board
}
interface Frame {
  index: number
  speculative: boolean
}
export interface RejectedChoice {
  index: number
  choice: number
}
interface Rejection extends RejectedChoice {
  assumptions: RejectedChoice[]
}
export interface Run {
  board: Board
  frames: Frame[]
  rounds: Round[]
  rejections: Rejection[]
}
export const createRun = (board: Board): Run => ({
  board: [...board],
  frames: [],
  rounds: [],
  rejections: [],
})

function rejectedChoicesFor(board: Board, rejections: Rejection[]): RejectedChoice[] {
  return rejections
    .filter(
      (item) =>
        !board[item.index] &&
        item.assumptions.every((assumption) => board[assumption.index] === assumption.choice),
    )
    .map(({ index, choice }) => ({ index, choice }))
}

function excludeRejected(options: Map<number, Set<number>>, board: Board, rejections: Rejection[]) {
  const rejected = rejectedChoicesFor(board, rejections)
  for (const { index, choice } of rejected) options.get(index)?.delete(choice)
  return rejected
}

function rememberFailure(
  rejections: Rejection[],
  board: Board,
  earlier: Frame[],
  index: number,
  choice: number,
) {
  const assumptions = earlier
    .filter((frame) => frame.speculative)
    .map((frame) => ({ index: frame.index, choice: board[frame.index] }))
  const exists = rejections.some(
    (item) =>
      item.index === index &&
      item.choice === choice &&
      item.assumptions.length === assumptions.length &&
      item.assumptions.every(
        (value, i) =>
          value.index === assumptions[i].index && value.choice === assumptions[i].choice,
      ),
  )
  if (!exists) rejections.push({ index, choice, assumptions })
}

export function hasDeadEnd(options: Map<number, Set<number>>, size: Size): boolean {
  const shape = boxShape(size)
  const singles = Array.from({ length: size * 3 }, () => new Set<number>())
  for (const [index, values] of options) {
    if (!values.size) return true
    if (values.size !== 1) continue
    const value = [...values][0]
    const row = Math.floor(index / size),
      col = index % size
    const box = Math.floor(row / shape.rows) * shape.rows + Math.floor(col / shape.cols)
    for (const group of [singles[row], singles[size + col], singles[size * 2 + box]]) {
      if (group.has(value)) return true
      group.add(value)
    }
  }
  return false
}

export function prepareBatch(run: Run, size: Size, limit: number) {
  const board = [...run.board]
  const frames = [...run.frames]
  const rejections = [...run.rejections]
  let backtracks = 0
  let options = candidateMap(board, size)
  let rejectedChoices = excludeRejected(options, board, rejections)
  while (hasDeadEnd(options, size)) {
    let restored = false
    while (frames.length) {
      const previous = frames.pop()!
      const choice = board[previous.index]
      board[previous.index] = 0
      if (!previous.speculative) continue
      rememberFailure(rejections, board, frames, previous.index, choice)
      restored = true
      backtracks++
      break
    }
    if (!restored) throw new Error('No solution remains. Generate another board.')
    options = candidateMap(board, size)
    rejectedChoices = excludeRejected(options, board, rejections)
  }
  const targets = [...options.keys()].slice(0, limit)
  return { board, frames, rounds: run.rounds, rejections, targets, backtracks, rejectedChoices }
}

export function applyBatch(
  prepared: ReturnType<typeof prepareBatch>,
  size: Size,
  batch: Batch,
): Run {
  const { targets } = prepared
  if (
    batch.decisions.length !== targets.length ||
    new Set(batch.decisions.map((item) => item.index)).size !== targets.length ||
    batch.decisions.some((item) => !targets.includes(item.index))
  )
    throw new Error('Incomplete response. No moves applied.')
  const before = prepared.board
  const proposal = [...before]
  for (const decision of batch.decisions) proposal[decision.index] = decision.choice
  const board = [...before]
  const options = candidateMap(board, size)
  const rejections = [...prepared.rejections]
  excludeRejected(options, board, rejections)
  const forced = batch.decisions.filter((item) => options.get(item.index)?.size === 1).length
  const ranked = [...batch.decisions].sort(
    (a, b) =>
      options.get(a.index)!.size - options.get(b.index)!.size ||
      (b.confidence ?? 0) - (a.confidence ?? 0),
  )
  const frames = [...prepared.frames]
  const applied: number[] = []
  const rejected: number[] = []
  const rejectedReasons: Record<number, string> = {}
  const shape = boxShape(size)
  for (const decision of ranked) {
    const legal = options.get(decision.index)!
    if (!legal.has(decision.choice)) {
      rejected.push(decision.index)
      rejectedReasons[decision.index] = rejectedChoicesFor(board, rejections).some(
        (item) => item.index === decision.index && item.choice === decision.choice,
      )
        ? 'Previously rejected under these assumptions.'
        : 'Conflicts with a value in the row, column or box.'
      rememberFailure(rejections, board, frames, decision.index, decision.choice)
      continue
    }
    frames.push({ index: decision.index, speculative: legal.size > 1 })
    board[decision.index] = decision.choice
    applied.push(decision.index)
    options.delete(decision.index)
    const row = Math.floor(decision.index / size),
      col = decision.index % size
    const peers = new Set<number>()
    for (let i = 0; i < size; i++) {
      peers.add(row * size + i)
      peers.add(i * size + col)
      peers.add(
        (Math.floor(row / shape.rows) * shape.rows + Math.floor(i / shape.cols)) * size +
          Math.floor(col / shape.cols) * shape.cols +
          (i % shape.cols),
      )
    }
    peers.forEach((index) => {
      const values = options.get(index)
      if (values) {
        values.delete(decision.choice)
      }
    })
    excludeRejected(options, board, rejections)
  }
  if (hasDeadEnd(options, size)) {
    const lastGuess = frames.findLastIndex((frame) => frame.speculative)
    if (lastGuess >= 0) {
      const index = frames[lastGuess].index
      rememberFailure(rejections, board, frames.slice(0, lastGuess), index, board[index])
    }
  }
  return {
    board,
    frames,
    rejections,
    rounds: [
      ...prepared.rounds,
      {
        ...batch,
        before,
        board,
        proposal,
        applied,
        rejected,
        rejectedReasons,
        backtracks: prepared.backtracks,
        forced,
      },
    ],
  }
}
