import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Code2,
  LoaderCircle,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  Shuffle,
  SkipForward,
  X,
} from 'lucide-react'
import BoardCanvas from './BoardCanvas'
import type { Phase } from './BoardCanvas'
import {
  applyBatch,
  boxShape,
  candidateMap,
  coordinate,
  createRun,
  generatePuzzle,
  MAX_SIZE,
  MAX_BATCH_SIZE,
  prepareBatch,
  validSize,
  validBoard,
} from './sudoku'
import type { Board, Difficulty, Round } from './sudoku'
import { askJev, RateLimitError } from './jev'
import { makeRequest } from './protocol'
import Info from './Info'
import SolveSummary from './SolveSummary'
import './App.css'

function stats(round: Round | null) {
  const values =
    round?.decisions.flatMap((item) =>
      item.probabilities ? [item.probabilities[String(item.choice)]] : [],
    ) ?? []
  const bins = Array<number>(10).fill(0)
  for (const value of values) bins[Math.min(9, Math.floor(value * 10))]++
  return {
    bins,
    mean: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
    min: values.length ? Math.min(...values) : null,
  }
}
const percent = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`)

function App() {
  const [size, setSize] = useState(9)
  const [sizeInput, setSizeInput] = useState('9')
  const [difficulty, setDifficulty] = useState<Difficulty>('Medium')
  const [initial, setInitial] = useState(() => generatePuzzle(9, 'Medium'))
  const [comparisonBoard, setComparisonBoard] = useState<Board>(initial)
  const [transitionMs, setTransitionMs] = useState(0)
  const [runId, setRunId] = useState(() => crypto.randomUUID())
  const [run, setRun] = useState(() => createRun(initial))
  const [cursor, setCursor] = useState(0)
  const [solvedTime, setSolvedTime] = useState<number | null>(null)
  const solveClock = useRef({ elapsed: 0, started: null as number | null })
  const [apiKey, setApiKey] = useState('')
  const [personalKey, setPersonalKey] = useState('')
  const personalConnected = Boolean(personalKey)
  const [info, setInfo] = useState(window.location.hash === '#info')
  const [serverKey, setServerKey] = useState(false)
  const [configLoaded, setConfigLoaded] = useState(false)
  const [settings, setSettings] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [phase, setPhase] = useState<Phase>('idle')
  const [targets, setTargets] = useState<number[]>([])
  const [pendingRequest, setPendingRequest] = useState<unknown>(null)
  const [batchSize, setBatchSize] = useState(64)
  const [speed, setSpeed] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [viewReset, setViewReset] = useState(0)
  const [highlight, setHighlight] = useState<number | null>(null)
  const [selectedCell, setSelectedCell] = useState<number | null>(null)
  const [requestLimit, setRequestLimit] = useState(64)
  const [tab, setTab] = useState<'batch' | 'payload' | 'history'>('batch')
  const [payloadTab, setPayloadTab] = useState<'request' | 'response'>('request')
  const [error, setError] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const retryCount = useRef(0)
  const [replayId, setReplayId] = useState(0)
  const playbackOnly = useRef(false)
  const epoch = useRef(0)
  const pending = useRef(false)
  const controller = useRef<AbortController | null>(null)
  const worker = useRef<Worker | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const round = cursor ? run.rounds[cursor - 1] : null
  const board =
    phase === 'request' || phase === 'response' ? comparisonBoard : (round?.board ?? initial)
  const done = !run.board.includes(0)
  const connected = personalConnected || serverKey
  const inspectedRound = phase === 'request' ? null : round
  const inspectedDecisions =
    inspectedRound?.decisions ??
    (phase === 'request'
      ? targets.map((index) => ({ index, choice: null, probabilities: null }))
      : [])
  const probabilityIndex = selectedCell ?? highlight ?? inspectedDecisions[0]?.index ?? null
  const distribution = inspectedDecisions.find((item) => item.index === probabilityIndex)
  const beforeOptions = useMemo(
    () => (inspectedRound ? candidateMap(inspectedRound.before, size) : null),
    [inspectedRound, size],
  )
  const summary = stats(inspectedRound)
  const totals = run.rounds.reduce(
    (sum, item) => ({
      input: sum.input + item.usage.inputTokens,
      output: sum.output + item.usage.outputTokens,
      cost: sum.cost + (item.usage.cost ?? 0),
      unknown: sum.unknown || (item.source === 'jev' && item.usage.cost === null),
    }),
    { input: 0, output: 0, cost: 0, unknown: false },
  )
  const cost = totals.cost
  const animationMs = speed ? 650 / speed : 0
  const shape = boxShape(size)

  useEffect(() => {
    const configController = new AbortController()
    const refreshConfig = async () => {
      try {
        const response = await fetch('/api/config', {
          signal: AbortSignal.any([configController.signal, AbortSignal.timeout(10_000)]),
        })
        if (!response.ok) throw new Error('Cannot load server settings.')
        const data = await response.json()
        if (!configController.signal.aborted) setServerKey(data.hasKey === true)
      } catch {
        if (!configController.signal.aborted) setServerKey(false)
      } finally {
        if (!configController.signal.aborted) setConfigLoaded(true)
      }
    }
    void refreshConfig()
    const configTimer = window.setInterval(() => void refreshConfig(), 15_000)
    return () => {
      configController.abort()
      window.clearInterval(configTimer)
      controller.current?.abort()
      worker.current?.terminate()
    }
  }, [])
  useEffect(() => {
    const change = () => setInfo(window.location.hash === '#info')
    window.addEventListener('hashchange', change)
    return () => window.removeEventListener('hashchange', change)
  }, [])
  useEffect(() => {
    if (settings) dialog.current?.showModal()
    else dialog.current?.close()
  }, [settings])
  useEffect(() => {
    if (!cooldown) return
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  function stopSolveClock() {
    const clock = solveClock.current
    if (clock.started !== null) {
      clock.elapsed += performance.now() - clock.started
      clock.started = null
    }
    return clock.elapsed
  }
  function pause() {
    stopSolveClock()
    epoch.current++
    controller.current?.abort()
    pending.current = false
    setCooldown(0)
    retryCount.current = 0
    setPlaying(false)
    playbackOnly.current = false
    setBusy(false)
    setPhase('idle')
  }
  function reset(puzzle = initial) {
    pause()
    solveClock.current = { elapsed: 0, started: null }
    setSolvedTime(null)
    setRunId(crypto.randomUUID())
    setRun(createRun(puzzle))
    setComparisonBoard(puzzle)
    setCursor(0)
    setTargets([])
    setHighlight(null)
    setSelectedCell(null)
    setError('')
  }
  function newBoard(nextSize = size, nextDifficulty = difficulty) {
    if (!validSize(nextSize)) {
      setError(`Size must be an integer from 2 to ${MAX_SIZE}.`)
      return
    }
    pause()
    worker.current?.terminate()
    setGenerating(true)
    setSizeInput(String(nextSize))
    setDifficulty(nextDifficulty)
    setError('')
    const generator = new Worker(new URL('./generator.worker.ts', import.meta.url), {
      type: 'module',
    })
    worker.current = generator
    generator.onmessage = (event) => {
      if (worker.current !== generator) return
      if (event.data.error) setError(event.data.error)
      else {
        setSize(nextSize)
        setDifficulty(nextDifficulty)
        setInitial(event.data.board)
        reset(event.data.board)
        setZoom(1)
        setViewReset((value) => value + 1)
      }
      setGenerating(false)
      generator.terminate()
      worker.current = null
    }
    generator.onerror = () => {
      if (worker.current !== generator) return
      worker.current = null
      setError('Board generation failed. Try a smaller size.')
      setGenerating(false)
      generator.terminate()
    }
    generator.postMessage({ size: nextSize, difficulty: nextDifficulty })
  }
  const wait = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration))
  async function replay(position: number, automatic = false) {
    const from =
      position === cursor ? (position > 1 ? run.rounds[position - 2].board : initial) : board
    if (!automatic) pause()
    const currentEpoch = epoch.current
    const duration = automatic ? animationMs : Math.min(140, animationMs)
    setComparisonBoard(from)
    setTransitionMs(duration)
    setCursor(position)
    setHighlight(null)
    setReplayId((value) => value + 1)
    setPhase('apply')
    if (duration) {
      setBusy(true)
      await wait(duration)
      if (epoch.current !== currentEpoch) return
    }
    setBusy(false)
    setPhase('idle')
  }
  async function nextBatch() {
    if (pending.current || busy || generating || cooldown) return
    if (cursor < run.rounds.length) {
      await replay(cursor + 1, true)
      return
    }
    if (done || playbackOnly.current) {
      setPlaying(false)
      return
    }
    if (!connected) {
      setSettings(true)
      setPlaying(false)
      return
    }
    pending.current = true
    solveClock.current.started = performance.now()
    setBusy(true)
    setError('')
    setTab('batch')
    setHighlight(null)
    const currentEpoch = epoch.current
    const abort = new AbortController()
    controller.current = abort
    try {
      let limit = batchSize
      let prepared = prepareBatch(run, size, limit)
      while (
        JSON.stringify(
          makeRequest(prepared.board, size, prepared.targets, prepared.rejectedChoices).request,
        ).length > 46_000 &&
        limit > 1
      ) {
        limit = Math.max(1, Math.floor(limit / 2))
        prepared = prepareBatch(run, size, limit)
      }
      setComparisonBoard(run.board)
      setRequestLimit(limit)
      setTransitionMs(animationMs)
      setPendingRequest(
        makeRequest(prepared.board, size, prepared.targets, prepared.rejectedChoices).request,
      )
      setTargets(prepared.targets)
      setPhase('request')
      const batch = await askJev(
        prepared.board,
        size,
        prepared.targets,
        abort.signal,
        runId,
        prepared.rejectedChoices,
        personalKey,
      )
      if (currentEpoch !== epoch.current) return
      retryCount.current = 0
      const next = applyBatch(prepared, size, {
        ...batch,
        requestedCells: Math.min(batchSize, prepared.board.filter((value) => !value).length),
      })
      const elapsed = stopSolveClock()
      if (!next.board.includes(0) && validBoard(next.board, size)) setSolvedTime(elapsed)
      const stalled = !next.rounds.at(-1)!.applied.length
      setRun(next)
      setCursor(next.rounds.length)
      setPhase('response')
      setReplayId((value) => value + 1)
      if (animationMs) await wait(220 / speed)
      if (currentEpoch !== epoch.current) return
      setPhase('apply')
      if (animationMs) await wait(animationMs)
      if (currentEpoch !== epoch.current) return
      setPhase('idle')
      if (!next.board.includes(0) || stalled) setPlaying(false)
      if (stalled) setError('Jev made no valid placements. Run paused.')
    } catch (cause) {
      if (currentEpoch === epoch.current) {
        setPhase('idle')
        if (cause instanceof RateLimitError && playing && retryCount.current < 5) {
          retryCount.current++
          setCooldown(Math.max(cause.retryAfter, Math.min(60, 5 * 2 ** retryCount.current)))
        } else {
          setError(cause instanceof Error ? cause.message : 'Batch failed.')
          setPlaying(false)
        }
      }
    } finally {
      if (currentEpoch === epoch.current) {
        stopSolveClock()
        pending.current = false
        setBusy(false)
      }
    }
  }
  useEffect(() => {
    if (!playing || busy || generating || cooldown) return
    const timer = window.setTimeout(() => {
      void nextBatch()
    }, 30)
    return () => window.clearTimeout(timer)
  })

  function playFromStart() {
    pause()
    if (!run.rounds.length) {
      if (!connected) setSettings(true)
      else setPlaying(true)
      return
    }
    playbackOnly.current = true
    setComparisonBoard(initial)
    setCursor(0)
    setPlaying(true)
  }

  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (
        info ||
        settings ||
        generating ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        target?.closest('dialog, input, select, textarea, [contenteditable="true"]')
      )
        return
      if (event.code === 'Space') {
        event.preventDefault()
        if (event.repeat) return
        if (playing || busy) pause()
        else playFromStart()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const direction = event.key === 'ArrowLeft' ? -1 : 1
        void replay(Math.max(0, Math.min(run.rounds.length, cursor + direction)))
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  })

  function exportRun() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            runId,
            size,
            boxes: shape,
            difficulty,
            initial,
            uniqueness: 'verified',
            proof: size <= 16 ? 'solution-count' : 'single-propagation',
            totals,
            rounds: run.rounds,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `jevdokku-${size}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  function connectKey() {
    const key = apiKey.trim()
    if (key.length < 16 || key.length > 512 || /\s/.test(key)) {
      setError('Enter a valid OpenRouter key.')
      return
    }
    setPersonalKey(key)
    setApiKey('')
    setError('')
  }
  function disconnectKey() {
    setPersonalKey('')
    setApiKey('')
  }

  return (
    <main className="app">
      <header className="header">
        <a href="/" className="wordmark">
          <img className="pixel-mark" src="/jevdokku.svg?v=5" alt="" />
          jevdokku
        </a>
        <div className="header-right">
          <a
            className="info-link"
            href="#info"
            onClick={() => {
              pause()
              setInfo(true)
            }}
          >
            info
          </a>
          <button
            className="icon-button"
            title="Settings"
            aria-label="Settings"
            onClick={() => {
              pause()
              setSettings(true)
            }}
          >
            <Settings2 size={16} />
          </button>
        </div>
      </header>
      <div className="toolbar">
        <div className="board-controls">
          <label className="size-input">
            size
            <input
              aria-label="Board size"
              type="number"
              min={2}
              max={MAX_SIZE}
              value={sizeInput}
              onChange={(event) => {
                const input = event.target.value
                const nextSize = Math.min(MAX_SIZE, Number(input))
                setSizeInput(Number(input) > MAX_SIZE ? String(MAX_SIZE) : input)
                if (validSize(nextSize)) {
                  if (nextSize !== size || generating) newBoard(nextSize)
                } else {
                  worker.current?.terminate()
                  worker.current = null
                  setGenerating(false)
                }
              }}
              onBlur={() => {
                if (!validSize(Number(sizeInput))) setSizeInput(String(size))
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') newBoard(Number(sizeInput))
              }}
            />
          </label>
          <div className="difficulty-options" role="group" aria-label="Difficulty">
            {(['Easy', 'Medium', 'Hard'] as const).map((value) => (
              <button
                key={value}
                aria-pressed={difficulty === value}
                disabled={generating}
                onClick={() => {
                  if (value !== difficulty || Number(sizeInput) !== size)
                    newBoard(Number(sizeInput), value)
                }}
              >
                {value.toLowerCase()}
              </button>
            ))}
          </div>
          <button
            className="icon-button"
            title="New board"
            aria-label="New board"
            disabled={generating}
            onClick={() => newBoard(Number(sizeInput))}
          >
            <Shuffle size={16} />
          </button>
        </div>
        <div className="run-controls" data-generating={generating}>
          <button
            className="icon-button"
            title="Reset"
            aria-label="Reset run"
            onClick={() => reset()}
          >
            <RotateCcw size={15} />
          </button>
          <button
            className="button secondary"
            aria-label="Next batch"
            onClick={() => {
              setPlaying(false)
              playbackOnly.current = false
              void nextBatch()
            }}
            disabled={busy || generating || !configLoaded || (done && cursor === run.rounds.length)}
          >
            <SkipForward size={14} />
            <span>next batch</span>
          </button>
          <button
            className="button primary"
            disabled={generating || !configLoaded}
            onClick={() => {
              if (playing || busy) pause()
              else if (done) playFromStart()
              else if (!connected) setSettings(true)
              else {
                playbackOnly.current = false
                setPlaying(true)
              }
            }}
          >
            {playing || busy ? <Pause size={14} /> : <Play size={14} />}
            {playing || busy ? 'pause' : done || cursor < run.rounds.length ? 'replay' : 'run'}
          </button>
        </div>
      </div>
      <div className="workspace">
        <section className="board-panel">
          <div className="board-top">
            <span className="board-title">
              {size} × {size}
            </span>
            <span className="board-progress">
              {board.filter(Boolean).length}
              <span> / {board.length}</span>
            </span>
            <span className={`phase-label ${busy ? 'working' : ''}`}>
              {generating
                ? 'generating'
                : cooldown
                  ? `retry in ${cooldown}s`
                  : phase !== 'idle'
                    ? phase
                    : done && cursor === run.rounds.length
                      ? 'complete'
                      : playing
                        ? 'running'
                        : 'ready'}
            </span>
            <div className="zoom-controls">
              <button
                className="icon-button"
                aria-label="Zoom out"
                disabled={zoom <= 1}
                onClick={() => setZoom((value) => Math.max(1, value / 1.5))}
              >
                <Minus size={13} />
              </button>
              <button
                className="zoom-value"
                title="Fit board"
                onClick={() => {
                  setZoom(1)
                  setViewReset((value) => value + 1)
                }}
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                className="icon-button"
                aria-label="Zoom in"
                disabled={zoom >= 16}
                onClick={() => setZoom((value) => Math.min(16, value * 1.5))}
              >
                <Plus size={13} />
              </button>
            </div>
          </div>
          <BoardCanvas
            board={board}
            comparisonBoard={comparisonBoard}
            applied={round?.applied}
            initial={initial}
            size={size}
            targets={targets}
            phase={phase}
            zoom={zoom}
            onZoom={setZoom}
            key={`${size}-${viewReset}`}
            highlight={selectedCell ?? highlight ?? distribution?.index ?? null}
            onHighlight={setHighlight}
            onSelect={setSelectedCell}
            animationMs={transitionMs}
            replayId={replayId}
            cost={cost}
            costUnknown={totals.unknown}
          />
          {solvedTime !== null &&
            done &&
            cursor === run.rounds.length &&
            phase === 'idle' &&
            !generating && (
              <SolveSummary
                elapsedMs={solvedTime}
                rounds={run.rounds}
                onClose={() => setSolvedTime(null)}
              />
            )}
          {generating && (
            <div className="generation-overlay">
              <LoaderCircle className="spin" size={22} />
            </div>
          )}
          <div className="replay-controls">
            <button
              className="icon-button"
              aria-label="Previous batch"
              disabled={!cursor}
              onClick={() => {
                void replay(cursor - 1)
              }}
            >
              <ChevronLeft size={15} />
            </button>
            <label className="batch-navigation">
              batch
              <select
                aria-label="Recorded batch"
                value={cursor}
                onChange={(event) => void replay(Number(event.target.value))}
              >
                <option value={0}>initial</option>
                {run.rounds.map((_, index) => (
                  <option key={index} value={index + 1}>
                    {String(index + 1).padStart(3, '0')}
                  </option>
                ))}
              </select>
              <span>/ {run.rounds.length}</span>
            </label>
            <button
              className="icon-button"
              aria-label="Next recorded batch"
              disabled={cursor >= run.rounds.length}
              onClick={() => {
                void replay(cursor + 1)
              }}
            >
              <ChevronRight size={15} />
            </button>
            <span className="replay-spacer" />
            <button
              className="icon-button"
              title="Replay selected batch"
              aria-label="Replay selected batch"
              disabled={!cursor || busy}
              onClick={() => void replay(cursor)}
            >
              <Play size={13} />
            </button>
            <select
              aria-label="Animation speed"
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            >
              <option value={0}>instant</option>
              <option value={0.5}>0.5×</option>
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </div>
        </section>
        <aside className="inspector">
          <nav className="inspector-tabs">
            {(['batch', 'payload', 'history'] as const).map((value) => (
              <button
                className={tab === value ? 'active' : ''}
                key={value}
                onClick={() => setTab(value)}
              >
                {value}
              </button>
            ))}
            <button
              className="icon-button export"
              aria-label="Export run"
              title="Export run"
              onClick={exportRun}
            >
              <ArrowDownToLine size={14} />
            </button>
          </nav>
          {tab === 'batch' && (
            <div className="batch-view">
              <div className="batch-heading">
                <h2>
                  /
                  {String(phase === 'request' ? run.rounds.length + 1 : cursor || 1).padStart(
                    3,
                    '0',
                  )}
                </h2>
                <span>
                  {cooldown
                    ? `retry in ${cooldown}s`
                    : busy && phase === 'request'
                      ? `${targets.length} cells`
                      : inspectedRound
                        ? `${inspectedRound.decisions.length}${(inspectedRound.requestedCells ?? 0) > inspectedRound.decisions.length ? `/${inspectedRound.requestedCells}` : ''} cells`
                        : '—'}
                  {(phase === 'request' && requestLimit < batchSize) ||
                  (inspectedRound &&
                    (inspectedRound.requestedCells ?? 0) > inspectedRound.decisions.length)
                    ? ' · context limit'
                    : ''}
                </span>
                <span className="request-time">
                  {inspectedRound ? `${inspectedRound.latency} ms` : '— ms'}
                </span>
              </div>
              <div className="probability-summary">
                <div title="Arithmetic mean of the selected-value probabilities. Not a joint batch probability.">
                  <span>mean p</span>
                  <strong>{percent(summary.mean)}</strong>
                </div>
                <div title="Smallest selected-value probability in this batch">
                  <span>min p</span>
                  <strong>{percent(summary.min)}</strong>
                </div>
              </div>
              <div
                className="histogram"
                role="img"
                aria-label="Distribution of selected-value probabilities"
              >
                {summary.bins.map((count, index) => (
                  <div key={index} title={`${index * 10}–${(index + 1) * 10}%: ${count} answers`}>
                    <span>{count || ''}</span>
                    <i
                      style={{
                        height: `${Math.max(2, (count / Math.max(1, ...summary.bins)) * 76)}px`,
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="histogram-axis">
                <span>0%</span>
                <span>p(selected)</span>
                <span>100%</span>
              </div>
              <div className="batch-metrics">
                <div>
                  <span>answers</span>
                  <strong>{inspectedRound?.decisions.length ?? '—'}</strong>
                </div>
                <div>
                  <span>placed</span>
                  <strong>{inspectedRound?.applied.length ?? '—'}</strong>
                </div>
                <div>
                  <span>not placed</span>
                  <strong>
                    {inspectedRound
                      ? inspectedRound.decisions.length - inspectedRound.applied.length
                      : '—'}
                  </strong>
                </div>
              </div>
              <section className="probabilities-section" aria-label="Cell probabilities">
                <div className="probabilities-heading">
                  <span>probabilities</span>
                  <span className="probability-coordinate">
                    {probabilityIndex === null ? '—' : coordinate(probabilityIndex, size)}
                  </span>
                </div>
                <div
                  className="value-probabilities"
                  style={{
                    gridTemplateColumns: `repeat(${size > 9 ? 4 : 3}, minmax(0, 1fr))`,
                  }}
                >
                  {Array.from({ length: size }, (_, offset) => {
                    const value = offset + 1
                    const probability = distribution?.probabilities?.[String(value)] ?? null
                    const invalid = Boolean(
                      distribution?.probabilities &&
                      !beforeOptions?.get(distribution.index)?.has(value),
                    )
                    const rejected =
                      inspectedRound &&
                      run.rejections.some(
                        (item) =>
                          item.index === probabilityIndex &&
                          item.choice === value &&
                          item.assumptions.every(
                            (assumption) =>
                              inspectedRound.before[assumption.index] === assumption.choice,
                          ),
                      )
                    return (
                      <div
                        key={value}
                        data-value={value}
                        data-invalid={invalid || rejected || undefined}
                        data-chosen={distribution?.choice === value || undefined}
                        onPointerEnter={() => setHighlight(probabilityIndex)}
                        onPointerLeave={() => setHighlight(null)}
                        title={`${value}: ${percent(probability)}${invalid ? ' · conflicts with the request board' : rejected ? ' · previously rejected in this branch' : ''}`}
                      >
                        <strong>{value}</strong>
                        <span>{percent(probability)}</span>
                        <i style={{ width: `${(probability ?? 0) * 100}%` }} />
                      </div>
                    )
                  })}
                </div>
              </section>
              {inspectedRound?.context === 'local' && (
                <span
                  className="context-note"
                  title="Only the target cells' rows, columns and boxes were sent; the full board exceeds the context budget."
                >
                  local context
                </span>
              )}
            </div>
          )}
          {tab === 'payload' && (
            <div className="payload-view">
              <div className="payload-switch">
                <button
                  className={payloadTab === 'request' ? 'active' : ''}
                  onClick={() => setPayloadTab('request')}
                >
                  request
                </button>
                <button
                  className={payloadTab === 'response' ? 'active' : ''}
                  onClick={() => setPayloadTab('response')}
                >
                  response
                </button>
                <Code2 size={14} />
              </div>
              <pre>
                {phase === 'request' && payloadTab === 'request'
                  ? JSON.stringify(pendingRequest, null, 2)
                  : inspectedRound
                    ? JSON.stringify(inspectedRound[payloadTab], null, 2)
                    : '{ }'}
              </pre>
            </div>
          )}
          {tab === 'history' && (
            <div className="history-view">
              <div className="history-summary">
                <span>{run.rounds.length} requests</span>
                <span>${cost.toFixed(6)}</span>
              </div>
              <button
                className={`history-row ${!cursor ? 'active' : ''}`}
                onClick={() => {
                  void replay(0)
                }}
              >
                <span>/000</span>
                <span>initial</span>
              </button>
              {run.rounds.map((item, index) => (
                <button
                  className={`history-row ${cursor === index + 1 ? 'active' : ''}`}
                  key={index}
                  onClick={() => {
                    void replay(index + 1)
                  }}
                >
                  <span>/{String(index + 1).padStart(3, '0')}</span>
                  <span>+{item.applied.length}</span>
                  <span>{percent(stats(item).mean)}</span>
                  <span>{item.latency}ms</span>
                </button>
              ))}
            </div>
          )}
        </aside>
      </div>
      <footer className="run-totals" aria-label="Run totals">
        <span>
          run <strong>{run.rounds.length}</strong> batches
        </span>
        <span>
          in <strong>{totals.input.toLocaleString()}</strong>
        </span>
        <span>
          out <strong>{totals.output.toLocaleString()}</strong>
        </span>
        <span title="Total reported cost for all completed batches in this run">
          total{' '}
          <strong>
            ${cost.toFixed(6)}
            {totals.unknown ? ' + unknown' : ''}
          </strong>
        </span>
      </footer>
      {error && (
        <div className="error" role="alert">
          {error}
          <button aria-label="Dismiss error" onClick={() => setError('')}>
            <X size={14} />
          </button>
        </div>
      )}
      <dialog
        ref={dialog}
        className="settings-dialog"
        onCancel={() => setSettings(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSettings(false)
        }}
      >
        <div className="settings-body">
          <div className="dialog-heading">
            <h2>settings</h2>
            <button
              className="icon-button"
              aria-label="Close settings"
              onClick={() => setSettings(false)}
            >
              <X size={18} />
            </button>
          </div>
          <label>
            your openrouter key
            <input
              aria-label="OpenRouter key"
              type="password"
              value={apiKey}
              placeholder={personalConnected ? 'personal key connected' : 'sk-or-v1-…'}
              onChange={(event) => setApiKey(event.target.value.trim())}
              autoComplete="off"
            />
          </label>
          <div className="key-controls">
            <span>
              {personalConnected
                ? 'using your key'
                : serverKey
                  ? 'using shared access'
                  : 'shared access unavailable'}
            </span>
            {personalConnected ? (
              <button className="button secondary" onClick={disconnectKey}>
                Disconnect
              </button>
            ) : (
              <button className="button secondary" disabled={!apiKey.trim()} onClick={connectKey}>
                Connect
              </button>
            )}
          </div>
          <label>
            cells per request
            <select
              aria-label="Batch size"
              value={batchSize}
              onChange={(event) => setBatchSize(Number(event.target.value))}
            >
              {[1, 4, 8, 16, 32, 64, MAX_BATCH_SIZE].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <button className="button primary" onClick={() => setSettings(false)}>
            done
          </button>
        </div>
      </dialog>
      {info && (
        <Info
          onClose={() => {
            window.history.replaceState(null, '', window.location.pathname + window.location.search)
            setInfo(false)
          }}
        />
      )}
    </main>
  )
}
export default App
