import type { Board, Difficulty } from './sudoku.ts'

function propagate(board: Board, size: number, boxRows: number, boxCols: number, hidden: boolean) {
  const values = [...board]
  const units = Array.from({ length: size * 3 }, () => [] as number[])
  const memberships = values.map((_, index) => {
    const row = Math.floor(index / size),
      col = index % size
    const box = Math.floor(row / boxRows) * boxRows + Math.floor(col / boxCols)
    const groups = [row, size + col, size * 2 + box]
    for (const group of groups) units[group].push(index)
    return groups
  })
  const used = units.map((cells) => new Set(cells.map((index) => values[index]).filter(Boolean)))
  const counts = units.map(() => new Uint16Array(size + 1))
  const options = values.map((value, index) => {
    const choices = new Set<number>()
    if (value) return choices
    for (let digit = 1; digit <= size; digit++) {
      if (memberships[index].some((group) => used[group].has(digit))) continue
      choices.add(digit)
      for (const group of memberships[index]) counts[group][digit]++
    }
    return choices
  })
  const queue: [number, number][] = []
  let invalid = false

  function checkGroup(group: number, digit: number) {
    if (used[group].has(digit)) return
    if (!counts[group][digit]) invalid = true
    if (hidden && counts[group][digit] === 1) {
      const index = units[group].find((cell) => options[cell].has(digit))!
      queue.push([index, digit])
    }
  }
  function remove(index: number, digit: number) {
    if (!options[index].delete(digit)) return
    for (const group of memberships[index]) {
      counts[group][digit]--
      checkGroup(group, digit)
    }
    if (values[index]) return
    if (!options[index].size) invalid = true
    if (options[index].size === 1) queue.push([index, [...options[index]][0]])
  }
  function place(index: number, digit: number) {
    if (values[index]) {
      if (values[index] !== digit) invalid = true
      return
    }
    if (!options[index].has(digit)) {
      invalid = true
      return
    }
    values[index] = digit
    for (const group of memberships[index]) used[group].add(digit)
    for (const choice of [...options[index]]) remove(index, choice)
    for (const group of memberships[index]) {
      for (const cell of units[group]) remove(cell, digit)
    }
  }
  function drain() {
    while (queue.length && !invalid) {
      const [index, digit] = queue.pop()!
      place(index, digit)
    }
    if (invalid) throw new Error('Generated puzzle has conflicting deductions.')
  }
  for (const [index, choices] of options.entries()) {
    if (!values[index] && !choices.size) invalid = true
    if (choices.size === 1) queue.push([index, [...choices][0]])
  }
  for (let group = 0; group < units.length; group++) {
    for (let digit = 1; digit <= size; digit++) checkGroup(group, digit)
  }
  drain()
  return {
    values,
    addClue(index: number, digit: number) {
      place(index, digit)
      drain()
    },
  }
}

export function generateLarge(
  solution: Board,
  size: number,
  boxRows: number,
  boxCols: number,
  difficulty: Difficulty,
): Board {
  const removal = { Easy: 0.55, Medium: 0.7, Hard: 0.85 }[difficulty]
  for (let attempt = 0; attempt < 8; attempt++) {
    const puzzle = solution.map((value) => (Math.random() < removal ? 0 : value))
    const proof = propagate(puzzle, size, boxRows, boxCols, true)
    while (proof.values.includes(0)) {
      const unresolved = proof.values.flatMap((value, index) => (value ? [] : [index]))
      const index = unresolved[Math.floor(Math.random() * unresolved.length)]
      puzzle[index] = solution[index]
      proof.addClue(index, solution[index])
    }
    // Completing by forced moves proves uniqueness. Require more than naked singles.
    const basic = propagate(puzzle, size, boxRows, boxCols, false)
    const empty = puzzle.filter((value) => !value).length
    const unresolved = basic.values.filter((value) => !value).length
    if (unresolved >= Math.ceil(empty / 4)) return puzzle
  }
  throw new Error('Could not generate a puzzle beyond single candidates. Try again.')
}
