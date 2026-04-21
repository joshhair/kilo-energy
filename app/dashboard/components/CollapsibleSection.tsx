'use client'
import { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface CollapsibleSectionProps {
  title: string
  icon?: ReactNode
  badge?: ReactNode
  actions?: ReactNode
  isOpen: boolean
  onToggle: () => void
  children: ReactNode
}

export function CollapsibleSection({ title, icon, badge, actions, isOpen, onToggle, children }: CollapsibleSectionProps) {
  return (
    <section>
      <div
        className="flex items-center justify-between gap-3 cursor-pointer select-none py-2"
        onClick={onToggle}
        role="button"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          {badge}
        </div>
        <div className="flex items-center gap-3">
          {actions}
          <ChevronDown
            className="w-4 h-4 text-white/40 motion-reduce:transition-none"
            style={{
              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 350ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          />
        </div>
      </div>
      <div
        className="motion-reduce:transition-none"
        style={{
          display: 'grid',
          gridTemplateRows: isOpen ? '1fr' : '0fr',
          transition: 'grid-template-rows 350ms cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div style={{ overflow: 'hidden' }}>
          <div className="pt-3">{children}</div>
        </div>
      </div>
    </section>
  )
}
