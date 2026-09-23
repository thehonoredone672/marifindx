import React, { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { AlertTriangle, Play, Loader2, Upload, Box, Map as MapIcon } from 'lucide-react'
import useInvestigationStore from '../context/investigationStore'
import SpillMap from '../components/map/SpillMap'
import SpillScene3D from '../components/three/SpillScene3D'
import TimelapseControls from '../components/three/TimelapseControls'
import DetectionPanel from '../components/investigation/DetectionPanel'
import VesselTable from '../components/investigation/VesselTable'

export default function Investigation() {
  const {
    investigation, loading, error, modelStatus,
    checkModel, runDemo, uploadScene,
    viewMode, setViewMode, clearError,
  } = useInvestigationStore()

  const [backendDown, setBackendDown] = useState(false)

  useEffect(() => {
    checkModel().catch(() => setBackendDown(true))
  }, [checkModel])

  const handleUpload = (event) => {
    const file = event.target.files?.[0]
    if (file) uploadScene(file).catch(() => {})
  }

  // ---- Backend unreachable -----------------------------------------
  if (backendDown) {
    return (
      <Notice
        tone="red"
        title="Backend unreachable"
        body="The MariFindX API is not responding. Start it from the project root:"
        command="uvicorn backend.main:app --reload"
        onRetry={() => { setBackendDown(false); checkModel().catch(() => setBackendDown(true)) }}
      />
    )
  }

  // ---- Model checkpoint missing ------------------------------------
  if (modelStatus && !modelStatus.checkpoint_present) {
    return (
      <Notice
        tone="amber"
        title="Model checkpoint not found"
        body="No trained model is available, so no detection can be produced. Train one first:"
        command="python -m ml.train --config config.yaml --mode quick"
        footnote="The application will not fabricate a prediction without a trained model."
      />
    )
  }

  return (
    <div className="min-h-screen pt-20 pb-12 bg-slate-950">
      <div className="max-w-[1600px] mx-auto px-4">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Investigation</h1>
            <p className="text-sm text-slate-400">
              Sentinel-1 segmentation, drift reconstruction and AIS correlation
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => runDemo().catch(() => {})}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2 transition-colors"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Play className="w-4 h-4" />}
              {loading ? 'Running pipeline…' : 'Run Demo Investigation'}
            </button>

            <label className="px-4 py-2 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-200 text-sm font-semibold flex items-center gap-2 cursor-pointer transition-colors">
              <Upload className="w-4 h-4" />
              Upload SAR scene
              <input type="file" accept=".tif,.tiff" onChange={handleUpload} className="hidden" />
            </label>
          </div>
        </header>

        {error && (
          <div className="mb-6 p-4 rounded-lg border border-red-500/40 bg-red-500/10 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-red-200 font-semibold">{error.message}</p>
              {error.detail?.command && (
                <code className="mt-2 block text-xs text-red-300/80 font-mono">
                  {error.detail.command}
                </code>
              )}
            </div>
            <button onClick={clearError} className="text-red-300 hover:text-red-100 text-sm">
              Dismiss
            </button>
          </div>
        )}

        {!investigation && !loading && (
          <div className="rounded-lg border border-slate-800 bg-slate-900 p-16 text-center">
            <p className="text-slate-300 mb-2 text-lg">No active investigation</p>
            <p className="text-slate-500 text-sm">
              Run the demo to execute the trained model on the bundled Sentinel-1-format
              scene, or upload your own GeoTIFF.
            </p>
          </div>
        )}

        {investigation && investigation.status === 'no_detection' && (
          <div className="rounded-lg border border-slate-700 bg-slate-900 p-8 text-center">
            <p className="text-slate-200 font-semibold mb-2">No spill detected</p>
            <p className="text-slate-400 text-sm">{investigation.message}</p>
          </div>
        )}

        {investigation && investigation.status === 'complete' && (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-[380px_1fr] gap-4 mb-4">
              <DetectionPanel investigation={investigation} />

              <section className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden flex flex-col">
                <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                  <h2 className="font-semibold text-white">
                    {viewMode === '3d' ? '3D Drift & Vessel Time-Lapse' : 'Map'}
                  </h2>
                  <div className="flex rounded-lg border border-slate-700 overflow-hidden">
                    <ToggleBtn
                      active={viewMode === '2d'}
                      onClick={() => setViewMode('2d')}
                      icon={MapIcon}
                      label="2D Map"
                    />
                    <ToggleBtn
                      active={viewMode === '3d'}
                      onClick={() => setViewMode('3d')}
                      icon={Box}
                      label="3D"
                    />
                  </div>
                </div>

                <div className="h-[460px] relative">
                  {viewMode === '3d'
                    ? <SpillScene3D investigation={investigation} />
                    : <SpillMap investigation={investigation} />}
                </div>

                <TimelapseControls />
              </section>
            </div>

            <VesselTable investigation={investigation} />
          </>
        )}
      </div>
    </div>
  )
}

function ToggleBtn({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-semibold flex items-center gap-1.5 transition-colors ${
        active ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

function Notice({ tone, title, body, command, footnote, onRetry }) {
  const accent = tone === 'red'
    ? 'border-red-500/40 bg-red-500/10 text-red-300'
    : 'border-amber-500/40 bg-amber-500/10 text-amber-300'
  return (
    <div className="min-h-screen pt-20 pb-12 bg-slate-950">
      <div className="max-w-2xl mx-auto px-4">
        <div className={`rounded-lg border p-8 ${accent}`}>
          <div className="flex items-start gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5" />
            <h1 className="text-xl font-bold text-white">{title}</h1>
          </div>
          <p className="text-slate-300 mb-4">{body}</p>
          {command && (
            <code className="block p-3 rounded bg-slate-950 text-emerald-300 font-mono text-sm mb-4 overflow-x-auto">
              {command}
            </code>
          )}
          {footnote && <p className="text-slate-400 text-sm">{footnote}</p>}
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-4 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
