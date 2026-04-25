'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderKanban, ArrowUpDown } from 'lucide-react';
import MobileBadge from '../shared/MobileBadge';
import MobileEmptyState from '../shared/MobileEmptyState';
import { formatCurrency } from '../../../../lib/utils';

interface Props {
  projects: any[];
  approvedParticipantIds: Set<string>;
  showPayout: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  effectiveRepId: string | null;
}

type SortKey = 'customer' | 'kw' | 'ppw' | 'payout';

function calcPayout(p: any, approvedIds: Set<string>): number {
  const isSelfGen = p.closer?.id && p.closer?.id === p.setter?.id;
  const closerApproved = p.closer?.id && approvedIds.has(p.closer.id);
  const setterApproved = p.setter?.id && approvedIds.has(p.setter.id);
  const ccTotal = (p.additionalClosers ?? [])
    .filter((cc: any) => approvedIds.has(cc.userId))
    .reduce((s: number, cc: any) => s + (cc.m1Amount ?? 0) + (cc.m2Amount ?? 0) + (cc.m3Amount ?? 0), 0);
  const csTotal = (p.additionalSetters ?? [])
    .filter((cs: any) => approvedIds.has(cs.userId))
    .reduce((s: number, cs: any) => s + (cs.m1Amount ?? 0) + (cs.m2Amount ?? 0) + (cs.m3Amount ?? 0), 0);
  return (closerApproved ? (p.m1Amount ?? 0) + (p.m2Amount ?? 0) + (p.m3Amount ?? 0) : 0)
    + ((isSelfGen ? closerApproved : setterApproved) ? (p.setterM1Amount ?? 0) + (p.setterM2Amount ?? 0) + (p.setterM3Amount ?? 0) : 0)
    + ccTotal + csTotal;
}

export default function BlitzDeals({ projects, approvedParticipantIds, showPayout, isAdmin, isOwner, effectiveRepId }: Props) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'kw', dir: 'desc' });

  const sorted = useMemo(() => {
    const arr = [...projects];
    arr.sort((a, b) => {
      let av: number | string; let bv: number | string;
      if (sort.key === 'customer') { av = a.customerName ?? ''; bv = b.customerName ?? ''; }
      else if (sort.key === 'kw') { av = a.kWSize ?? 0; bv = b.kWSize ?? 0; }
      else if (sort.key === 'ppw') { av = a.netPPW ?? 0; bv = b.netPPW ?? 0; }
      else { av = calcPayout(a, approvedParticipantIds); bv = calcPayout(b, approvedParticipantIds); }
      if (av < bv) return sort.dir === 'asc' ? -1 : 1;
      if (av > bv) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return arr;
  }, [projects, sort, approvedParticipantIds]);

  const cycleSort = (key: SortKey) => setSort((cur) => ({ key, dir: cur.key === key && cur.dir === 'desc' ? 'asc' : 'desc' }));

  const sortOptions: { key: SortKey; label: string }[] = [
    { key: 'customer', label: 'Name' },
    { key: 'kw', label: 'kW' },
    { key: 'ppw', label: 'PPW' },
    ...(showPayout ? [{ key: 'payout' as SortKey, label: 'Payout' }] : []),
  ];

  if (projects.length === 0) {
    return (
      <div className="space-y-4">
        <MobileEmptyState icon={FolderKanban} title="No deals yet" subtitle="Deals attributed to this blitz will appear here" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Sort pills */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <ArrowUpDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-dim)' }} />
        {sortOptions.map((opt) => {
          const active = sort.key === opt.key;
          return (
            <button
              key={opt.key}
              onClick={() => cycleSort(opt.key)}
              className="text-xs font-semibold rounded-full px-3 py-1 shrink-0 transition-colors"
              style={{
                color: active ? '#000' : 'var(--text-muted)',
                background: active ? 'var(--accent-emerald-solid)' : 'var(--surface-card)',
                border: `1px solid ${active ? 'var(--accent-emerald-solid)' : 'var(--border-subtle)'}`,
                fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
              }}
            >
              {opt.label}{active ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}
            </button>
          );
        })}
      </div>

      <div className="rounded-2xl divide-y" style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', borderColor: 'var(--border-subtle)' }}>
        {sorted.map((p) => {
          const closerName = p.closer ? `${p.closer.firstName} ${p.closer.lastName}` : '—';
          const role = (!isAdmin && !isOwner && effectiveRepId)
            ? (p.closer?.id === effectiveRepId && p.setter?.id === effectiveRepId ? 'Self-gen'
              : (p.closer?.id === effectiveRepId || p.additionalClosers?.some((c: any) => c.userId === effectiveRepId)) ? 'Closer'
              : 'Setter')
            : null;
          const payout = showPayout ? calcPayout(p, approvedParticipantIds) : 0;
          return (
            <button
              key={p.id}
              onClick={() => router.push(`/dashboard/projects/${p.id}`)}
              className="w-full text-left px-4 py-3 active:opacity-70 min-h-[72px] flex items-center gap-3"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-base font-semibold text-white truncate" style={{ fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>{p.customerName}</p>
                </div>
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
                  {closerName} · {p.kWSize?.toFixed(1)} kW · ${p.netPPW?.toFixed(2)}/W{role ? ` · ${role}` : ''}
                </p>
                <div className="mt-1">
                  <MobileBadge value={p.phase} variant="phase" />
                </div>
              </div>
              {showPayout && payout > 0 && (
                <div className="text-right shrink-0">
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Payout</p>
                  <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--accent-emerald-solid)', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{formatCurrency(Math.round(payout))}</p>
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
