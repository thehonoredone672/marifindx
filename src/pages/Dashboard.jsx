import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Play, Loader2, ArrowRight } from 'lucide-react'
import useInvestigationStore from '../context/investigationStore'
import api from '../services/api'

const fmt = (v) =>
  v === null || v === undefined || Number.isNaN(v) ? 'n/a' : Number(v).toFixed(4)

export default function Dashboard() {
  const { investigation, loading, runDemo, modelStatus, checkModel } =
    useInvestigationStore()
  const [metrics, setMetrics] = useState(null)
  const [unreachable, setUnreachable] = useState(false)

  useEffect(() => {
    checkModel().catch(() => setUnreachable(true))
    api.modelMetrics().then(setMetrics).catch(() => setMetrics(null))
  }, [checkModel])

  const meta = modelStatus?.metadata
  const test = metrics?.summary?.global
  const perClass = metrics?.summary?.per_class ?? {}
  const detection = metrics?.summary?.detection
  const synthetic = metrics?.data_provenance?.synthetic ?? meta?.data_provenance?.synthetic

  return (
    <main className="min-h-screen pt-20 pb-12 app-bg">
      <div className="max-w-5xl mx-auto px-4">
        <header className="mb-5 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold tracking-tight txt">Dashboard</h1>
            <p className="text-sm txt-muted mt-0.5">Model status and pipeline health</p>
          </div>
          <button
            onClick={() => runDemo().catch(() => {})}
            disabled={loading || unreachable}
            className="btn btn-accent"
          >
            {loading
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Running…</>
              : <><Play className="w-3.5 h-3.5" /> Run Demo Investigation</>}
          </button>
        </header>

        {unreachable && (
          <div
            className="mb-5 p-3.5 rounded-lg border"
            style={{ background: 'var(--danger-soft)', borderColor: 'var(--danger)' }}
          >
            <p className="font-semibold text-sm mb-2" style={{ color: 'var(--danger)' }}>
              Backend unreachable
            </p>
            <code className="cmd">uvicorn backend.main:app --reload</code>
          </div>
        )}

        {synthetic && (
          <div
            className="mb-5 p-3.5 rounded-lg border"
            style={{ background: 'var(--accent-soft)', borderColor: 'var(--accent-border)' }}
          >
            <p className="font-semibold text-sm mb-1" style={{ color: 'var(--accent)' }}>
              Model trained on synthetic pipeline-validation data
            </p>
            <p className="text-[13px] txt-muted leading-relaxed">
              These metrics show the training and inference code runs correctly.
              They are not real oil-spill detection performance. Retrain on the
              Zenodo Sentinel-1 corpus for meaningful figures.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Stat
            label="Checkpoint"
            value={modelStatus?.checkpoint_present ? 'Loaded' : 'Missing'}
            sub={modelStatus?.size_mb ? `${modelStatus.size_mb} MB` : undefined}
          />
          <Stat
            label="Device"
            value={(modelStatus?.device ?? '—').toUpperCase()}
            sub={modelStatus?.cuda_available ? 'CUDA available' : 'CPU only'}
          />
          <Stat
            label="Encoder"
            value={meta?.architecture?.encoder ?? '—'}
            sub={meta?.architecture?.parameters
              ? `${(meta.architecture.parameters / 1e6).toFixed(1)}M params` : undefined}
          />
          <Stat
            label="Best val Dice"
            value={meta?.validation_metrics?.best_dice?.toFixed(4) ?? '—'}
            sub={meta?.best_epoch ? `epoch ${meta.best_epoch}` : undefined}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          <Panel title="Held-out test metrics">
            {test ? (
              <>
                <dl className="space-y-1.5 mb-4">
                  {['iou', 'dice', 'precision', 'recall', 'f1'].map((k) => (
                    <Row key={k} label={k.toUpperCase()} value={fmt(test[k])} />
                  ))}
                </dl>
                <p className="label-xs mb-2">Per scenario</p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="txt-faint">
                      <th className="text-left font-medium py-1">Scenario</th>
                      <th className="text-right font-medium">IoU</th>
                      <th className="text-right font-medium">Dice</th>
                      <th className="text-right font-medium">Prec.</th>
                      <th className="text-right font-medium">Recall</th>
                    </tr>
                  </thead>
                  <tbody className="mono">
                    {['oil', 'lookalike', 'nooil'].filter((s) => perClass[s]).map((s) => (
                      <tr key={s} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className="py-1 txt-muted" style={{ fontFamily: 'inherit' }}>{s}</td>
                        <td className="text-right txt">{fmt(perClass[s].iou)}</td>
                        <td className="text-right txt">{fmt(perClass[s].dice)}</td>
                        <td className="text-right txt">{fmt(perClass[s].precision)}</td>
                        <td className="text-right txt">{fmt(perClass[s].recall)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <Empty command="python -m ml.test --config config.yaml" />
            )}
          </Panel>

          <Panel title="Scene-level detection">
            {detection ? (
              <dl className="space-y-1.5">
                <Row label="Scenes evaluated" value={detection.scenes} />
                <Row label="Sensitivity" value={fmt(detection.sensitivity)} />
                <Row label="Specificity" value={fmt(detection.specificity)} />
                <Row label="False-positive rate" value={fmt(detection.false_positive_rate)} />
                {Object.keys(detection)
                  .filter((k) => k.endsWith('_false_alarm_rate'))
                  .map((k) => (
                    <Row
                      key={k}
                      label={k.replace(/_/g, ' ')}
                      value={fmt(detection[k])}
                      warn={detection[k] > 0.3}
                    />
                  ))}
              </dl>
            ) : (
              <Empty command="python -m ml.test --config config.yaml" />
            )}
          </Panel>
        </div>

        <Panel title="Active investigation">
          {investigation ? (
            <div className="space-y-1.5">
              <Row label="ID" value={investigation.id} />
              <Row label="Status" value={investigation.status} />
              <Row
                label="Spill area"
                value={investigation.spill?.geometry?.area_km2
                  ? `${investigation.spill.geometry.area_km2.toFixed(2)} km²` : '—'}
              />
              <Row label="Confidence" value={investigation.spill?.confidence?.category} />
              <Row
                label="Top candidate"
                value={investigation.ranking?.vessels?.[0]
                  ? `${investigation.ranking.vessels[0].name} (${investigation.ranking.vessels[0].correlation_score.toFixed(4)})`
                  : '—'}
              />
              <Link
                to="/investigation"
                className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium"
                style={{ color: 'var(--accent)' }}
              >
                Open investigation <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ) : (
            <p className="text-[13px] txt-muted">
              No active investigation. Run the demo to execute the full pipeline.
            </p>
          )}
        </Panel>
      </div>
    </main>
  )
}

function Stat({ label, value, sub }) {
  return (
    <div className="panel p-3.5">
      <p className="label-xs mb-1.5">{label}</p>
      <p className="text-[15px] font-semibold txt truncate">{value}</p>
      {sub && <p className="text-[11px] txt-faint mt-0.5">{sub}</p>}
    </div>
  )
}

function Panel({ title, children }) {
  return (
    <section className="panel overflow-hidden">
      <div className="panel-head">
        <h2 className="font-semibold text-sm txt">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Row({ label, value, warn }) {
  return (
    <div className="flex justify-between gap-3 text-[13px]">
      <span className="txt-muted capitalize">{label}</span>
      <span className="mono text-xs" style={{ color: warn ? 'var(--warn)' : 'var(--text)' }}>
        {value}
      </span>
    </div>
  )
}

function Empty({ command }) {
  return (
    <div>
      <p className="text-[13px] txt-muted mb-2">Not available yet. Run:</p>
      <code className="cmd">{command}</code>
    </div>
  )
}
