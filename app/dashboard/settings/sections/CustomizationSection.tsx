'use client';

import React, { useEffect, useState } from 'react';
import { Plus, Trash2, AlertCircle, Loader2, Save } from 'lucide-react';
import { SectionHeader } from '../components/SectionHeader';
import { useToast } from '../../../../lib/toast';
import { PrimaryButton, SecondaryButton, TextInput, FormField, IconButton } from '@/components/ui';

/**
 * CustomizationSection — admin-managed config for the daily stalled-projects digest.
 *
 * Pre-2026-04-29 this stored phase thresholds in localStorage. Now everything is
 * server-backed via /api/admin/stalled-config (single-row StalledAlertConfig).
 * On first load we silently promote any old localStorage values to the server,
 * so admins who tuned thresholds before the migration don't lose them.
 */

const DEFAULT_THRESHOLDS: Record<string, number> = {
  'New': 5, 'Acceptance': 10, 'Site Survey': 20, 'Design': 30,
  'Permitting': 50, 'Pending Install': 65, 'Installed': 75,
};

const PHASES_TRACKED = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed'] as const;
const LEGACY_LOCAL_STORAGE_KEY = 'kilo-pipeline-thresholds';

interface StalledConfigState {
  enabled: boolean;
  soldDateCutoffDays: number;
  digestRecipients: string[];
  phaseThresholds: Record<string, number>;
  digestSendHourUtc: number;
}

const EMPTY_STATE: StalledConfigState = {
  enabled: true,
  soldDateCutoffDays: 180,
  digestRecipients: [],
  phaseThresholds: { ...DEFAULT_THRESHOLDS },
  digestSendHourUtc: 15,
};

export function CustomizationSection() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initial, setInitial] = useState<StalledConfigState | null>(null);
  const [state, setState] = useState<StalledConfigState>(EMPTY_STATE);
  const [newRecipient, setNewRecipient] = useState('');

  // Initial load — fetch server config, then merge any legacy localStorage
  // thresholds (one-shot migration so admins don't lose their settings).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/admin/stalled-config');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as StalledConfigState;
        if (cancelled) return;

        // Merge in any phaseThresholds defaults missing from server response
        const merged: StalledConfigState = {
          ...data,
          phaseThresholds: { ...DEFAULT_THRESHOLDS, ...data.phaseThresholds },
        };

        // Legacy migration: if localStorage has values and the server's
        // phaseThresholds is empty (i.e. just our defaults filling in),
        // push the local values to the server. One-shot, idempotent.
        try {
          const raw = typeof window !== 'undefined' ? window.localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY) : null;
          if (raw && Object.keys(data.phaseThresholds).length === 0) {
            const parsed = JSON.parse(raw) as Record<string, unknown>;
            const cleaned: Record<string, number> = {};
            for (const phase of PHASES_TRACKED) {
              const v = parsed[phase];
              if (typeof v === 'number' && Number.isFinite(v) && v >= 1) cleaned[phase] = Math.floor(v);
            }
            if (Object.keys(cleaned).length > 0) {
              merged.phaseThresholds = { ...merged.phaseThresholds, ...cleaned };
              // Push to server (non-blocking; ignore failures — user can save manually)
              void fetch('/api/admin/stalled-config', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phaseThresholds: cleaned }),
              });
              try { window.localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY); } catch { /* ignore */ }
            }
          }
        } catch {
          // Ignore localStorage failures (private mode, parse errors, etc.)
        }

        setInitial(merged);
        setState(merged);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load alert config');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dirty = !!initial && JSON.stringify(state) !== JSON.stringify(initial);

  const addRecipient = () => {
    const v = newRecipient.trim();
    if (!v) return;
    if (state.digestRecipients.includes(v.toLowerCase())) {
      toast(`${v} already in recipient list`, 'error');
      return;
    }
    setState((s) => ({ ...s, digestRecipients: [...s.digestRecipients, v] }));
    setNewRecipient('');
  };

  const removeRecipient = (i: number) => {
    setState((s) => ({ ...s, digestRecipients: s.digestRecipients.filter((_, j) => j !== i) }));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/stalled-config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state),
      });
      const data = (await res.json()) as StalledConfigState & { error?: string };
      if (!res.ok) {
        toast(data.error || `Save failed (${res.status})`, 'error');
        return;
      }
      const merged: StalledConfigState = {
        ...data,
        phaseThresholds: { ...DEFAULT_THRESHOLDS, ...data.phaseThresholds },
      };
      setInitial(merged);
      setState(merged);
      toast('Saved alert config', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div key="customization" className="animate-tab-enter max-w-xl">
        <SectionHeader title="Customization" subtitle="Adjust pipeline alert thresholds" />
        <div className="card-surface rounded-2xl p-5 flex items-center gap-2 text-sm text-[var(--text-muted)]">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading config…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div key="customization" className="animate-tab-enter max-w-xl">
        <SectionHeader title="Customization" subtitle="Adjust pipeline alert thresholds" />
        <div className="card-surface rounded-2xl p-5 flex items-center gap-2 text-sm text-[var(--accent-red-text)]">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      </div>
    );
  }

  return (
    <div key="customization" className="animate-tab-enter max-w-xl">
      <SectionHeader title="Customization" subtitle="Stalled-project alerts and pipeline thresholds" />

      {/* Master switch + cutoff */}
      <div className="card-surface rounded-2xl p-5 mb-4">
        <h2 className="text-[var(--text-primary)] font-semibold mb-1">Stalled Project Digest</h2>
        <p className="text-[var(--text-muted)] text-xs mb-4">Daily summary email of projects sitting too long in their current phase.</p>

        <div className="flex items-center justify-between bg-[var(--surface-card)]/40 rounded-xl px-3 py-2.5 mb-4">
          <div>
            <p className="text-sm text-[var(--text-primary)] font-medium">Enabled</p>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">When OFF, no digest emails are sent regardless of cron firing.</p>
          </div>
          <button
            role="switch"
            aria-checked={state.enabled}
            onClick={() => setState((s) => ({ ...s, enabled: !s.enabled }))}
            className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 cursor-pointer ${
              state.enabled ? 'bg-[var(--accent-emerald-solid)]' : 'bg-[var(--border)]'
            }`}
          >
            <span
              className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                state.enabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Sold-date cutoff (days)" hint="Projects sold longer ago than this are exempt from alerts.">
            <TextInput
              type="number"
              min={1}
              max={3650}
              value={String(state.soldDateCutoffDays)}
              onChange={(e) => setState((s) => ({ ...s, soldDateCutoffDays: Math.max(1, parseInt(e.target.value) || 1) }))}
            />
          </FormField>
          <FormField label="Send hour (UTC)" hint="0–23. 15 = 8am Pacific.">
            <TextInput
              type="number"
              min={0}
              max={23}
              value={String(state.digestSendHourUtc)}
              onChange={(e) => setState((s) => ({
                ...s,
                digestSendHourUtc: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)),
              }))}
            />
          </FormField>
        </div>
      </div>

      {/* Digest recipients */}
      <div className="card-surface rounded-2xl p-5 mb-4">
        <h2 className="text-[var(--text-primary)] font-semibold mb-1">Digest Recipients</h2>
        <p className="text-[var(--text-muted)] text-xs mb-4">Email addresses that receive the daily stalled-projects digest.</p>

        {state.digestRecipients.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {state.digestRecipients.map((email, i) => (
              <div key={i} className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-lg px-3 py-2 group/recip">
                <span className="text-[var(--text-primary)] text-xs font-mono">{email}</span>
                <IconButton
                  aria-label={`Remove ${email}`}
                  variant="danger"
                  onClick={() => removeRecipient(i)}
                  className="opacity-0 group-hover/recip:opacity-100"
                >
                  <Trash2 className="w-3 h-3" />
                </IconButton>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <TextInput
            type="email"
            placeholder="ops@kiloenergies.com"
            value={newRecipient}
            onChange={(e) => setNewRecipient(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRecipient(); } }}
          />
          <IconButton
            aria-label="Add digest recipient"
            variant="success"
            onClick={addRecipient}
            disabled={!newRecipient.trim()}
          >
            <Plus className="w-3.5 h-3.5" />
          </IconButton>
        </div>
        {state.digestRecipients.length === 0 && (
          <p className="text-[10px] text-[var(--text-dim)] mt-2">No recipients configured. The digest will not send.</p>
        )}
      </div>

      {/* Phase thresholds */}
      <div className="card-surface rounded-2xl p-5 mb-4">
        <h2 className="text-[var(--text-primary)] font-semibold mb-1">Phase Thresholds (days)</h2>
        <p className="text-[var(--text-muted)] text-xs mb-4">A project is flagged as stalled when it has been in this phase longer than the threshold.</p>
        <div className="space-y-3">
          {PHASES_TRACKED.map((phase) => (
            <div key={phase} className="flex items-center justify-between gap-4">
              <span className="text-sm text-[var(--text-secondary)] min-w-[140px]">{phase}</span>
              <TextInput
                type="number"
                min={1}
                max={3650}
                value={String(state.phaseThresholds[phase] ?? DEFAULT_THRESHOLDS[phase])}
                onChange={(e) => setState((s) => ({
                  ...s,
                  phaseThresholds: { ...s.phaseThresholds, [phase]: Math.max(1, parseInt(e.target.value) || 1) },
                }))}
                className="!w-24 text-center"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3 mb-6">
        <PrimaryButton disabled={!dirty || saving} loading={saving} onClick={onSave}>
          <Save className="w-4 h-4" /> Save Changes
        </PrimaryButton>
        <SecondaryButton
          disabled={!dirty || saving}
          onClick={() => {
            if (initial) setState(initial);
            setNewRecipient('');
          }}
        >
          Reset
        </SecondaryButton>
        <SecondaryButton
          disabled={saving}
          onClick={() => {
            setState((s) => ({ ...s, phaseThresholds: { ...DEFAULT_THRESHOLDS } }));
          }}
        >
          Reset Phase Thresholds to Defaults
        </SecondaryButton>
      </div>
    </div>
  );
}
