'use client';

import { useState } from 'react';
import { Plus, Trash2, DollarSign, Loader2 } from 'lucide-react';
import MobileEmptyState from '../shared/MobileEmptyState';
import MobileBottomSheet from '../shared/MobileBottomSheet';
import ConfirmDialog from '../../components/ConfirmDialog';
import { formatDate, formatCurrency } from '../../../../lib/utils';
import { useToast } from '../../../../lib/toast';

const COST_CATEGORIES = ['housing', 'travel', 'gas', 'meals', 'incentives', 'swag', 'other'] as const;

interface Cost {
  id: string;
  category: string;
  description?: string;
  date: string;
  amount: number;
}

interface Props {
  blitzId: string;
  costs: Cost[];
  onRefresh: () => void;
}

export default function BlitzCosts({ blitzId, costs, onRefresh }: Props) {
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [category, setCategory] = useState<string>('housing');
  const [amount, setAmount] = useState('');
  const [desc, setDesc] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [adding, setAdding] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const total = costs.reduce((s, c) => s + c.amount, 0);

  const handleAdd = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    setAdding(true);
    try {
      const r = await fetch(`/api/blitzes/${blitzId}/costs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, amount: parseFloat(amount), description: desc.trim(), date }),
      });
      if (!r.ok) { toast('Failed to add cost', 'error'); return; }
      toast('Cost added');
      setAmount('');
      setDesc('');
      setShowAdd(false);
      onRefresh();
    } catch { toast('Failed to add cost', 'error'); }
    finally { setAdding(false); }
  };

  const handleDelete = async () => {
    if (!confirmDeleteId) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/blitzes/${blitzId}/costs?costId=${confirmDeleteId}`, { method: 'DELETE' });
      if (!r.ok) { toast('Failed to remove cost', 'error'); return; }
      toast('Cost removed');
      onRefresh();
    } catch { toast('Failed to remove cost', 'error'); }
    finally { setDeleting(false); setConfirmDeleteId(null); }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowAdd(true)}
        className="flex items-center gap-1.5 text-base font-semibold min-h-[48px]"
        style={{ color: 'var(--accent-emerald-text)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
      >
        <Plus className="w-4 h-4" /> Add Cost
      </button>

      {costs.length === 0 ? (
        <MobileEmptyState icon={DollarSign} title="No costs recorded" subtitle="Track blitz expenses here" />
      ) : (
        <div>
          {costs.map((c, index) => (
            <div
              key={c.id}
              className="flex items-center justify-between min-h-[48px] py-3 last:border-b-0 animate-info-row-enter"
              style={{ borderBottom: '1px solid var(--border-subtle)', animationDelay: `${index * 35}ms` }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold capitalize" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{c.category}</span>
                  {c.description && (
                    <span className="text-base truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>&middot; {c.description}</span>
                  )}
                </div>
                <p className="text-base mt-0.5" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{formatDate(c.date)}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                <span className="text-lg font-bold text-[var(--text-primary)] tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCurrency(c.amount)}</span>
                <button
                  onClick={() => setConfirmDeleteId(c.id)}
                  className="p-2 active:opacity-70 min-w-[44px] min-h-[44px] flex items-center justify-center"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-3">
            <span className="text-base font-semibold" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Total</span>
            <span className="text-lg font-bold text-[var(--text-primary)]" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCurrency(total)}</span>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDeleteId !== null}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleDelete}
        title="Remove Cost"
        message="Are you sure you want to remove this cost?"
        confirmLabel={deleting ? 'Removing...' : 'Remove'}
        danger
      />

      <MobileBottomSheet open={showAdd} onClose={() => setShowAdd(false)} title="Add Cost">
        <div className="px-5 space-y-4">
          <div>
            <label className="block text-xs mb-1 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[48px] focus:outline-none focus:ring-1"
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald-solid)',
              } as React.CSSProperties}
            >
              {COST_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[48px] focus:outline-none focus:ring-1"
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald-solid)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs mb-1 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Description</label>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[48px] focus:outline-none focus:ring-1"
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald-solid)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs mb-1 uppercase tracking-widest" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-base text-[var(--text-primary)] min-h-[48px] focus:outline-none focus:ring-1"
              style={{
                background: 'var(--surface-card)',
                border: '1px solid var(--border-subtle)',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald-solid)',
              } as React.CSSProperties}
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={adding || !amount}
            className="w-full flex items-center justify-center gap-1.5 min-h-[48px] text-base font-semibold text-black rounded-lg disabled:opacity-40 transition-colors"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald-solid), var(--accent-cyan-solid))',
              boxShadow: '0 0 20px var(--accent-emerald-glow)',
              fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
            }}
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {adding ? 'Adding...' : 'Add Cost'}
          </button>
        </div>
      </MobileBottomSheet>
    </div>
  );
}
