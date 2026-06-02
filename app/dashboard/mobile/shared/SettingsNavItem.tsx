'use client';
import { ChevronRight } from 'lucide-react';

const GROUP_ACCENT: Record<string, { bg: string; fg: string }> = {
  Team:     { bg: 'var(--accent-cyan-soft)',    fg: 'var(--accent-cyan-solid)'    },
  Business: { bg: 'var(--accent-emerald-soft)', fg: 'var(--accent-emerald-solid)' },
  System:   { bg: 'var(--accent-amber-soft)',   fg: 'var(--accent-amber-solid)'   },
};

interface SettingsNavItemProps {
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  group: string;
  onTap: () => void;
  animationDelay?: number;
}

export default function SettingsNavItem({ label, icon: Icon, group, onTap, animationDelay }: SettingsNavItemProps) {
  const accent = GROUP_ACCENT[group] ?? { bg: 'var(--surface-card)', fg: 'var(--text-muted)' };
  return (
    <button
      onClick={onTap}
      className="w-full flex items-center gap-3 min-h-[52px] px-4 text-left active:scale-[0.97] transition-transform duration-100 ease-out"
      style={animationDelay !== undefined ? {
        animation: 'ms-nav-item-in 270ms cubic-bezier(0.16,1,0.3,1) both',
        animationDelay: `${animationDelay}ms`,
      } : undefined}
    >
      <span
        className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
        style={{ background: accent.bg }}
      >
        <Icon className="w-[18px] h-[18px]" style={{ color: accent.fg }} />
      </span>
      <span
        className="flex-1 text-base font-medium text-[var(--text-primary)]"
        style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
      >
        {label}
      </span>
      <ChevronRight className="w-4 h-4" style={{ color: 'var(--text-muted)', opacity: 0.5 }} />
    </button>
  );
}
