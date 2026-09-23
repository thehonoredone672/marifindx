import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { FileText, Download, Share2, Calendar } from 'lucide-react'

export default function Reports() {
  const [selectedType, setSelectedType] = useState('all')

  const reports = [
    { id: 1, title: 'Investigation Summary', date: '2026-09-22', type: 'summary', pages: 12, size: '2.4 MB' },
    { id: 2, title: 'Spill Detection Analysis', date: '2026-09-22', type: 'technical', pages: 8, size: '1.8 MB' },
    { id: 3, title: 'Vessel Correlation Report', date: '2026-09-22', type: 'vessel', pages: 15, size: '3.1 MB' },
    { id: 4, title: 'Drift Reconstruction Model', date: '2026-09-21', type: 'drift', pages: 11, size: '2.7 MB' },
  ]

  const filtered = selectedType === 'all' ? reports : reports.filter(r => r.type === selectedType)

  return (
    <div className="min-h-screen pt-20 pb-12 bg-slate-900">
      <div className="max-w-6xl mx-auto px-4">
        {/* Header */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h1 className="text-3xl font-bold text-white mb-2">Investigation Reports</h1>
          <p className="text-gray-400">Generated analysis and findings</p>
        </motion.div>

        {/* Filter */}
        <div className="mb-8 flex gap-3">
          {['all', 'summary', 'technical', 'vessel', 'drift'].map(type => (
            <button
              key={type}
              onClick={() => setSelectedType(type)}
              className={`px-4 py-2 rounded-lg transition-all text-sm font-semibold ${
                selectedType === type
                  ? 'bg-amber-600 text-white'
                  : 'bg-slate-800 border border-slate-700 text-gray-300 hover:border-slate-600'
              }`}
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>

        {/* Reports Grid */}
        <div className="grid grid-cols-2 gap-6 mb-8">
          {filtered.map(report => (
            <motion.div
              key={report.id}
              className="p-6 rounded-lg border border-slate-700 bg-slate-800 hover:border-slate-600 transition-all"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <div className="flex items-start gap-4 mb-4">
                <div className="p-3 rounded-lg bg-amber-500/20">
                  <FileText className="w-6 h-6 text-amber-500" />
                </div>
                <div className="flex-1">
                  <h3 className="font-bold text-white">{report.title}</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    {report.pages} pages · {report.size}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-400 mb-4">
                <Calendar className="w-4 h-4" />
                {report.date}
              </div>

              <div className="flex gap-2 pt-4 border-t border-slate-700">
                <button className="flex-1 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2">
                  <Download className="w-4 h-4" /> Download
                </button>
                <button className="flex-1 px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2">
                  <Share2 className="w-4 h-4" /> Share
                </button>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Generate Report */}
        <motion.div
          className="p-6 rounded-lg border border-slate-700 bg-slate-800"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <h3 className="text-lg font-bold text-white mb-4">Generate New Report</h3>

          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Report Type</label>
              <select className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white">
                <option>Executive Summary</option>
                <option>Technical Analysis</option>
                <option>Vessel Correlation</option>
                <option>Full Investigation</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-300 mb-2">Format</label>
              <select className="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-white">
                <option>PDF</option>
                <option>HTML</option>
                <option>JSON</option>
              </select>
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-300 mb-3">Include Sections</label>
            <div className="space-y-2">
              {['Spill Detection', 'Drift Analysis', 'Vessel Evidence', 'Timeline', 'Recommendations'].map(section => (
                <label key={section} className="flex items-center gap-3">
                  <input type="checkbox" defaultChecked className="w-4 h-4 rounded" />
                  <span className="text-sm text-gray-300">{section}</span>
                </label>
              ))}
            </div>
          </div>

          <button className="w-full px-6 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold transition-all">
            Generate Report
          </button>
        </motion.div>
      </div>
    </div>
  )
}
