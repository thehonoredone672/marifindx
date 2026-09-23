import React from 'react'
import clsx from 'clsx'

export default function GlassButton({ children, variant = 'primary', className, ...props }) {
  const variants = {
    primary: 'bg-gradient-to-r from-primary-600 to-secondary text-white hover:shadow-lg',
    secondary: 'glass-light text-gray-700 dark:text-gray-200 hover:bg-white/20 dark:hover:bg-white/10',
    ghost: 'hover:bg-white/10 dark:hover:bg-white/5 text-gray-700 dark:text-gray-200',
  }

  return (
    <button
      className={clsx(
        'px-4 py-2 rounded-lg font-medium transition-all duration-200',
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </button>
  )
}
