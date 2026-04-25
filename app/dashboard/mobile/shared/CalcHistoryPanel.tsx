'use client';

import { useState, useEffect } from 'react';
import { Clock, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { CalcHistoryEntry } from '../MobileCalculator';

interface CalcHistoryPanelProps {
  calcHistory: CalcHistoryEntry[];
  handleLoadHistory: (entry: CalcHistoryEntry) => void;
  handleClearHistory: () => void;
}

export default function CalcHistoryPanel({ calcHistory, handleLoadHistory, handleClearHistory }: CalcHistoryPanelProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [bodyVisible, setBodyVisible] = useState(false);
  const [bodyExiting, setBodyExiting] = useState(false);

  useEffect(() => {
    if (historyOpen) {
      setBodyVisible(true);
      setBodyExiting(false);
    } else if (bodyVisible) {
      setBodyExiting(true);
      const t = setTimeout(() => setBodyVisible(false), 200);
      return () => clearTimeout(t);
    }
  }, [historyOpen, bodyVisible]);

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
        {historyOpen
          ? <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-dim)' }} />
          : <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-dim)' }} />}
      </button>
      {bodyVisible && (
        <div className={`px-4 pb-4 space-y-2 ${bodyExiting ? 'history-exit' : 'history-reveal'}`}>
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
      )}
    </div>
  );
}
