'use client';

import React, { useState } from 'react';
import { Plus, Trash2, Handshake } from 'lucide-react';
import { useApp } from '../../../../lib/context';
import { useToast } from '../../../../lib/toast';
import ConfirmDialog from '../../components/ConfirmDialog';
import { SectionHeader } from '../components/SectionHeader';

export function SubDealersSection() {
  const { subDealers, addSubDealer, deactivateSubDealer, projects } = useApp();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const handleAdd = () => {
    if (!firstName.trim() || !lastName.trim()) {
      toast('First and last name are required', 'error');
      return;
    }
    if (email.trim() && subDealers.some((sd) => sd.email.toLowerCase() === email.trim().toLowerCase())) {
      toast('A sub-dealer with this email already exists', 'error');
      return;
    }
    addSubDealer(firstName, lastName, email, phone);
    toast(`Added sub-dealer ${firstName.trim()} ${lastName.trim()}`, 'success');
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
  };

  return (
    <div key="sub-dealers" className="animate-tab-enter max-w-xl">
      <SectionHeader title="Sub-Dealers" subtitle="Manage sub-dealer accounts and track their deals" />

      {/* Add sub-dealer form */}
      <div className="card-surface rounded-2xl p-5 mb-4">
        <h2 className="text-white font-semibold mb-3">Add Sub-Dealer</h2>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input
            type="text" placeholder="First name"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            className="bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]"
          />
          <input
            type="text" placeholder="Last name"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            className="bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]"
          />
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <input
            type="email" placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]"
          />
          <input
            type="tel" placeholder="Phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)]"
          />
        </div>
        <button
          onClick={handleAdd}
          disabled={!firstName.trim() || !lastName.trim()}
          className="btn-primary text-black text-sm px-4 py-2 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
        >
          <Plus className="w-3.5 h-3.5" /> Add Sub-Dealer
        </button>
      </div>

      {/* Sub-dealer list */}
      <div className="card-surface rounded-2xl">
        <div className="px-5 py-3.5 border-b border-[var(--border-subtle)]">
          <p className="text-white font-semibold text-sm">{subDealers.length} Sub-Dealer{subDealers.length !== 1 ? 's' : ''}</p>
        </div>
        {subDealers.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Handshake className="w-6 h-6 text-[var(--text-dim)] mx-auto mb-2" />
            <p className="text-[var(--text-muted)] text-xs">No sub-dealers added yet</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {subDealers.map((sd) => {
              const dealCount = projects.filter((p) => p.subDealerId === sd.id).length;
              return (
                <div key={sd.id} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[var(--surface-card)]/30 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-medium truncate">{sd.name}</p>
                    <p className="text-[var(--text-muted)] text-xs truncate">{sd.email}{sd.phone ? ` \u00b7 ${sd.phone}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[var(--text-muted)] text-xs tabular-nums">{dealCount} deal{dealCount !== 1 ? 's' : ''}</span>
                    <button
                      onClick={() => setConfirmRemove(sd.id)}
                      className="text-[var(--text-dim)] hover:text-red-400 transition-colors p-1"
                      title="Deactivate sub-dealer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmRemove}
        onClose={() => setConfirmRemove(null)}
        onConfirm={async () => {
          if (confirmRemove) {
            const sd = subDealers.find((s) => s.id === confirmRemove);
            await deactivateSubDealer(confirmRemove);
            toast(`Deactivated sub-dealer ${sd?.name ?? ''}`, 'success');
          }
          setConfirmRemove(null);
        }}
        title="Deactivate Sub-Dealer"
        message="They will lose app access immediately. Their existing deals and history are preserved. You can reactivate them later from their profile."
        confirmLabel="Deactivate"
        danger
      />
    </div>
  );
}
