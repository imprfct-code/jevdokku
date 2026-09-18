import { useLayoutEffect, useRef } from 'react'
import type { Round } from './sudoku'

const icons = {
  check: 'M2 7h2v2H2zM4 9h2v2H4zM6 11h2v2H6zM8 9h2v2H8zM10 7h2v2h-2zM12 5h2v2h-2zM14 3h2v2h-2z',
  clock:
    'M4 1h8v2H4zM2 3h2v2H2zM12 3h2v2h-2zM1 5h2v6H1zM13 5h2v6h-2zM2 11h2v2H2zM12 11h2v2h-2zM4 13h8v2H4zM7 4h2v4h3v2H7z',
  batches: 'M2 2h10v2H2zM2 4h2v6H2zM10 4h2v6h-2zM2 10h10v2H2zM13 5h2v10H5v-2h8z',
  tokens:
    'M5 1h6v2H5zM3 3h2v2H3zM11 3h2v2h-2zM1 5h2v6H1zM13 5h2v6h-2zM3 11h2v2H3zM11 11h2v2h-2zM5 13h6v2H5zM5 5h6v2H9v4H7V7H5z',
  rollback:
    'M5 1h2v2H5zM3 3h2v2H3zM1 5h10v2H1zM3 7h2v2H3zM5 9h2v2H5zM11 7h2v2h-2zM13 9h2v4h-2zM11 13h2v2H5v-2z',
  cost: 'M7 1h2v2h4v2H5v2h6v2H5V7H3V5h2V3h2zM11 9h2v4h-2v2H9v1H7v-1H3v-2h8z',
  close:
    'M3 3h2v2H3zM5 5h2v2H5zM7 7h2v2H7zM9 9h2v2H9zM11 11h2v2h-2zM11 3h2v2h-2zM9 5h2v2H9zM5 9h2v2H5zM3 11h2v2H3z',
}

function PixelIcon({ name }: { name: keyof typeof icons }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="currentColor"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      <path d={icons[name]} />
    </svg>
  )
}

export default function SolveSummary({
  elapsedMs,
  rounds,
  onClose,
}: {
  elapsedMs: number
  rounds: Round[]
  onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const pressedOutside = useRef(false)
  useLayoutEffect(() => {
    const element = dialog.current!
    const viewport = element.parentElement!.querySelector<HTMLElement>('.board-viewport')!
    const position = () => {
      const bounds = viewport.getBoundingClientRect()
      element.style.left = `${bounds.left + bounds.width / 2}px`
      element.style.top = `${bounds.top + bounds.height / 2}px`
      element.style.width = `${Math.min(320, Math.max(0, bounds.width - 32))}px`
      element.style.maxHeight = `${Math.max(0, bounds.height - 24)}px`
    }
    position()
    element.showModal()
    const observer = new ResizeObserver(position)
    observer.observe(viewport)
    window.addEventListener('resize', position)
    window.addEventListener('scroll', position, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', position)
      window.removeEventListener('scroll', position, true)
      element.close()
    }
  }, [])
  const seconds = elapsedMs / 1000
  const duration =
    seconds < 60
      ? `${seconds.toFixed(1)}s`
      : `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
  const cost = rounds.reduce((sum, round) => sum + (round.usage.cost ?? 0), 0)
  const unknownCost = rounds.some((round) => round.usage.cost === null)
  const inputTokens = rounds.reduce((sum, round) => sum + round.usage.inputTokens, 0)
  const outputTokens = rounds.reduce((sum, round) => sum + round.usage.outputTokens, 0)
  const backtracks = rounds.reduce((sum, round) => sum + round.backtracks, 0)
  return (
    <dialog
      ref={dialog}
      className="solve-dialog"
      aria-labelledby="solve-summary-title"
      onCancel={onClose}
      onPointerDown={(event) => {
        pressedOutside.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        if (pressedOutside.current && event.target === event.currentTarget) onClose()
      }}
    >
      <div className="solve-summary">
        <div className="solve-summary-content">
          <div className="solve-summary-heading">
            <span className="solve-check">
              <PixelIcon name="check" />
            </span>
            <h2 id="solve-summary-title">solved</h2>
            <span
              className="solve-duration"
              title="Time spent requesting and checking answers. Excludes pauses, replay and display animations."
            >
              <PixelIcon name="clock" />
              {duration}
            </span>
          </div>
          <dl className="solve-summary-stats">
            <div>
              <dt>
                <PixelIcon name="batches" />
                batches
              </dt>
              <dd>{rounds.length}</dd>
            </div>
            <div>
              <dt>
                <PixelIcon name="rollback" />
                rollbacks
              </dt>
              <dd>{backtracks}</dd>
            </div>
            <div>
              <dt>
                <PixelIcon name="tokens" />
                input tokens
              </dt>
              <dd>{inputTokens.toLocaleString()}</dd>
            </div>
            <div>
              <dt>
                <PixelIcon name="tokens" />
                output tokens
              </dt>
              <dd>{outputTokens.toLocaleString()}</dd>
            </div>
            <div>
              <dt>
                <PixelIcon name="cost" />
                cost
              </dt>
              <dd className="solve-cost">
                ${cost.toFixed(6)}
                {unknownCost ? ' + unknown' : ''}
              </dd>
            </div>
          </dl>
        </div>
        <button className="icon-button" aria-label="Dismiss solved summary" onClick={onClose}>
          <PixelIcon name="close" />
        </button>
      </div>
    </dialog>
  )
}
