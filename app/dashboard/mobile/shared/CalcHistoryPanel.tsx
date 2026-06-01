'use client';

import { useState } from 'react';
import { Clock, ChevronDown, Trash2 } from 'lucide-react';
import { Collapse } from '../../components/Collapse';
import type { CalcHistoryEntry } from '../MobileCalculator';

interface CalcHistoryPanelProps {
  calcHistory: CalcHistoryEntry[];
  handleLoadHistory: (entry: CalcHistoryEntry) => void;
  handleClearHistory: () => void;
}

export default function CalcHistoryPanel({ calcHistory, handleLoadHistory, handleClearHistory }: CalcHistoryPanelProps) {
  const [historyOpen, setHistoryOpen] = useState(false);

  if (calcHistory.length === 0) return null;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}>
      <button
        type="button"
        onClick={() => setHistoryOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <div className="flex items-center gap-2">
          <Clock className="w-3.5 h-3.5" style={{ color: 'var(--text-dim)' }} />
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Recent Calcs</span>
          <span className="text-xs" style={{ color: 'var(--text-dim)' }}>({calcHistory.length})</span>
        </div>
        <ChevronDown
          className={`w-4 h-4 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${historyOpen ? 'rotate-180' : ''}`}
          style={{ color: 'var(--text-dim)' }}
        />
      </button>
      <Collapse open={historyOpen} durationMs={300}>
        <div
          className="px-4 pb-4 space-y-2"
        >
          {calcHistory.map((entry, i) => (
            <div
              key={`${entry.timestamp}-${i}`}
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
              style={{ background: 'var(--surface-pressed)', border: '1px solid var(--border-subtle)' }}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                  {entry.installer} · {entry.kW.toFixed(1)} kW @ ${entry.ppw.toFixed(2)}/W
                </p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                  Closer: ${entry.closerTotal.toLocaleString()}
                  {entry.hasSetter && entry.setterTotal > 0 ? ` · Setter: $${entry.setterTotal.toLocaleString()}` : ''}
                  {entry.trainerTotal > 0 ? ` · Trainer: $${entry.trainerTotal.toLocaleString()}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => { handleLoadHistory(entry); setHistoryOpen(false); }}
                className="flex-shrink-0 text-xs font-semibold rounded-lg px-3 min-h-[44px] flex items-center"
                style={{ color: 'var(--accent-blue-text)', background: 'var(--accent-blue-soft)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
              >
                Load
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={handleClearHistory}
            className="flex items-center gap-1.5 text-xs mt-1 min-h-[44px]"
            style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
          >
            <Trash2 className="w-3 h-3" />
            Clear History
          </button>
        </div>
      </Collapse>
    </div>
  );
}
