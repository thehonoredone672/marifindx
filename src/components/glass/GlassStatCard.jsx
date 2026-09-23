import React from 'react'

export default function GlassStatCard({ icon: Icon, label, value, unit, secondary }) {
  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">{label}</p>
          <div className="flex items-baseline gap-1">
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
            {unit && <p className="text-sm text-gray-600 dark:text-gray-400">{unit}</p>}
          </div>
          {secondary && (
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">{secondary}</p>
          )}
        </div>
        {Icon && (
          <div className="p-2 rounded-lg bg-gradient-to-br from-primary-500/20 to-secondary/20">
            <Icon className="w-5 h-5 text-primary-600 dark:text-secondary" />
          </div>
        )}
      </div>
    </div>
  )
}
