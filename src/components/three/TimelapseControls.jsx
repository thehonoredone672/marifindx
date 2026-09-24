import React, { useEffect, useRef, useMemo } from 'react'
import { Play, Pause, RotateCcw, ChevronLeft, ChevronRight } from 'lucide-react'
import useInvestigationStore from '../../context/investigationStore'

const SPEEDS = [0.25, 0.5, 1, 2, 4]
const STEP_MINUTES = 15

/**
 * The single simulation clock. Every synchronised element -- particles,
 * vessels, map markers, event highlighting -- reads `simulationTime`
 * from the store, so they cannot drift out of step with each other.
 */
export default function TimelapseControls() {
  const {
    investigation, simulationTime, setSimulationTime,
    isPlaying, setIsPlaying, playbackSpeed, setPlaybackSpeed,
  } = useInvestigationStore()

  const rafRef = useRef(null)
  const lastRef = useRef(0)

  const sim = investigation?.simulation ?? {}
  const startMs = sim.start_time ? new Date(sim.start_time).getTime() : null
  const endMs = sim.end_time ? new Date(sim.end_time).getTime() : null
  const durationMin = startMs && endMs ? Math.max(1, (endMs - startMs) / 60000) : 0

  const simulationTimeRef = useRef(simulationTime)
  useEffect(() => { simulationTimeRef.current = simulationTime }, [simulationTime])

  useEffect(() => {
    if (!isPlaying || !durationMin) return undefined

    lastRef.current = performance.now()
    const tick = (now) => {
      const deltaSec = (now - lastRef.current) / 1000
      lastRef.current = now
      const next = simulationTimeRef.current + deltaSec * playbackSpeed * 1.0

      if (next >= durationMin) {
        setSimulationTime(durationMin)
        setIsPlaying(false)
        return
      }
      setSimulationTime(next)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playbackSpeed, durationMin, setSimulationTime, setIsPlaying])

  const currentDate = useMemo(
    () => (startMs ? new Date(startMs + simulationTime * 60000) : null),
    [startMs, simulationTime],
  )

  const events = useMemo(() => {
    if (!investigation || !startMs || !durationMin) return []
    const rw = investigation.origin?.release_window ?? {}
    const raw = [
      { label: 'Release window opens', time: rw.start, color: 'var(--info)' },
      { label: 'Estimated release', time: rw.centre, color: 'var(--accent)' },
      { label: 'Release window closes', time: rw.end, color: 'var(--info)' },
      { label: 'Satellite detection', time: investigation.detection_time, color: 'var(--accent)' },
    ]
    const top = investigation.ranking?.vessels?.[0]
    const zone = top?.evidence?.origin_zone
    if (top && zone?.crossed && top.trajectory?.length) {
      const mid = top.trajectory[Math.floor(top.trajectory.length / 2)]
      raw.push({
        label: `${top.name} crosses origin zone`,
        time: mid.time,
        color: 'var(--info)',
      })
    }
    return raw
      .filter((e) => e.time)
      .map((e) => ({ ...e, minutes: (new Date(e.time).getTime() - startMs) / 60000 }))
      .filter((e) => e.minutes >= -1 && e.minutes <= durationMin + 1)
      .sort((a, b) => a.minutes - b.minutes)
  }, [investigation, startMs, durationMin])

  if (!investigation || !durationMin) return null

  const pct = (simulationTime / durationMin) * 100
  const step = (delta) =>
    setSimulationTime(Math.max(0, Math.min(durationMin, simulationTime + delta)))

  const activeEvent = events.find((e) => Math.abs(e.minutes - simulationTime) < 12)

  return (
    <div className="border-t bd surface-2 px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setSimulationTime(0); setIsPlaying(false) }}
            className="btn-icon"
            title="Restart"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => step(-STEP_MINUTES)} className="btn-icon" title="Step back 15 min">
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="btn btn-accent"
            style={{ padding: '0.4rem 0.6rem' }}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
          </button>
          <button onClick={() => step(STEP_MINUTES)} className="btn-icon" title="Step forward 15 min">
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 min-w-[220px]">
          <div className="relative">
            <div className="absolute inset-x-0 -top-2 h-2 pointer-events-none">
              {events.map((e, i) => (
                <span
                  key={i}
                  className="absolute rounded-sm"
                  style={{
                    left: `${Math.max(0, Math.min(100, (e.minutes / durationMin) * 100))}%`,
                    width: 2,
                    height: 8,
                    background: e.color,
                    opacity: simulationTime >= e.minutes ? 1 : 0.3,
                  }}
                  title={e.label}
                />
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={durationMin}
              step={0.5}
              value={simulationTime}
              onChange={(e) => setSimulationTime(parseFloat(e.target.value))}
              className="w-full"
              style={{
                background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${pct}%, var(--border) ${pct}%, var(--border) 100%)`,
              }}
              aria-label="Simulation timeline"
            />
          </div>
        </div>

        <div className="seg">
          {SPEEDS.map((s) => (
            <button key={s} data-active={playbackSpeed === s} onClick={() => setPlaybackSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-4 text-[11px] txt-faint flex-wrap">
        <span className="mono">
          {currentDate ? currentDate.toISOString().slice(0, 16).replace('T', ' ') : '—'} UTC
          <span className="ml-1">· T+{simulationTime.toFixed(0)}m / {durationMin.toFixed(0)}m</span>
        </span>
        {activeEvent && (
          <span className="font-semibold" style={{ color: activeEvent.color }}>
            ● {activeEvent.label}
          </span>
        )}
        <span>
          Release {investigation.origin?.release_window?.centre?.slice(11, 16)} · Detection{' '}
          {investigation.detection_time?.slice(11, 16)} UTC
        </span>
      </div>
    </div>
  )
}
