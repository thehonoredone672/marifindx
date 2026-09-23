import React from 'react'
import clsx from 'clsx'

export default function GlassPanel({ children, title, className, ...props }) {
  return (
    <div className={clsx('glass-card rounded-2xl', className)} {...props}>
      {title && (
        <div className="border-b border-white/10 dark:border-white/5 pb-3 mb-4">
          <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-100">{title}</h3>
        </div>
      )}
      {children}
    </div>
  )
}
