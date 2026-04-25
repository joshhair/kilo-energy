'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import MobileBottomSheet from '../shared/MobileBottomSheet';
import { useToast } from '../../../../lib/toast';
import { sortForSelection } from '../../../../lib/sorting';

const STATUS_OPTIONS = ['upcoming', 'active', 'completed', 'cancelled'] as const;

const SELECT_STYLE = {
  background: 'var(--surface-card)',
  border: '1px solid var(--border-subtle)',
  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
  '--tw-ring-color': 'var(--accent-emerald-solid)',
} as React.CSSProperties;

interface Rep { id: string; name: string }

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  blitz: any;
  isAdmin: boolean;
  reps: Rep[];
}

export default function BlitzEditSheet({ open, onClose, onSaved, blitz, isAdmin, reps }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '', location: '', housing: '', startDate: '', endDate: '', notes: '', status: 'upcoming', ownerId: '',
  });

  useEffect(() => {
    if (!open || !blitz) return;
    setForm({
      name: blitz.name ?? '',
      location: blitz.location ?? '',
      housing: blitz.housing ?? '',
      startDate: blitz.startDate ?? '',
      endDate: blitz.endDate ?? '',
      notes: blitz.notes ?? '',
      status: blitz.status ?? 'upcoming',
      ownerId: blitz.owner?.id ?? '',
    });
  }, [open, blitz]);

  const handleSave = async () => {
    if (!form.name.trim()) { toast('Blitz name is required', 'error'); return; }
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      toast('End date must be on or after start date', 'error');
      return;
    }
    setSaving(true);
    try {
      // Owner change: ensure new owner is an approved participant first, so the
      // participants PATCH doesn't 403 on the old ownerId check.
      if (isAdmin && form.ownerId && blitz?.owner?.id !== form.ownerId) {
        const existing = (blitz?.participants ?? []).find((p: any) => p.user.id === form.ownerId);
        if (!existing) {
          const pr = await fetch(`/api/blitzes/${blitz.id}/participants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: form.ownerId, joinStatus: 'approved' }),
          });
          if (!pr.ok) { toast('Failed to add new owner as participant', 'error'); return; }
        } else if (existing.joinStatus !== 'approved') {
          const pr = await fetch(`/api/blitzes/${blitz.id}/participants`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: form.ownerId, joinStatus: 'approved' }),
          });
          if (!pr.ok) { toast('Failed to approve new owner', 'error'); return; }
        }
      }
      const body = isAdmin ? form : (({ ownerId: _o, status: _s, ...rest }) => rest)(form);
      const r = await fetch(`/api/blitzes/${blitz.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) { toast('Failed to update blitz', 'error'); return; }
      toast('Blitz updated');
      onSaved();
      onClose();
    } catch {
      toast('Network error — changes may not have been saved', 'error');
    } finally { setSaving(false); }
  };

  const sortedReps = sortForSelection(reps);

  return (
    <MobileBottomSheet open={open} onClose={onClose} title="Edit Blitz">
      <div className="px-5 space-y-3 pb-4">
        <Field label="Name">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[48px] focus:outline-none focus:ring-1"
            style={SELECT_STYLE}
          />
        </Field>
        <Field label="Location">
          <input
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value })}
            className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[48px] focus:outline-none focus:ring-1"
            style={SELECT_STYLE}
          />
        </Field>
        <Field label="Housing">
          <input
            value={form.housing}
            onChange={(e) => setForm({ ...form, housing: e.target.value })}
            placeholder="Optional"
            className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[48px] focus:outline-none focus:ring-1"
            style={SELECT_STYLE}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Starts">
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
              className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[48px] focus:outline-none focus:ring-1"
              style={SELECT_STYLE}
            />
          </Field>
          <Field label="Ends">
            <input
              type="date"
              value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })}
              className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[48px] focus:outline-none focus:ring-1"
              style={SELECT_STYLE}
            />
          </Field>
        </div>
        {isAdmin && (
          <>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[48px] focus:outline-none focus:ring-1"
                style={SELECT_STYLE}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
                ))}
              </select>
            </Field>
            <Field label="Leader">
              <select
                value={form.ownerId}
                onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
                className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[48px] focus:outline-none focus:ring-1"
                style={SELECT_STYLE}
              >
                <option value="">Unassigned</option>
                {sortedReps.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </Field>
          </>
        )}
        <Field label="Notes">
          <textarea
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={3}
            className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[80px] resize-none focus:outline-none focus:ring-1"
            style={SELECT_STYLE}
          />
        </Field>

        <button
          onClick={handleSave}
          disabled={saving || !form.name.trim()}
          className="w-full flex items-center justify-center gap-1.5 min-h-[48px] text-base font-semibold text-black rounded-lg disabled:opacity-40 transition-colors mt-2"
          style={{
            background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))',
            boxShadow: '0 0 20px var(--accent-emerald-glow)',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </MobileBottomSheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs mb-1 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{label}</label>
      {children}
    </div>
  );
}
