'use client';

import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme, type ThemePreference } from '../../../../lib/use-theme';

const OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: 'system', label: 'System', hint: 'Follow OS preference', icon: Monitor },
  { value: 'dark', label: 'Dark', hint: 'Always dark', icon: Moon },
  { value: 'light', label: 'Light', hint: 'Always light', icon: Sun },
];

export default function AppearanceSection() {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <div
      className="rounded-xl p-6"
      style={{ background: 'var(--surface-card)', border: '1px solid var(--border-default)' }}
    >
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Theme</h2>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Currently {resolved}
        </span>
      </div>
      <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>
        Choose how Kilo looks. &quot;System&quot; tracks your operating system preference and updates automatically when it changes.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {OPTIONS.map(({ value, label, hint, icon: Icon }) => {
          const active = preference === value;
          return (
            <button
              key={value}
              onClick={() => setPreference(value)}
              aria-pressed={active}
              className="flex flex-col items-start gap-2 p-4 rounded-lg text-left transition-colors min-h-[88px]"
              style={{
                background: active ? 'var(--accent-emerald-soft)' : 'var(--surface-pressed)',
                border: active
                  ? '1px solid var(--accent-emerald-solid)'
                  : '1px solid var(--border-default)',
                color: active ? 'var(--accent-emerald-solid)' : 'var(--text-primary)',
              }}
            >
              <div className="flex items-center gap-2">
                <Icon className="w-4 h-4" />
                <span className="font-semibold">{label}</span>
              </div>
              <span className="text-xs" style={{ color: active ? 'var(--accent-emerald-solid)' : 'var(--text-muted)' }}>
                {hint}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
