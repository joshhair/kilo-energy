'use client';

/**
 * BaselinePanel — compact "this is YOUR baseline" surface on My Pay.
 *
 * Data lands via /api/auth/baseline which is session-keyed (no userId
 * param). Cross-user reads are structurally impossible — the rep can
 * only see their own role + trainer chain context.
 *
 * What ships here:
 *   - Role badge ("Closer" | "Setter" | "Closer & Setter")
 *   - Trainer chain  → who deducts from the rep's pay (e.g. "Paul Tupou
 *                       takes 10¢/W from your M2 + M3")
 *   - Trainees       → who the rep trains, when they are a trainer
 *
 * Per-installer per-W rates intentionally NOT shown here — they vary by
 * installer + product + tier and have a dedicated home in the Calculator
 * where the rep can view-as themselves.
 */

import { useEffect, useState } from 'react';
import { GraduationCap, Award, Loader2, ChevronDown } from 'lucide-react';

interface BaselineChainEntry {
  assignmentId: string;
  trainerId: string | null;
  trainerName: string;
  activeRatePerW: number | null;
}

interface BaselineTraineeEntry {
  assignmentId: string;
  traineeId: string | null;
  traineeName: string;
  activeRatePerW: number | null;
}

interface BaselineResponse {
  repType: string;
  trainerChain: BaselineChainEntry[];
  trainees: BaselineTraineeEntry[];
}

function formatRepType(repType: string): string {
  if (repType === 'closer') return 'Closer';
  if (repType === 'setter') return 'Setter';
  if (repType === 'both') return 'Closer & Setter';
  return repType;
}

function formatRate(rate: number | null): string {
  if (rate == null) return '—';
  // ¢ display for rates < $1, $ otherwise.
  if (rate < 1) return `${(rate * 100).toFixed(0)}¢/W`;
  return `$${rate.toFixed(2)}/W`;
}

export default function BaselinePanel() {
  const [data, setData] = useState<BaselineResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/auth/baseline');
        if (!res.ok) {
          if (alive) setError(`HTTP ${res.status}`);
          return;
        }
        const json = (await res.json()) as BaselineResponse;
        if (alive) setData(json);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : 'Load failed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <div
        className="card-surface rounded-2xl p-4 mb-4 flex items-center gap-2 text-xs"
        style={{ color: 'var(--text-muted)' }}
      >
        <Loader2 className="w-3 h-3 animate-spin" /> Loading baseline…
      </div>
    );
  }

  if (error || !data) {
    // Silent skip — baseline is informational. Avoid scaring the rep
    // with a generic error when their pay data is rendering fine below.
    return null;
  }

  const hasChain = data.trainerChain.length > 0;
  const hasTrainees = data.trainees.length > 0;
  const hasAnything = hasChain || hasTrainees;

  return (
    <div className="card-surface rounded-2xl p-4 mb-4">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-2 text-left"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="p-1.5 rounded-lg flex-shrink-0"
            style={{ background: 'color-mix(in srgb, var(--accent-emerald-solid) 12%, transparent)' }}
          >
            <Award className="w-4 h-4" style={{ color: 'var(--accent-emerald-text)' }} />
          </div>
          <div className="min-w-0">
            <p
              className="text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'var(--text-muted)' }}
            >
              Your baseline
            </p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              {formatRepType(data.repType)}
              {hasChain && (
                <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-secondary)' }}>
                  · {data.trainerChain.length} trainer
                  {data.trainerChain.length === 1 ? '' : 's'}
                </span>
              )}
              {hasTrainees && (
                <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-secondary)' }}>
                  · training {data.trainees.length} rep{data.trainees.length === 1 ? '' : 's'}
                </span>
              )}
            </p>
          </div>
        </div>
        {hasAnything && (
          <ChevronDown
            className={`w-4 h-4 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            style={{ color: 'var(--text-muted)' }}
          />
        )}
      </button>

      {expanded && hasAnything && (
        <div className="mt-3 pt-3 space-y-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {hasChain && (
            <div>
              <p
                className="text-[10px] font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                <GraduationCap className="w-3 h-3" /> Trainers taking from your pay
              </p>
              <div className="space-y-1.5">
                {data.trainerChain.map((c) => (
                  <div
                    key={c.assignmentId}
                    className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
                    style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
                  >
                    <span style={{ color: 'var(--text-primary)' }}>{c.trainerName}</span>
                    <span
                      className="tabular-nums font-semibold"
                      style={{ color: 'var(--accent-amber-text)' }}
                    >
                      {formatRate(c.activeRatePerW)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-dim)' }}>
                Deducted from your M2 + M3 pay on each deal.
              </p>
            </div>
          )}
          {hasTrainees && (
            <div>
              <p
                className="text-[10px] font-semibold uppercase tracking-widest mb-2 flex items-center gap-1.5"
                style={{ color: 'var(--text-secondary)' }}
              >
                <GraduationCap className="w-3 h-3" /> Reps you train
              </p>
              <div className="space-y-1.5">
                {data.trainees.map((t) => (
                  <div
                    key={t.assignmentId}
                    className="flex items-center justify-between text-xs px-3 py-2 rounded-lg"
                    style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)' }}
                  >
                    <span style={{ color: 'var(--text-primary)' }}>{t.traineeName}</span>
                    <span
                      className="tabular-nums font-semibold"
                      style={{ color: 'var(--accent-emerald-text)' }}
                    >
                      +{formatRate(t.activeRatePerW)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-dim)' }}>
                You earn this slice on each of their M2 + M3 deals.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
