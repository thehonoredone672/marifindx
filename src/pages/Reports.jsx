import React, { useState } from 'react'
import { FileText, Download, Share2 } from 'lucide-react'

const REPORTS = [
  { id: 1, title: 'Investigation Summary', date: '2026-09-22', type: 'summary', pages: 12, size: '2.4 MB' },
  { id: 2, title: 'Spill Detection Analysis', date: '2026-09-22', type: 'technical', pages: 8, size: '1.8 MB' },
  { id: 3, title: 'Vessel Correlation Report', date: '2026-09-22', type: 'vessel', pages: 15, size: '3.1 MB' },
  { id: 4, title: 'Drift Reconstruction Model', date: '2026-09-21', type: 'drift', pages: 11, size: '2.7 MB' },
]

const FILTERS = ['all', 'summary', 'technical', 'vessel', 'drift']

export default function Reports() {
  const [filter, setFilter] = useState('all')
  const shown = filter === 'all' ? REPORTS : REPORTS.filter((r) => r.type === filter)

  return (
    <main className="min-h-screen pt-20 pb-12 app-bg">
      <div className="max-w-4xl mx-auto px-4">
        <header className="mb-5">
          <h1 className="text-xl font-semibold tracking-tight txt">Reports</h1>
          <p className="text-sm txt-muted mt-0.5">Generated analysis and findings</p>
        </header>

        <div className="seg mb-5">
          {FILTERS.map((f) => (
            <button key={f} data-active={filter === f} onClick={() => setFilter(f)}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          {shown.map((r) => (
            <article key={r.id} className="panel p-4">
              <div className="flex items-start gap-3 mb-3">
                <FileText className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
                <div className="min-w-0">
                  <h2 className="font-medium txt text-[14px] leading-snug">{r.title}</h2>
                  <p className="text-[11px] txt-faint mt-1 mono">
                    {r.date} · {r.pages} pages · {r.size}
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pt-3 border-t bd">
                <button className="btn btn-quiet flex-1" style={{ justifyContent: 'center' }}>
                  <Download className="w-3.5 h-3.5" /> Download
                </button>
                <button className="btn btn-quiet flex-1" style={{ justifyContent: 'center' }}>
                  <Share2 className="w-3.5 h-3.5" /> Share
                </button>
              </div>
            </article>
          ))}
        </div>

        <section className="panel overflow-hidden">
          <div className="panel-head">
            <h2 className="font-semibold text-sm txt">Generate report</h2>
          </div>
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="label-xs block mb-1.5">Report type</label>
                <select className="field w-full">
                  <option>Executive summary</option>
                  <option>Technical analysis</option>
                  <option>Vessel correlation</option>
                  <option>Full investigation</option>
                </select>
              </div>
              <div>
                <label className="label-xs block mb-1.5">Format</label>
                <select className="field w-full">
                  <option>PDF</option>
                  <option>HTML</option>
                  <option>JSON</option>
                </select>
              </div>
            </div>

            <fieldset className="mb-4">
              <legend className="label-xs mb-2">Include sections</legend>
              <div className="space-y-1.5">
                {['Spill detection', 'Drift analysis', 'Vessel evidence', 'Timeline', 'Recommendations'].map((s) => (
                  <label key={s} className="flex items-center gap-2.5 text-[13px] txt-muted">
                    <input type="checkbox" defaultChecked style={{ accentColor: 'var(--accent)' }} />
                    {s}
                  </label>
                ))}
              </div>
            </fieldset>

            <button className="btn btn-accent w-full" style={{ justifyContent: 'center' }}>
              Generate report
            </button>

            <p className="mt-3 text-xs txt-faint leading-relaxed">
              Report generation is not wired to a backend endpoint in this
              prototype — the listing above is placeholder content.
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
