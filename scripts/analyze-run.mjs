import fs from 'node:fs'
import { candidateMap, countSolutions, validBoard } from '../src/sudoku.ts'
const trace = JSON.parse(fs.readFileSync(process.argv[2] || 'logs/previous-run.json', 'utf8'))
function solve(b, n) {
  const cells = [...candidateMap(b, n)].sort((a, b) => a[1].size - b[1].size)
  if (!cells.length) return b
  const [i, opts] = cells[0]
  for (const v of opts) {
    const next = [...b]
    next[i] = v
    const result = solve(next, n)
    if (result) return result
  }
  return null
}
const solution = solve(trace.initial, trace.size)
let errors = 0
for (const [i, r] of trace.rounds.entries()) {
  const wrong = r.decisions.filter((d) => d.choice !== solution[d.index])
  errors += wrong.length
  const rawMismatch = r.decisions.filter(
    (d) => Number(r.response.answers[`cell_${d.index}`].choice) !== d.choice,
  ).length
  const choices = [...r.before]
  for (const d of r.decisions) choices[d.index] = d.choice
  const first = r.decisions.filter(
    (d) => d.choice === Math.min(...candidateMap(r.before, trace.size).get(d.index)),
  ).length
  console.log(
    JSON.stringify({
      batch: i + 1,
      questions: r.decisions.length,
      wrong: wrong.length,
      applied: r.applied.length,
      wrongApplied: wrong.filter((d) => r.applied.includes(d.index)).length,
      rawMismatch,
      compatible: validBoard(choices, trace.size),
      firstOption: first,
      examples: wrong.slice(0, 3).map((d) => ({
        index: d.index,
        choice: d.choice,
        correct: solution[d.index],
        p: d.probabilities[String(d.choice)],
      })),
    }),
  )
}
console.log(
  JSON.stringify({
    unique: countSolutions(trace.initial, trace.size) === 1,
    rounds: trace.rounds.length,
    errors,
  }),
)
if (errors) process.exitCode = 1
