import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Cpu, Database, Play, Loader2, ArrowRight } from 'lucide-react'
import useInvestigationStore from '../context/investigationStore'
import api from '../services/api'

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
    <div className="min-h-screen pt-20 pb-12 bg-slate-950">
      <div className="max-w-6xl mx-auto px-4">
        <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white">Dashboard</h1>
            <p className="text-sm text-slate-400">Model status and pipeline health</p>
          </div>
          <button
            onClick={() => runDemo().catch(() => {})}
            disabled={loading || unreachable}
            className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold flex items-center gap-2"
          >
            {loading
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Running…</>
              : <><Play className="w-4 h-4" /> Run Demo Investigation</>}
          </button>
        </header>

        {unreachable && (
          <div className="mb-6 p-4 rounded-lg border border-red-500/40 bg-red-500/10">
            <p className="text-red-200 font-semibold mb-1">Backend unreachable</p>
            <code className="text-xs text-red-300/80 font-mono">
              uvicorn backend.main:app --reload
            </code>
          </div>
        )}

        {synthetic && (
          <div className="mb-6 p-4 rounded-lg border border-purple-500/40 bg-purple-500/10">
            <p className="text-purple-200 font-semibold mb-1">
              Model trained on synthetic pipeline-validation data
            </p>
            <p className="text-sm text-purple-200/75">
              These metrics show the training and inference code runs correctly.
              They are not real oil-spill detection performance. Retrain on the
              Zenodo Sentinel-1 corpus for meaningful figures.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Stat
            icon={Cpu}
            label="Checkpoint"
            value={modelStatus?.checkpoint_present ? 'Loaded' : 'Missing'}
            sub={modelStatus?.size_mb ? `${modelStatus.size_mb} MB` : undefined}
          />
          <Stat
            icon={Activity}
            label="Device"
            value={(modelStatus?.device ?? '—').toUpperCase()}
            sub={modelStatus?.cuda_available ? 'CUDA available' : 'CPU only'}
          />
          <Stat
            icon={Database}
            label="Encoder"
            value={meta?.architecture?.encoder ?? '—'}
            sub={meta?.architecture?.parameters
              ? `${(meta.architecture.parameters / 1e6).toFixed(1)}M params`
              : undefined}
          />
          <Stat
            icon={Activity}
            label="Best val Dice"
            value={meta?.validation_metrics?.best_dice?.toFixed(4) ?? '—'}
            sub={meta?.best_epoch ? `epoch ${meta.best_epoch}` : undefined}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <Panel title="Held-out test metrics">
            {test ? (
              <>
                <dl className="space-y-1.5 mb-4">
                  {['iou', 'dice', 'precision', 'recall', 'f1'].map((k) => (
                    <Row key={k} label={k.toUpperCase()} value={fmt(test[k])} />
                  ))}
                </dl>
                <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">
                  Per scenario
                </p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="text-left font-medium py-1">Scenario</th>
                      <th className="text-right font-medium">IoU</th>
                      <th className="text-right font-medium">Dice</th>
                      <th className="text-right font-medium">Prec.</th>
                      <th className="text-right font-medium">Recall</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {['oil', 'lookalike', 'nooil'].filter((s) => perClass[s]).map((s) => (
                      <tr key={s} className="border-t border-slate-800">
                        <td className="py-1 text-slate-300 font-sans">{s}</td>
                        <td className="text-right text-white">{fmt(perClass[s].iou)}</td>
                        <td className="text-right text-white">{fmt(perClass[s].dice)}</td>
                        <td className="text-right text-white">{fmt(perClass[s].precision)}</td>
                        <td className="text-right text-white">{fmt(perClass[s].recall)}</td>
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
                className="mt-3 inline-flex items-center gap-1.5 text-sm text-amber-500 hover:text-amber-400 font-semibold"
              >
                Open investigation <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              No active investigation. Run the demo to execute the full pipeline.
            </p>
          )}
        </Panel>
      </div>
    </div>
  )
}

const fmt = (v) =>
  v === null || v === undefined || Number.isNaN(v) ? 'n/a' : Number(v).toFixed(4)

function Stat({ icon: Icon, label, value, sub }) {
  return (
    <div className="p-4 rounded-lg border border-slate-800 bg-slate-900">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-slate-400">{label}</span>
        <Icon className="w-4 h-4 text-amber-500" />
      </div>
      <p className="text-lg font-bold text-white truncate">{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function Panel({ title, children }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="font-semibold text-white text-sm">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function Row({ label, value, warn }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-slate-400 capitalize">{label}</span>
      <span className={`font-mono text-[13px] ${warn ? 'text-amber-400' : 'text-white'}`}>
        {value}
      </span>
    </div>
  )
}

function Empty({ command }) {
  return (
    <div>
      <p className="text-sm text-slate-500 mb-2">Not available yet. Run:</p>
      <code className="block p-2 rounded bg-slate-950 text-emerald-300 font-mono text-xs">
        {command}
      </code>
    </div>
  )
}
