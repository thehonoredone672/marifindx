import React, { useEffect, useState } from 'react'
import { AlertTriangle, Play, Loader2, Upload, Box, Map as MapIcon } from 'lucide-react'
import useInvestigationStore from '../context/investigationStore'
import SpillMap from '../components/map/SpillMap'
import SpillScene3D from '../components/three/SpillScene3D'
import TimelapseControls from '../components/three/TimelapseControls'
import DetectionPanel from '../components/investigation/DetectionPanel'
import VesselTable from '../components/investigation/VesselTable'
import OilPredictionTimelapse from '../components/investigation/OilPredictionTimelapse'

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

  if (backendDown) {
    return (
      <Notice
        tone="danger"
        title="Backend unreachable"
        body="The MariFindX API is not responding. Start it from the project root:"
        command="uvicorn backend.main:app --reload"
        onRetry={() => {
          setBackendDown(false)
          checkModel().catch(() => setBackendDown(true))
        }}
      />
    )
  }

  if (modelStatus && !modelStatus.checkpoint_present) {
    return (
      <Notice
        tone="accent"
        title="Model checkpoint not found"
        body="No trained model is available, so no detection can be produced. Train one first:"
        command="python -m ml.train --config config.yaml --mode quick"
        footnote="The application will not fabricate a prediction without a trained model."
      />
    )
  }

  return (
    <main className="min-h-screen pt-20 pb-12 app-bg">
      <div className="max-w-[1600px] mx-auto px-4">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight txt">Investigation</h1>
            <p className="text-sm txt-muted mt-0.5">
              Sentinel-1 segmentation, drift reconstruction and AIS correlation
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={() => runDemo().catch(() => {})} disabled={loading} className="btn btn-accent">
              {loading
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running pipeline…</>
                : <><Play className="w-3.5 h-3.5" /> Run Demo Investigation</>}
            </button>

            <label className="btn btn-quiet cursor-pointer">
              <Upload className="w-3.5 h-3.5" />
              Upload scene
              <input type="file" accept=".tif,.tiff" onChange={handleUpload} className="hidden" />
            </label>
          </div>
        </header>

        {error && (
          <div
            className="mb-5 p-3.5 rounded-lg border flex items-start gap-3"
            style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger)' }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--danger)' }} />
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm" style={{ color: 'var(--danger)' }}>{error.message}</p>
              {error.detail?.command && <code className="cmd mt-2">{error.detail.command}</code>}
            </div>
            <button onClick={clearError} className="text-xs txt-muted hover:underline">Dismiss</button>
          </div>
        )}

        {!investigation && !loading && (
          <div className="panel p-14 text-center">
            <p className="txt font-medium mb-1">No active investigation</p>
            <p className="txt-muted text-sm max-w-md mx-auto">
              Run the demo to execute the trained model on the bundled
              Sentinel-1-format scene, or upload your own GeoTIFF.
            </p>
          </div>
        )}

        {investigation?.status === 'no_detection' && (
          <div className="panel p-8 text-center">
            <p className="txt font-medium mb-1">No spill detected</p>
            <p className="txt-muted text-sm">{investigation.message}</p>
          </div>
        )}

        {investigation?.status === 'complete' && (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-4 mb-4">
              <DetectionPanel investigation={investigation} />

              <section className="panel overflow-hidden flex flex-col">
                <div className="panel-head">
                  <h2 className="font-semibold text-sm txt">
                    {viewMode === '3d' ? '3D Drift & Vessel Time-Lapse' : 'Map'}
                  </h2>
                  <div className="seg">
                    <button data-active={viewMode === '2d'} onClick={() => setViewMode('2d')}>
                      <MapIcon className="w-3 h-3 inline mr-1" />2D Map
                    </button>
                    <button data-active={viewMode === '3d'} onClick={() => setViewMode('3d')}>
                      <Box className="w-3 h-3 inline mr-1" />3D
                    </button>
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

            <OilPredictionTimelapse investigation={investigation} />
          </>
        )}
      </div>
    </main>
  )
}

function Notice({ tone, title, body, command, footnote, onRetry }) {
  const color = tone === 'danger' ? 'var(--danger)' : 'var(--accent)'
  const bg = tone === 'danger' ? 'var(--danger-soft)' : 'var(--accent-soft)'
  return (
    <main className="min-h-screen pt-20 pb-12 app-bg">
      <div className="max-w-2xl mx-auto px-4">
        <div className="rounded-lg border p-7" style={{ background: bg, borderColor: color }}>
          <div className="flex items-start gap-2.5 mb-3">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color }} />
            <h1 className="text-base font-semibold txt">{title}</h1>
          </div>
          <p className="txt-muted text-sm mb-3">{body}</p>
          {command && <code className="cmd mb-3">{command}</code>}
          {footnote && <p className="txt-faint text-xs">{footnote}</p>}
          {onRetry && (
            <button onClick={onRetry} className="btn btn-quiet mt-4">Retry</button>
          )}
        </div>
      </div>
    </main>
  )
}
