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

  // Advance the clock in wall-clock-proportional steps. One real second
  // maps to one simulated minute at 1x, so a 7-hour window plays in ~7 min
  // at 1x and ~1.75 min at 4x.
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

  // Mirror the time into a ref so the rAF loop reads it without re-subscribing.
  const simulationTimeRef = useRef(simulationTime)
  useEffect(() => { simulationTimeRef.current = simulationTime }, [simulationTime])

  const currentDate = useMemo(
    () => (startMs ? new Date(startMs + simulationTime * 60000) : null),
    [startMs, simulationTime],
  )

  const events = useMemo(() => {
    if (!investigation || !startMs || !durationMin) return []
    const rw = investigation.origin?.release_window ?? {}
    const raw = [
      { label: 'Release window opens', time: rw.start, color: '#7FE7D6' },
      { label: 'Estimated release', time: rw.centre, color: '#fbbf24' },
      { label: 'Release window closes', time: rw.end, color: '#7FE7D6' },
      { label: 'Satellite detection', time: investigation.detection_time, color: '#f59e0b' },
    ]
    const top = investigation.ranking?.vessels?.[0]
    const zone = top?.evidence?.origin_zone
    if (top && zone?.crossed && top.trajectory?.length) {
      const mid = top.trajectory[Math.floor(top.trajectory.length / 2)]
      raw.push({
        label: `${top.name} crosses origin zone`,
        time: mid.time,
        color: '#3BA7F2',
      })
    }
    return raw
      .filter((e) => e.time)
      .map((e) => ({
        ...e,
        minutes: (new Date(e.time).getTime() - startMs) / 60000,
      }))
      .filter((e) => e.minutes >= -1 && e.minutes <= durationMin + 1)
      .sort((a, b) => a.minutes - b.minutes)
  }, [investigation, startMs, durationMin])

  if (!investigation || !durationMin) return null

  const pct = (simulationTime / durationMin) * 100
  const step = (delta) =>
    setSimulationTime(Math.max(0, Math.min(durationMin, simulationTime + delta)))

  const activeEvent = events.find((e) => Math.abs(e.minutes - simulationTime) < 12)

  return (
    <div className="border-t border-slate-800 bg-slate-950/60 px-4 py-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <IconBtn onClick={() => { setSimulationTime(0); setIsPlaying(false) }} title="Restart">
            <RotateCcw className="w-4 h-4" />
          </IconBtn>
          <IconBtn onClick={() => step(-STEP_MINUTES)} title="Step back 15 min">
            <ChevronLeft className="w-4 h-4" />
          </IconBtn>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="p-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white transition-colors"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <IconBtn onClick={() => step(STEP_MINUTES)} title="Step forward 15 min">
            <ChevronRight className="w-4 h-4" />
          </IconBtn>
        </div>

        <div className="flex-1 min-w-[220px]">
          <div className="relative">
            {/* Event markers */}
            <div className="absolute inset-x-0 -top-2 h-2 pointer-events-none">
              {events.map((e, i) => (
                <span
                  key={i}
                  className="absolute w-1 h-2 rounded-sm"
                  style={{
                    left: `${Math.max(0, Math.min(100, (e.minutes / durationMin) * 100))}%`,
                    backgroundColor: e.color,
                    opacity: simulationTime >= e.minutes ? 1 : 0.35,
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
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-amber-500"
              style={{
                background: `linear-gradient(to right, #f59e0b 0%, #f59e0b ${pct}%, #1e293b ${pct}%, #1e293b 100%)`,
              }}
              aria-label="Simulation timeline"
            />
          </div>
        </div>

        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setPlaybackSpeed(s)}
              className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                playbackSpeed === s
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-4 text-[11px] text-slate-500 flex-wrap">
        <span className="font-mono">
          {currentDate ? currentDate.toISOString().slice(0, 16).replace('T', ' ') : '—'} UTC
          <span className="text-slate-600"> · T+{simulationTime.toFixed(0)}m / {durationMin.toFixed(0)}m</span>
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

function IconBtn({ children, onClick, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
    >
      {children}
    </button>
  )
}
