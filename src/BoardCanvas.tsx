import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { boxShape } from './sudoku'
import { boardChanges } from './boardChanges'
import type { Board } from './sudoku'

export type Phase = 'idle' | 'request' | 'response' | 'apply'
interface Props {
  board: Board
  comparisonBoard: Board
  applied?: number[]
  initial: Board
  size: number
  targets: number[]
  phase: Phase
  zoom: number
  onZoom: (zoom: number) => void
  highlight: number | null
  onHighlight: (index: number | null) => void
  onSelect: (index: number) => void
  animationMs: number
  replayId: number
  cost: number
  costUnknown: boolean
}

export default function BoardCanvas({
  board,
  comparisonBoard,
  applied,
  initial,
  size,
  targets,
  phase,
  zoom,
  onZoom,
  highlight,
  onHighlight,
  onSelect,
  animationMs,
  replayId,
  cost,
  costUnknown,
}: Props) {
  const viewport = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const animationStarted = useRef(0)
  useLayoutEffect(() => {
    animationStarted.current = performance.now()
  }, [phase, replayId])
  const changes = boardChanges(comparisonBoard, board)
  const counts = { added: 0, removed: 0, replaced: 0 }
  changes.forEach((change) => counts[change.kind]++)
  const [extent, setExtent] = useState(500)
  const pixels = Math.round(extent * zoom)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const selection = useRef<{ pointerId: number; x: number; y: number; index: number } | null>(null)
  const camera = useRef({ zoom, pan })
  useEffect(() => {
    camera.current = { zoom, pan }
  }, [zoom, pan])

  useEffect(() => {
    const element = viewport.current!
    function wheel(event: WheelEvent) {
      event.preventDefault()
      selection.current = null
      const current = camera.current
      const bounds = element.getBoundingClientRect()
      const x = event.clientX - bounds.left - bounds.width / 2
      const y = event.clientY - bounds.top - bounds.height / 2
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1)
      const next = Math.max(1, Math.min(16, current.zoom * Math.exp(-delta * 0.006)))
      const ratio = next / current.zoom
      const nextPan = { x: x - (x - current.pan.x) * ratio, y: y - (y - current.pan.y) * ratio }
      camera.current = { zoom: next, pan: nextPan }
      setPan(nextPan)
      onZoom(next)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [onZoom])

  useLayoutEffect(() => {
    const element = viewport.current!
    const measure = () =>
      setExtent(Math.max(180, Math.min(element.clientWidth - 36, element.clientHeight - 36)))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const element = canvas.current!
    const context = element.getContext('2d')!
    const ratio = Math.min(window.devicePixelRatio || 1, 4096 / pixels)
    const resolution = Math.round(pixels * ratio)
    if (element.width !== resolution) element.width = resolution
    if (element.height !== resolution) element.height = resolution
    const shape = boxShape(size)
    const cell = pixels / size
    const targetSet = new Set(targets)
    const changes = boardChanges(comparisonBoard, board)
    const appliedSet = new Set(applied)
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const duration = reducedMotion ? 0 : animationMs
    const start = animationStarted.current
    let frame = 0
    function draw(time: number) {
      const progress = duration ? Math.min(1, (time - start) / duration) : 1
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.fillStyle = '#0d0d0d'
      context.fillRect(0, 0, pixels, pixels)
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      const fontSize = Math.min(29, cell * (size >= 100 ? 0.34 : size > 16 ? 0.39 : 0.47))
      context.font = `400 ${fontSize}px "Geist Mono Variable", monospace`
      for (let index = 0; index < board.length; index++) {
        const x = (index % size) * cell,
          y = Math.floor(index / size) * cell
        const change = changes.get(index)
        const value = board[index]
        const tint = phase === 'apply' ? 0.12 + 0.08 * progress : 0.2
        if (change) {
          context.fillStyle =
            change.kind === 'added' ? `rgba(199,120,122,${tint})` : `rgba(193,153,106,${tint})`
          context.fillRect(x, y, cell, cell)
        } else if ((phase === 'apply' || phase === 'idle') && appliedSet.has(index) && value) {
          context.fillStyle = '#c7787a20'
          context.fillRect(x, y, cell, cell)
        } else if (phase === 'request' && targetSet.has(index)) {
          context.fillStyle = '#c7787a12'
          context.fillRect(x, y, cell, cell)
        }
        if (value && cell >= 11) {
          context.fillStyle = initial[index] ? '#969696' : '#df8b8e'
          context.fillText(String(value), x + cell / 2, y + cell / 2 + cell * 0.025)
        } else if (value) {
          context.fillStyle = initial[index] ? '#494949' : '#c7787a'
          context.fillRect(x + cell * 0.3, y + cell * 0.3, cell * 0.4, cell * 0.4)
        }
        if (change?.from) {
          const replaced = Boolean(change.to)
          if (cell >= (replaced ? 26 : 11)) {
            const oldSize = replaced ? Math.min(12, cell * 0.23) : fontSize
            context.font = `400 ${oldSize}px "Geist Mono Variable", monospace`
            context.fillStyle = '#c6a174'
            const oldX = replaced ? x + cell * 0.22 : x + cell / 2
            const oldY = replaced ? y + cell * 0.18 : y + cell / 2
            const text = String(change.from)
            context.fillText(text, oldX, oldY)
            const width = context.measureText(text).width + 4
            context.beginPath()
            context.strokeStyle = '#c6a174'
            context.lineWidth = 1.2
            context.moveTo(oldX - width / 2, oldY)
            context.lineTo(oldX + width / 2, oldY)
            context.stroke()
            context.font = `400 ${fontSize}px "Geist Mono Variable", monospace`
          } else {
            context.fillStyle = '#c6a174'
            context.fillRect(x + cell * 0.15, y + cell * 0.2, cell * 0.7, Math.max(1, cell * 0.08))
          }
        }
      }
      for (let i = 0; i <= size; i++) {
        context.beginPath()
        context.strokeStyle = i % shape.cols === 0 ? '#515151' : '#232323'
        context.lineWidth = i % shape.cols === 0 ? 1.5 : 0.5
        context.moveTo(i * cell, 0)
        context.lineTo(i * cell, pixels)
        context.stroke()
        context.beginPath()
        context.strokeStyle = i % shape.rows === 0 ? '#515151' : '#232323'
        context.lineWidth = i % shape.rows === 0 ? 1.5 : 0.5
        context.moveTo(0, i * cell)
        context.lineTo(pixels, i * cell)
        context.stroke()
      }
      const focused = highlight
      if (focused !== null && focused >= 0 && focused < board.length) {
        context.strokeStyle = '#e8a2a4'
        context.lineWidth = 2
        context.strokeRect(
          (focused % size) * cell + 1,
          Math.floor(focused / size) * cell + 1,
          cell - 2,
          cell - 2,
        )
      }
      if (phase === 'apply' && progress < 1) frame = requestAnimationFrame(draw)
    }
    draw(performance.now())
    return () => cancelAnimationFrame(frame)
  }, [
    board,
    comparisonBoard,
    applied,
    initial,
    size,
    targets,
    phase,
    pixels,
    highlight,
    animationMs,
    replayId,
  ])

  return (
    <div
      className="board-viewport"
      ref={viewport}
      onAuxClick={(event) => event.preventDefault()}
      onLostPointerCapture={(event) => {
        if (selection.current?.pointerId === event.pointerId) selection.current = null
        pointers.current.delete(event.pointerId)
        event.currentTarget.style.cursor = 'grab'
      }}
      onDoubleClick={() => {
        setPan({ x: 0, y: 0 })
        onZoom(1)
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 && event.button !== 1) return
        event.preventDefault()
        onHighlight(null)
        const rect = canvas.current!.getBoundingClientRect()
        const col = Math.floor(((event.clientX - rect.left) / rect.width) * size)
        const row = Math.floor(((event.clientY - rect.top) / rect.height) * size)
        selection.current =
          event.button === 0 &&
          !pointers.current.size &&
          col >= 0 &&
          col < size &&
          row >= 0 &&
          row < size
            ? {
                pointerId: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                index: row * size + col,
              }
            : null
        event.currentTarget.setPointerCapture(event.pointerId)
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        event.currentTarget.style.cursor = 'grabbing'
      }}
      onPointerMove={(event) => {
        const previous = pointers.current.get(event.pointerId)
        if (!previous) return
        const click = selection.current
        if (click?.pointerId === event.pointerId) {
          if (Math.hypot(event.clientX - click.x, event.clientY - click.y) < 5) return
          selection.current = null
        }
        const other = [...pointers.current.entries()].find(([id]) => id !== event.pointerId)?.[1]
        const current = camera.current
        let nextPan = {
          x: current.pan.x + event.clientX - previous.x,
          y: current.pan.y + event.clientY - previous.y,
        }
        let nextZoom = current.zoom
        if (other) {
          const before = Math.hypot(previous.x - other.x, previous.y - other.y)
          const after = Math.hypot(event.clientX - other.x, event.clientY - other.y)
          nextZoom = Math.max(1, Math.min(16, (current.zoom * after) / Math.max(1, before)))
          const rect = event.currentTarget.getBoundingClientRect()
          const oldCenter = {
            x: (previous.x + other.x) / 2 - rect.left - rect.width / 2,
            y: (previous.y + other.y) / 2 - rect.top - rect.height / 2,
          }
          const newCenter = {
            x: (event.clientX + other.x) / 2 - rect.left - rect.width / 2,
            y: (event.clientY + other.y) / 2 - rect.top - rect.height / 2,
          }
          const ratio = nextZoom / current.zoom
          nextPan = {
            x: newCenter.x - (oldCenter.x - current.pan.x) * ratio,
            y: newCenter.y - (oldCenter.y - current.pan.y) * ratio,
          }
          onZoom(nextZoom)
        }
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        camera.current = { zoom: nextZoom, pan: nextPan }
        setPan(nextPan)
      }}
      onPointerUp={(event) => {
        const click = selection.current
        if (click?.pointerId === event.pointerId) {
          if (Math.hypot(event.clientX - click.x, event.clientY - click.y) < 5)
            onSelect(click.index)
          selection.current = null
        }
        pointers.current.delete(event.pointerId)
        event.currentTarget.style.cursor = 'grab'
      }}
      onPointerCancel={(event) => {
        if (selection.current?.pointerId === event.pointerId) selection.current = null
        pointers.current.delete(event.pointerId)
        event.currentTarget.style.cursor = 'grab'
      }}
    >
      <div
        className="canvas-space"
        style={{
          width: pixels,
          height: pixels,
          transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`,
        }}
      >
        <canvas
          ref={canvas}
          style={{ width: pixels, height: pixels }}
          role="img"
          aria-label={`${size} by ${size} board, ${board.filter(Boolean).length} of ${board.length} filled`}
          onPointerLeave={() => onHighlight(null)}
          onPointerMove={(event) => {
            if (pointers.current.size) return
            const rect = event.currentTarget.getBoundingClientRect()
            const col = Math.min(
              size - 1,
              Math.floor(((event.clientX - rect.left) / rect.width) * size),
            )
            const row = Math.min(
              size - 1,
              Math.floor(((event.clientY - rect.top) / rect.height) * size),
            )
            onHighlight(row * size + col)
          }}
        />
      </div>
      {changes.size > 0 && (
        <div className="change-summary" aria-label="Board changes">
          {counts.added > 0 && (
            <span className="added" aria-label={`${counts.added} added`}>
              +{counts.added}
            </span>
          )}
          {counts.removed > 0 && (
            <span className="removed" aria-label={`${counts.removed} removed`}>
              −{counts.removed}
            </span>
          )}
          {counts.replaced > 0 && (
            <span className="removed" aria-label={`${counts.replaced} replaced`}>
              ↔{counts.replaced}
            </span>
          )}
        </div>
      )}
      <span className="canvas-cost">
        Cost to run{' '}
        <strong>
          ${cost.toFixed(6)}
          {costUnknown ? ' + unknown' : ''}
        </strong>
      </span>
    </div>
  )
}
