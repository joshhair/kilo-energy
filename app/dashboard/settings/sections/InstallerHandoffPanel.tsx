'use client';

/**
 * InstallerHandoffPanel — per-installer handoff config editor.
 *
 * Embedded in the InstallersSection expansion area. Loads the current
 * config from /api/installers/[id]/handoff-config, lets admin edit
 * primaryEmail / ccEmails[] / subjectPrefix / customNotes / handoffEnabled,
 * saves back via PATCH.
 *
 * UX choices:
 *   - Single Save button (vs auto-save) — handoff config sets are small
 *     and intentional; admin should review before flipping handoffEnabled.
 *   - ccEmails edited as a multi-row list mirroring the prepaid-options
 *     pattern (add row, edit inline, trash to remove). Validation runs
 *     server-side; client surfaces the rejection reason in a toast.
 *   - Test-send button: deferred to Phase 7 when the handoff endpoint
 *     exists. Placeholder shown disabled.
 */

import React, { useEffect, useState } from 'react';
import { Plus, Save, Trash2, Mail, AlertCircle, Loader2 } from 'lucide-react';
import { useToast } from '../../../../lib/toast';
import {
  PrimaryButton,
  SecondaryButton,
  TextInput,
  FormField,
  IconButton,
  Switch,
} from '@/components/ui';

interface HandoffConfig {
  id: string;
  primaryEmail: string | null;
  ccEmails: string[];
  subjectPrefix: string | null;
  handoffEnabled: boolean;
  customNotes: string;
}

interface Props {
  installerId: string;
  installerName: string;
}

export function InstallerHandoffPanel({ installerId, installerName }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [primaryEmail, setPrimaryEmail] = useState('');
  const [ccEmails, setCcEmails] = useState<string[]>([]);
  const [newCc, setNewCc] = useState('');
  const [subjectPrefix, setSubjectPrefix] = useState('');
  const [customNotes, setCustomNotes] = useState('');
  const [handoffEnabled, setHandoffEnabled] = useState(false);
  const [initialState, setInitialState] = useState<HandoffConfig | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/installers/${installerId}/handoff-config`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as HandoffConfig;
        if (cancelled) return;
        setInitialState(data);
        setPrimaryEmail(data.primaryEmail ?? '');
        setCcEmails(data.ccEmails);
        setSubjectPrefix(data.subjectPrefix ?? '');
        setCustomNotes(data.customNotes);
        setHandoffEnabled(data.handoffEnabled);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [installerId]);

  const dirty =
    !!initialState &&
    (primaryEmail.trim() !== (initialState.primaryEmail ?? '') ||
      ccEmails.join(',') !== initialState.ccEmails.join(',') ||
      (subjectPrefix.trim() || null) !== (initialState.subjectPrefix?.trim() || null) ||
      customNotes !== initialState.customNotes ||
      handoffEnabled !== initialState.handoffEnabled);

  const canEnable = primaryEmail.trim().length > 0;

  const addCc = () => {
    const v = newCc.trim();
    if (!v) return;
    if (ccEmails.includes(v.toLowerCase())) {
      toast(`${v} already in CC list`, 'error');
      return;
    }
    setCcEmails((prev) => [...prev, v]);
    setNewCc('');
  };

  const removeCc = (i: number) => {
    setCcEmails((prev) => prev.filter((_, j) => j !== i));
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        primaryEmail: primaryEmail.trim() || null,
        ccEmails,
        subjectPrefix: subjectPrefix.trim() || null,
        customNotes,
        handoffEnabled,
      };
      const res = await fetch(`/api/installers/${installerId}/handoff-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as HandoffConfig & { error?: string };
      if (!res.ok) {
        toast(data.error || `Save failed (${res.status})`, 'error');
        return;
      }
      setInitialState(data);
      setPrimaryEmail(data.primaryEmail ?? '');
      setCcEmails(data.ccEmails);
      setSubjectPrefix(data.subjectPrefix ?? '');
      setCustomNotes(data.customNotes);
      setHandoffEnabled(data.handoffEnabled);
      toast(`Saved handoff config for ${installerName}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="px-4 pb-4 pt-1 border-t border-[var(--border-subtle)]/50">
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] py-3">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading handoff config…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-4 pb-4 pt-1 border-t border-[var(--border-subtle)]/50">
        <div className="flex items-center gap-2 text-xs text-[var(--accent-red-text)] py-3">
          <AlertCircle className="w-3.5 h-3.5" /> {error}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 pt-1 border-t border-[var(--border-subtle)]/50">
      <p className="text-xs font-semibold text-[var(--accent-cyan-text)]/80 uppercase tracking-wider mb-3">
        Handoff Email Config
      </p>

      <div className="space-y-3">
        <FormField label="Primary email (To)">
          <TextInput
            type="email"
            placeholder="ops@bvisolar.com"
            value={primaryEmail}
            onChange={(e) => setPrimaryEmail(e.target.value)}
          />
        </FormField>

        <div>
          <label className="block text-xs text-[var(--text-secondary)] mb-1">CC emails</label>
          {ccEmails.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {ccEmails.map((cc, i) => (
                <div key={i} className="flex items-center justify-between bg-[var(--surface-card)]/50 rounded-lg px-3 py-2 group/cc">
                  <span className="text-[var(--text-primary)] text-xs font-mono">{cc}</span>
                  <IconButton
                    aria-label={`Remove ${cc}`}
                    variant="danger"
                    onClick={() => removeCc(i)}
                    className="opacity-0 group-hover/cc:opacity-100"
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
              placeholder="cc@bvisolar.com"
              value={newCc}
              onChange={(e) => setNewCc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCc(); } }}
            />
            <IconButton
              aria-label="Add CC email"
              variant="success"
              onClick={addCc}
              disabled={!newCc.trim()}
            >
              <Plus className="w-3.5 h-3.5" />
            </IconButton>
          </div>
        </div>

        <FormField label="Subject prefix" hint='e.g. "[BVI]" — appears before the customer-keyed subject line.'>
          <TextInput
            placeholder="[BVI]"
            value={subjectPrefix}
            onChange={(e) => setSubjectPrefix(e.target.value)}
          />
        </FormField>

        <FormField label="Custom note (optional)" hint="Appended verbatim to the email body. Use for SLA reminders or installer-specific instructions.">
          <textarea
            rows={3}
            value={customNotes}
            onChange={(e) => setCustomNotes(e.target.value)}
            className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)] transition-colors disabled:opacity-60"
            placeholder="Per our agreement, please acknowledge receipt within 24 hours."
          />
        </FormField>

        <div>
          <div className="flex items-center justify-between bg-[var(--surface-card)]/40 rounded-xl px-3 py-2.5">
            <div>
              <p className="text-sm text-[var(--text-primary)] font-medium flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-[var(--accent-cyan-text)]" />
                Auto-send on deal submission
              </p>
              <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
                When ON, every new {installerName} deal triggers the handoff email automatically.
              </p>
            </div>
            <Switch
              checked={handoffEnabled}
              onChange={setHandoffEnabled}
              ariaLabel={`${handoffEnabled ? 'Disable' : 'Enable'} auto-send for ${installerName}`}
            />
          </div>
          {handoffEnabled && !canEnable && (
            <p className="flex items-center gap-1.5 text-[var(--accent-amber-text)] text-xs mt-2">
              <AlertCircle className="w-3 h-3" />
              Set a primary email above before saving — handoff can&apos;t send without one.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <SecondaryButton
            size="sm"
            disabled={!dirty || saving}
            onClick={() => {
              if (!initialState) return;
              setPrimaryEmail(initialState.primaryEmail ?? '');
              setCcEmails(initialState.ccEmails);
              setSubjectPrefix(initialState.subjectPrefix ?? '');
              setCustomNotes(initialState.customNotes);
              setHandoffEnabled(initialState.handoffEnabled);
            }}
          >
            Reset
          </SecondaryButton>
          <PrimaryButton
            size="sm"
            disabled={!dirty || saving}
            loading={saving}
            onClick={onSave}
          >
            <Save className="w-3.5 h-3.5" /> Save
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
