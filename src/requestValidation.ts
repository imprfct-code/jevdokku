import { candidateMap, hasDeadEnd, MAX_BATCH_SIZE, validBoard, validSize } from './sudoku.ts'
import type { RejectedChoice } from './sudoku.ts'

export function parseDecisionInput(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('Invalid request.')
  const input = value as Record<string, unknown>
  const { board, size, targets, rejectedChoices = [] } = input
  if (
    typeof size !== 'number' ||
    !validSize(size) ||
    !Array.isArray(board) ||
    board.length !== size * size ||
    board.some((cell) => !Number.isInteger(cell) || cell < 0 || cell > size) ||
    !Array.isArray(targets) ||
    !targets.length ||
    targets.length > MAX_BATCH_SIZE ||
    new Set(targets).size !== targets.length ||
    targets.some(
      (index) => !Number.isInteger(index) || index < 0 || index >= board.length || board[index],
    )
  )
    throw new Error(`Invalid board or batch. Use 1–${MAX_BATCH_SIZE} empty cells.`)
  if (!validBoard(board, size)) throw new Error('Board contains conflicting values.')
  if (
    !Array.isArray(rejectedChoices) ||
    rejectedChoices.length > size ** 3 ||
    rejectedChoices.some(
      (item) =>
        !item ||
        !Number.isInteger(item.index) ||
        item.index < 0 ||
        item.index >= board.length ||
        board[item.index] ||
        !Number.isInteger(item.choice) ||
        item.choice < 1 ||
        item.choice > size,
    )
  )
    throw new Error('Invalid rejected choices.')
  const options = candidateMap(board, size)
  for (const { index, choice } of rejectedChoices) options.get(index)?.delete(choice)
  if (hasDeadEnd(options, size))
    throw new Error('The board has a dead end. Roll back before requesting another batch.')
  if (input.keyMode === 'personal' || input.apiKey)
    throw new Error('Personal keys connect directly to OpenRouter from the browser.')
  return {
    board: board as number[],
    size,
    targets: targets as number[],
    rejectedChoices: rejectedChoices as RejectedChoice[],
    runId:
      typeof input.runId === 'string' && /^[a-z0-9-]{1,64}$/i.test(input.runId)
        ? input.runId
        : null,
  }
}
