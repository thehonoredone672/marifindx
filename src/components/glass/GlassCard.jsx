import React from 'react'
import clsx from 'clsx'

export default function GlassCard({ children, className, hover = true, ...props }) {
  return (
    <div
      className={clsx(
        'glass-card rounded-2xl p-6',
        hover && 'hover:shadow-lg cursor-default',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
