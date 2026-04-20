'use client';

import { useState } from 'react';
import { Plus, Trash2, DollarSign, Loader2 } from 'lucide-react';
import MobileEmptyState from '../shared/MobileEmptyState';
import MobileBottomSheet from '../shared/MobileBottomSheet';
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

  const total = costs.reduce((s, c) => s + c.amount, 0);

  const handleAdd = async () => {
    if (!amount || parseFloat(amount) <= 0) return;
    setAdding(true);
    try {
      await fetch(`/api/blitzes/${blitzId}/costs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, amount: parseFloat(amount), description: desc.trim(), date }),
      });
      toast('Cost added');
      setAmount('');
      setDesc('');
      setShowAdd(false);
      onRefresh();
    } finally { setAdding(false); }
  };

  const handleDelete = async (costId: string) => {
    await fetch(`/api/blitzes/${blitzId}/costs?costId=${costId}`, { method: 'DELETE' });
    toast('Cost removed');
    onRefresh();
  };

  return (
    <div className="space-y-4">
      <button
        onClick={() => setShowAdd(true)}
        className="flex items-center gap-1.5 text-base font-semibold min-h-[48px]"
        style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}
      >
        <Plus className="w-4 h-4" /> Add Cost
      </button>

      {costs.length === 0 ? (
        <MobileEmptyState icon={DollarSign} title="No costs recorded" subtitle="Track blitz expenses here" />
      ) : (
        <div>
          {costs.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between min-h-[48px] py-3 last:border-b-0"
              style={{ borderBottom: '1px solid var(--m-border, var(--border-mobile))' }}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-base font-semibold capitalize" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{c.category}</span>
                  {c.description && (
                    <span className="text-base truncate" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>&middot; {c.description}</span>
                  )}
                </div>
                <p className="text-base mt-0.5" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{formatDate(c.date)}</p>
              </div>
              <div className="flex items-center gap-3 shrink-0 ml-3">
                <span className="text-lg font-bold text-white tabular-nums" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCurrency(c.amount)}</span>
                <button
                  onClick={() => handleDelete(c.id)}
                  className="p-2 active:opacity-70 min-w-[44px] min-h-[44px] flex items-center justify-center"
                  style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
          <div className="flex items-center justify-between pt-3">
            <span className="text-base font-semibold" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Total</span>
            <span className="text-lg font-bold text-white" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCurrency(total)}</span>
          </div>
        </div>
      )}

      <MobileBottomSheet open={showAdd} onClose={() => setShowAdd(false)} title="Add Cost">
        <div className="px-5 space-y-4">
          <div>
            <label className="block text-xs mb-1 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-base text-white min-h-[48px] focus:outline-none focus:ring-1"
              style={{
                background: 'var(--m-card, var(--surface-mobile-card))',
                border: '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald)',
              } as React.CSSProperties}
            >
              {COST_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs mb-1 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg px-3 py-2 text-base text-white min-h-[48px] focus:outline-none focus:ring-1"
              style={{
                background: 'var(--m-card, var(--surface-mobile-card))',
                border: '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs mb-1 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Description</label>
            <input
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-lg px-3 py-2 text-base text-white min-h-[48px] focus:outline-none focus:ring-1"
              style={{
                background: 'var(--m-card, var(--surface-mobile-card))',
                border: '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald)',
              } as React.CSSProperties}
            />
          </div>
          <div>
            <label className="block text-xs mb-1 uppercase tracking-widest" style={{ color: 'var(--m-text-dim, #445577)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-base text-white min-h-[48px] focus:outline-none focus:ring-1"
              style={{
                background: 'var(--m-card, var(--surface-mobile-card))',
                border: '1px solid var(--m-border, var(--border-mobile))',
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                '--tw-ring-color': 'var(--accent-emerald)',
              } as React.CSSProperties}
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={adding || !amount}
            className="w-full flex items-center justify-center gap-1.5 min-h-[48px] text-base font-semibold text-black rounded-lg disabled:opacity-40 transition-colors"
            style={{
              background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
              boxShadow: '0 0 20px rgba(0,229,160,0.3)',
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
