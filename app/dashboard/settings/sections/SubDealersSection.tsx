'use client';

import React, { useState } from 'react';
import { Plus, Trash2, Handshake } from 'lucide-react';
import { useApp } from '../../../../lib/context';
import { useToast } from '../../../../lib/toast';
import { validateName, validateEmail, validatePhone } from '../../../../lib/validation';
import ConfirmDialog from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { SectionHeader } from '../components/SectionHeader';
import { PrimaryButton, IconButton, TextInput, FormField } from '@/components/ui';

export function SubDealersSection() {
  const { subDealers, addSubDealer, deactivateSubDealer, projects } = useApp();
  const { toast } = useToast();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  const firstNameCheck = firstName.trim().length > 0 ? validateName(firstName) : null;
  const lastNameCheck = lastName.trim().length > 0 ? validateName(lastName) : null;
  const emailCheck = email.trim().length > 0
    ? validateEmail(email, { siblings: subDealers.map((sd) => ({ id: sd.id, email: sd.email })) })
    : null;
  const phoneCheck = phone.trim().length > 0 ? validatePhone(phone, { allowEmpty: true }) : null;

  const canSubmit =
    firstNameCheck?.ok === true &&
    lastNameCheck?.ok === true &&
    (emailCheck === null || emailCheck.ok === true) &&
    (phoneCheck === null || phoneCheck.ok === true);

  const handleAdd = () => {
    if (!canSubmit || !firstNameCheck?.ok || !lastNameCheck?.ok) return;
    addSubDealer(firstNameCheck.value, lastNameCheck.value, emailCheck?.ok ? emailCheck.value : '', phoneCheck?.ok ? phoneCheck.value : '');
    toast(`Added sub-dealer ${firstNameCheck.value} ${lastNameCheck.value}`, 'success');
    setFirstName('');
    setLastName('');
    setEmail('');
    setPhone('');
  };

  return (
    <div key="sub-dealers" className="animate-tab-enter max-w-xl">
      <SectionHeader title="Sub-Dealers" subtitle="Manage sub-dealer accounts and track their deals" />

      <div className="card-surface rounded-2xl p-5 mb-4">
        <h2 className="text-[var(--text-primary)] font-semibold mb-3">Add Sub-Dealer</h2>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <FormField error={firstNameCheck && !firstNameCheck.ok ? firstNameCheck.reason : undefined}>
            <TextInput
              placeholder="First name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              invalid={firstNameCheck?.ok === false}
            />
          </FormField>
          <FormField error={lastNameCheck && !lastNameCheck.ok ? lastNameCheck.reason : undefined}>
            <TextInput
              placeholder="Last name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              invalid={lastNameCheck?.ok === false}
            />
          </FormField>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <FormField error={emailCheck && !emailCheck.ok ? emailCheck.reason : undefined}>
            <TextInput
              type="email"
              placeholder="Email (optional)"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              invalid={emailCheck?.ok === false}
            />
          </FormField>
          <FormField error={phoneCheck && !phoneCheck.ok ? phoneCheck.reason : undefined}>
            <TextInput
              type="tel"
              placeholder="Phone (optional)"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              invalid={phoneCheck?.ok === false}
            />
          </FormField>
        </div>
        <PrimaryButton onClick={handleAdd} disabled={!canSubmit}>
          <Plus className="w-3.5 h-3.5" /> Add Sub-Dealer
        </PrimaryButton>
      </div>

      <div className="card-surface rounded-2xl">
        <div className="px-5 py-3.5 border-b border-[var(--border-subtle)]">
          <p className="text-[var(--text-primary)] font-semibold text-sm">{subDealers.length} Sub-Dealer{subDealers.length !== 1 ? 's' : ''}</p>
        </div>
        {subDealers.length === 0 ? (
          <div className="px-5 py-2">
            <EmptyState
              icon={Handshake}
              title="No sub-dealers yet"
              description="Add a sub-dealer above. They'll be able to log in and submit deals on your behalf."
              variant="inline"
            />
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {subDealers.map((sd) => {
              const dealCount = projects.filter((p) => p.subDealerId === sd.id).length;
              return (
                <div key={sd.id} className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-[var(--surface-card)]/30 transition-colors">
                  <div className="min-w-0 flex-1">
                    <p className="text-[var(--text-primary)] text-sm font-medium truncate">{sd.name}</p>
                    <p className="text-[var(--text-muted)] text-xs truncate">{sd.email}{sd.phone ? ` · ${sd.phone}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-[var(--text-muted)] text-xs tabular-nums">{dealCount} deal{dealCount !== 1 ? 's' : ''}</span>
                    <IconButton
                      variant="danger"
                      aria-label={`Deactivate ${sd.name}`}
                      onClick={() => setConfirmRemove(sd.id)}
                      title="Deactivate sub-dealer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </IconButton>
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
