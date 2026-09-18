import type { Board } from './sudoku.ts'

export interface CellChange {
  from: number
  to: number
  kind: 'added' | 'removed' | 'replaced'
}

export function boardChanges(before: Board, after: Board): Map<number, CellChange> {
  const changes = new Map<number, CellChange>()
  after.forEach((to, index) => {
    const from = before[index] ?? 0
    if (from === to) return
    changes.set(index, { from, to, kind: !from ? 'added' : !to ? 'removed' : 'replaced' })
  })
  return changes
}
