import { boxShape } from './sudoku.ts'
import type { Board, RejectedChoice } from './sudoku.ts'

export function makeRequest(
  board: Board,
  size: number,
  targets: number[],
  rejectedChoices: RejectedChoice[] = [],
) {
  const shape = boxShape(size)
  const values = Array.from({ length: size }, (_, index) => index + 1)
  const failures = rejectedChoices.filter(({ index }) => targets.includes(index))
  const fullBoard = Array.from({ length: size }, (_, row) =>
    board.slice(row * size, (row + 1) * size),
  )
  const context = JSON.stringify(fullBoard).length < 16_000 ? ('full' as const) : ('local' as const)
  return {
    context,
    request: {
      model: 'typesafe/jev-1.13',
      state: {
        task: 'Solve Sudoku. Each row, column and box must contain every integer from 1 to size exactly once. Zero marks an empty cell. Coordinates are 1-based.',
        size,
        boxRows: shape.rows,
        boxColumns: shape.cols,
        ...(failures.length
          ? {
              feedback:
                'These choices were rejected under the current earlier assumptions. Avoid repeating them. All values remain in the probability distribution; choose a value that satisfies the Sudoku rules.',
              rejectedChoices: failures.map(({ index, choice }) => ({
                row: Math.floor(index / size) + 1,
                column: (index % size) + 1,
                value: choice,
              })),
            }
          : {}),
        ...(context === 'full'
          ? { board: fullBoard }
          : {
              context:
                'Local rows, columns and boxes only; the complete board exceeds the context budget.',
              cells: targets.map((index) => {
                const row = Math.floor(index / size),
                  column = index % size
                return {
                  row: row + 1,
                  column: column + 1,
                  rowValues: fullBoard[row],
                  columnValues: fullBoard.map((values) => values[column]),
                  boxValues: Array.from(
                    { length: size },
                    (_, offset) =>
                      board[
                        (Math.floor(row / shape.rows) * shape.rows +
                          Math.floor(offset / shape.cols)) *
                          size +
                          Math.floor(column / shape.cols) * shape.cols +
                          (offset % shape.cols)
                      ],
                  ),
                }
              }),
            }),
      },
      questions: Object.fromEntries(
        targets.map((index) => [
          `cell_${index}`,
          {
            type: 'choice',
            instructions: `Choose the value for row ${Math.floor(index / size) + 1}, column ${(index % size) + 1}.`,
            criteria: Object.fromEntries(values.map((value) => [String(value), String(value)])),
          },
        ]),
      ),
    },
  }
}

export interface JevResponse {
  model?: string
  error?: { message?: string }
  usage?: { input_tokens?: number; output_tokens?: number; cost?: number }
  answers?: Record<
    string,
    { choice?: unknown; probabilities?: Record<string, unknown>; confidence?: unknown }
  >
}

export function readDecisions(response: JevResponse, targets: number[], size: number) {
  const isProbability = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
  const values = Array.from({ length: size }, (_, index) => index + 1)
  const decisions = targets.map((index) => {
    const answer = response.answers?.[`cell_${index}`]
    const probabilities = answer?.probabilities
    if (
      !answer ||
      !values.includes(Number(answer.choice)) ||
      !probabilities ||
      Object.keys(probabilities).length !== size ||
      values.some((value) => !isProbability(probabilities[String(value)])) ||
      !isProbability(answer.confidence) ||
      Math.abs(
        Object.values(probabilities).reduce<number>((sum, value) => sum + Number(value), 0) - 1,
      ) > 0.03
    )
      return null
    return {
      index,
      choice: Number(answer.choice),
      probabilities: probabilities as Record<string, number>,
      confidence: answer.confidence,
    }
  })
  return decisions.some((item) => !item) ? null : decisions.filter((item) => item !== null)
}
