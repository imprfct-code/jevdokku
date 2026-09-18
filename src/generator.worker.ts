import { generatePuzzle } from './sudoku'
self.onmessage = (event) => {
  try {
    const { size, difficulty } = event.data
    self.postMessage({ board: generatePuzzle(size, difficulty) })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Generation failed.' })
  }
}
