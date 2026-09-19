import { useEffect, useRef, useState } from 'react'
import { ArrowLeft } from 'lucide-react'

interface Stats {
  runs: number
  requests: number
  inputTokens: number
  outputTokens: number
  cost: number
}

export default function Info({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    dialog.current?.showModal()
    const controller = new AbortController()
    async function refresh() {
      try {
        const response = await fetch('/api/stats', {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
        })
        if (!response.ok) throw new Error('Stats unavailable')
        setStats(await response.json())
        setUnavailable(false)
      } catch {
        if (!controller.signal.aborted) setUnavailable(true)
      }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 15_000)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [])
  const count = (value: number | undefined) => (value === undefined ? '—' : value.toLocaleString())
  return (
    <dialog className="info-page" ref={dialog} onCancel={onClose} aria-labelledby="info-title">
      <div className="info-content">
        <button className="info-back" onClick={onClose}>
          <ArrowLeft size={16} /> back
        </button>
        <h1 id="info-title">info</h1>
        <p className="info-intro">
          fully vibe-coded. i got curious whether jev could solve sudoku, so i let it try. change
          the board size and see how far it gets.
        </p>
        <section className="info-ledger" aria-label="Shared access statistics">
          <div className="info-section-heading">
            <span>shared access</span>
            {unavailable && <span role="status">unavailable</span>}
          </div>
          <dl>
            <div>
              <dt>runs</dt>
              <dd>{count(stats?.runs)}</dd>
            </div>
            <div>
              <dt>requests</dt>
              <dd>{count(stats?.requests)}</dd>
            </div>
            <div>
              <dt>spent</dt>
              <dd>{stats ? `$${stats.cost.toFixed(4)}` : '—'}</dd>
            </div>
            <div>
              <dt>tokens in</dt>
              <dd>{count(stats?.inputTokens)}</dd>
            </div>
            <div>
              <dt>tokens out</dt>
              <dd>{count(stats?.outputTokens)}</dd>
            </div>
          </dl>
        </section>
        <nav className="info-socials" aria-label="Social links">
          <a
            href="https://x.com/imprfct_dev"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="X profile"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
              <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.64 7.584H.472l8.6-9.835L0 1.154h7.594l5.243 6.932 6.064-6.933Zm-1.29 19.49h2.039L6.487 3.24H4.3l13.31 17.403Z" />
            </svg>
            <span>x</span>
          </a>
          <a
            href="https://github.com/imprfct-code/jevdokku"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub repository"
          >
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
              <path d="M12 .297C5.37.297 0 5.67 0 12.297c0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.043-1.61-4.043-1.61-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.084 1.838 1.237 1.838 1.237 1.07 1.835 2.809 1.305 3.495.998.108-.776.418-1.305.762-1.605-2.665-.305-5.467-1.334-5.467-5.93 0-1.31.467-2.382 1.235-3.222-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23a11.52 11.52 0 0 1 3.003-.404c1.02.005 2.045.138 3.003.404 2.291-1.552 3.297-1.23 3.297-1.23.654 1.652.243 2.873.12 3.176.77.84 1.233 1.912 1.233 3.222 0 4.609-2.807 5.622-5.479 5.919.43.372.823 1.102.823 2.222 0 1.606-.015 2.898-.015 3.293 0 .322.216.694.825.576C20.565 22.092 24 17.595 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            <span>github</span>
          </a>
        </nav>
      </div>
    </dialog>
  )
}
