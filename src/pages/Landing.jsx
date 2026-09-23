import React from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, Droplets, Map, Radar, AlertTriangle } from 'lucide-react'

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900">
      {/* Navigation spacer */}
      <div className="h-16"></div>

      {/* Hero Section */}
      <section className="min-h-[calc(100vh-64px)] flex items-center justify-center px-4">
        <motion.div
          className="max-w-4xl text-center"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <div className="mb-6 inline-block">
            <div className="px-4 py-2 rounded-full border border-amber-500/30 bg-amber-500/10">
              <span className="text-amber-400 text-sm font-semibold">Marine Intelligence Platform</span>
            </div>
          </div>

          <h1 className="text-6xl font-bold text-white mb-6 leading-tight">
            Oil Spill Detection & Vessel Attribution
          </h1>

          <p className="text-xl text-gray-300 mb-12 leading-relaxed">
            Advanced satellite imagery analysis combined with AIS vessel tracking and drift modeling to identify responsible vessels in marine environmental incidents.
          </p>

          <div className="flex gap-4 justify-center mb-16">
            <Link to="/investigation">
              <button className="px-8 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold transition-all">
                View Investigation <ArrowRight className="inline w-4 h-4 ml-2" />
              </button>
            </Link>
            <Link to="/dashboard">
              <button className="px-8 py-3 border border-slate-600 hover:border-slate-500 text-white rounded-lg font-semibold transition-all">
                Dashboard
              </button>
            </Link>
          </div>

          {/* Features Grid */}
          <div className="grid grid-cols-3 gap-6">
            {[
              { icon: Radar, label: 'Satellite Detection', desc: 'SAR imagery analysis' },
              { icon: Map, label: 'Drift Modeling', desc: 'Ocean current analysis' },
              { icon: AlertTriangle, label: 'Vessel Correlation', desc: 'AIS trajectory matching' },
            ].map((feature, i) => (
              <motion.div
                key={i}
                className="p-6 rounded-lg border border-slate-700 bg-slate-800/50 backdrop-blur"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.1 }}
              >
                <feature.icon className="w-8 h-8 text-amber-500 mb-3 mx-auto" />
                <p className="font-semibold text-white mb-1">{feature.label}</p>
                <p className="text-sm text-gray-400">{feature.desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* Stats Section */}
      <section className="py-20 px-4 border-t border-slate-700">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-4 gap-8 text-center">
            {[
              { value: '99%', label: 'Detection Confidence' },
              { value: '2,500 km²', label: 'Spill Area' },
              { value: '5', label: 'Vessel Candidates' },
              { value: '0.9721', label: 'Top Correlation' },
            ].map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 10 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
              >
                <p className="text-4xl font-bold text-amber-500 mb-2">{stat.value}</p>
                <p className="text-gray-400">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-20 px-4">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl font-bold text-white mb-6">Ready to Investigate?</h2>
          <p className="text-gray-400 mb-8">
            Access the complete investigation dashboard with satellite detection, interactive mapping, and vessel correlation analysis.
          </p>
          <Link to="/investigation">
            <button className="px-8 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold transition-all">
              Open Dashboard
            </button>
          </Link>
        </div>
      </section>
    </div>
  )
}
