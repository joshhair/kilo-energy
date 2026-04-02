'use client';

import { useMemo } from 'react';
import { X } from 'lucide-react';

interface DateRangeFilterProps {
  from: string;
  to: string;
  onFromChange: (val: string) => void;
  onToChange: (val: string) => void;
  onClear: () => void;
}

interface Preset {
  label: string;
  getRange: () => { from: string; to: string };
}

function toISO(d: Date): string {
  return d.toISOString().split('T')[0];
}

function getPresets(): Preset[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  return [
    {
      label: 'This Month',
      getRange: () => ({
        from: toISO(new Date(y, m, 1)),
        to: toISO(new Date(y, m + 1, 0)),
      }),
    },
    {
      label: 'Last Month',
      getRange: () => ({
        from: toISO(new Date(y, m - 1, 1)),
        to: toISO(new Date(y, m, 0)),
      }),
    },
    {
      label: 'Last 30 Days',
      getRange: () => {
        const end = new Date(now);
        const start = new Date(now);
        start.setDate(start.getDate() - 30);
        return { from: toISO(start), to: toISO(end) };
      },
    },
    {
      label: 'This Quarter',
      getRange: () => {
        const qStart = Math.floor(m / 3) * 3;
        return {
          from: toISO(new Date(y, qStart, 1)),
          to: toISO(new Date(y, qStart + 3, 0)),
        };
      },
    },
  ];
}

export function DateRangeFilter({ from, to, onFromChange, onToChange, onClear }: DateRangeFilterProps) {
  const presets = useMemo(() => getPresets(), []);

  const activePreset = useMemo(() => {
    if (!from && !to) return null;
    for (const p of presets) {
      const r = p.getRange();
      if (r.from === from && r.to === to) return p.label;
    }
    return null;
  }, [from, to, presets]);

  const applyPreset = (preset: Preset) => {
    const r = preset.getRange();
    onFromChange(r.from);
    onToChange(r.to);
  };

  const inputCls =
    'bg-slate-800 border border-slate-700 text-white rounded-lg px-3 py-1.5 text-xs focus:outline-none input-focus-glow';

  return (
    <div className="flex flex-col gap-2">
      {/* Preset pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {presets.map((p) => {
          const isActive = activePreset === p.label;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => applyPreset(p)}
              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                isActive
                  ? 'bg-blue-500/20 text-blue-400 border-blue-500/30'
                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-500 hover:text-white'
              }`}
            >
              {p.label}
            </button>
          );
        })}
        {(from || to) && (
          <button
            type="button"
            onClick={onClear}
            className="px-2.5 py-1 text-xs rounded-lg border bg-slate-800 text-slate-400 border-slate-700 hover:border-red-500/50 hover:text-red-400 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Date inputs */}
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-500 whitespace-nowrap">From</label>
        <input
          type="date"
          value={from}
          onChange={(e) => onFromChange(e.target.value)}
          className={inputCls}
        />
        <label className="text-xs text-slate-500 whitespace-nowrap">To</label>
        <input
          type="date"
          value={to}
          onChange={(e) => onToChange(e.target.value)}
          className={inputCls}
        />
        {(from || to) && (
          <button
            type="button"
            onClick={onClear}
            className="p-1 rounded-md text-slate-500 hover:text-white hover:bg-slate-700 transition-colors"
            title="Clear dates"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
