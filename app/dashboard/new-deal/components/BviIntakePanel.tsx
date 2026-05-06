'use client';

/**
 * BviIntakePanel — conditional new-deal-form section that captures BVI's
 * sales-intake fields when the rep selects BVI as the installer.
 *
 * Mirrors the existing SolarTech / product-catalog conditional-panel
 * pattern in NewDealPage. Owned externally — parent passes the current
 * BviIntake value + utility-bill File via props and receives changes via
 * callbacks. Keeping state external lets the parent include intake
 * fields in `isFormDirty` (regression guard for the setter-on-deal class
 * of issue) and serialize the intake JSON at submit time.
 *
 * Render decision lives at the call site: render this only when
 * `installer === 'BVI'`. Validation is intentionally minimal here —
 * the server-side validateField + Zod schema do the heavy lifting.
 */

import React from 'react';
import { Upload, FileCheck2, X, Mail } from 'lucide-react';
import { TextInput, FormField, Switch } from '@/components/ui';
import type { BviIntake, BviIntakeErrors } from '@/lib/installer-intakes/bvi';

interface Props {
  value: BviIntake;
  onChange: (next: BviIntake) => void;
  utilityBill: File | null;
  onUtilityBillChange: (file: File | null) => void;
  /** Whether the rep wants the handoff email to fire on submit. Default ON. */
  sendOnSubmit: boolean;
  onSendOnSubmitChange: (next: boolean) => void;
  /** Per-field validation errors. Set by parent on submit attempt. */
  errors?: BviIntakeErrors;
}

type ToggleProps = {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
};

/**
 * Y/N segmented control. Three states (null, true, false) — null = not
 * answered yet; selecting Yes or No locks the answer in. We don't allow
 * "deselect" to unanswered because the BVI form's checkboxes don't
 * represent an unanswered state at submission time.
 */
function YesNoToggle({ label, value, onChange }: ToggleProps) {
  return (
    <FormField label={label}>
      <div className="flex gap-2">
        {([
          { v: true,  label: 'Yes' },
          { v: false, label: 'No' },
        ] as const).map(({ v, label: optionLabel }) => (
          <button
            key={String(v)}
            type="button"
            onClick={() => onChange(v)}
            className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
              value === v
                ? 'bg-[var(--accent-emerald-solid)]/20 border-[var(--accent-emerald-solid)] text-[var(--accent-cyan-text)]'
                : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {optionLabel}
          </button>
        ))}
      </div>
    </FormField>
  );
}

export function BviIntakePanel({ value, onChange, utilityBill, onUtilityBillChange, sendOnSubmit, onSendOnSubmitChange, errors }: Props) {
  const set = <K extends keyof BviIntake>(key: K, v: BviIntake[K]) => {
    onChange({ ...value, [key]: v });
  };

  return (
    <div className="card-surface rounded-2xl p-5 mb-6 border border-[var(--accent-cyan-solid)]/30">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--accent-cyan-text)]">
          BVI Sales Intake
        </span>
        <span className="text-[10px] text-[var(--text-muted)] bg-[var(--surface-card)] border border-[var(--border-subtle)]/50 px-1.5 py-0.5 rounded-full">
          Required for BVI projects
        </span>
      </div>
      <p className="text-xs text-[var(--text-muted)] mb-4">
        These fields ship to BVI ops along with the homeowner&apos;s utility bill on submit.
      </p>

      {/* Customer contact — phone/email/address required for BVI ops to
          reach the homeowner; gated at submit time by validateBviIntake. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <FormField label="Customer phone" required error={errors?.customerPhone}>
          <TextInput
            type="tel"
            placeholder="555-0100"
            value={value.customerPhone}
            onChange={(e) => set('customerPhone', e.target.value)}
            invalid={!!errors?.customerPhone}
          />
        </FormField>
        <FormField label="Customer email" required error={errors?.customerEmail}>
          <TextInput
            type="email"
            placeholder="customer@example.com"
            value={value.customerEmail}
            onChange={(e) => set('customerEmail', e.target.value)}
            invalid={!!errors?.customerEmail}
          />
        </FormField>
      </div>
      <FormField label="Customer address" required error={errors?.customerAddress} className="mb-4">
        <TextInput
          placeholder="123 Sunny Lane, Solar City, CA 90210"
          value={value.customerAddress}
          onChange={(e) => set('customerAddress', e.target.value)}
          invalid={!!errors?.customerAddress}
        />
      </FormField>

      {/* System details */}
      <FormField label="Export type" className="mb-4">
        <div className="flex gap-2">
          {(['NEM 3.0', 'Non-Export'] as const).map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => set('exportType', opt)}
              className={`flex-1 py-2 rounded-xl text-xs font-semibold border transition-all ${
                value.exportType === opt
                  ? 'bg-[var(--accent-emerald-solid)]/20 border-[var(--accent-emerald-solid)] text-[var(--accent-cyan-text)]'
                  : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
      </FormField>

      <FormField label="Existing system info (optional)" className="mb-4">
        <textarea
          rows={2}
          value={value.existingSystemInfo}
          onChange={(e) => set('existingSystemInfo', e.target.value)}
          placeholder="Any pre-existing solar/battery on the property"
          className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)] transition-colors"
        />
      </FormField>

      {/* Site survey + access */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <YesNoToggle
          label="Is a site survey needed?"
          value={value.siteSurveyNeeded}
          onChange={(v) => set('siteSurveyNeeded', v)}
        />
        <FormField label="Battery location">
          <div className="grid grid-cols-3 gap-2">
            {(['Inside Garage', 'Outside Garage', 'Other'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => set('batteryLocation', opt)}
                className={`py-2 rounded-xl text-[11px] font-semibold border transition-all ${
                  value.batteryLocation === opt
                    ? 'bg-[var(--accent-emerald-solid)]/20 border-[var(--accent-emerald-solid)] text-[var(--accent-cyan-text)]'
                    : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
        </FormField>
      </div>

      {value.batteryLocation === 'Other' && (
        <FormField label="Battery location detail" className="mb-4">
          <TextInput
            placeholder="e.g. utility room, exterior wall"
            value={value.batteryLocationOther}
            onChange={(e) => set('batteryLocationOther', e.target.value)}
          />
        </FormField>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <YesNoToggle
          label="Dogs on property?"
          value={value.dogsOnProperty}
          onChange={(v) => set('dogsOnProperty', v)}
        />
        <YesNoToggle
          label="Locked gates?"
          value={value.lockedGates}
          onChange={(v) => set('lockedGates', v)}
        />
      </div>

      {value.lockedGates && (
        <FormField label="Gate code or access instructions" className="mb-4">
          <TextInput
            placeholder="Code, lockbox, or install-day arrangement"
            value={value.gateCode}
            onChange={(e) => set('gateCode', e.target.value)}
          />
        </FormField>
      )}

      <FormField
        label="Additional notes for BVI"
        hint="Important notes, special instructions, or feedback for the team."
        className="mb-5"
      >
        <textarea
          rows={3}
          value={value.additionalNotes}
          onChange={(e) => set('additionalNotes', e.target.value)}
          placeholder="Anything BVI needs to know before site survey or install"
          className="w-full bg-[var(--surface-card)] border border-[var(--border)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)] placeholder-[var(--text-dim)] transition-colors"
        />
      </FormField>

      {/* Utility bill upload */}
      <FormField label="Homeowner utility bill" hint="PDF or image, max 10 MB. Sent to BVI ops with the intake form.">
        {utilityBill ? (
          <div className="flex items-center justify-between bg-[var(--surface-card)]/60 border border-[var(--accent-emerald-solid)]/40 rounded-xl px-3 py-2.5">
            <div className="flex items-center gap-2 min-w-0">
              <FileCheck2 className="w-4 h-4 text-[var(--accent-emerald-text)] shrink-0" />
              <span className="text-xs text-[var(--text-primary)] truncate">{utilityBill.name}</span>
              <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                {(utilityBill.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </div>
            <button
              type="button"
              onClick={() => onUtilityBillChange(null)}
              className="text-[var(--text-dim)] hover:text-[var(--accent-red-text)] p-1 transition-colors"
              aria-label="Remove utility bill"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <label className="flex items-center justify-center gap-2 bg-[var(--surface-card)] border border-dashed border-[var(--border)] rounded-xl px-3 py-3 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--accent-emerald-solid)]/60 cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" />
            Upload utility bill (PDF or image)
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/heic,image/heif,image/webp"
              className="hidden"
              onChange={(e) => onUtilityBillChange(e.target.files?.[0] ?? null)}
            />
          </label>
        )}
      </FormField>

      {/* Auto-send toggle — controls whether the deal-create POST fires the
          handoff email after the project is persisted. Default ON so reps
          get the expected behavior; can be turned off if e.g. the rep wants
          to fix the intake before BVI ops sees it. */}
      <div className="mt-5 flex items-center justify-between gap-3 bg-[var(--surface-card)]/40 border border-[var(--border-subtle)]/50 rounded-xl px-3 py-2.5">
        <div className="flex items-start gap-2 min-w-0">
          <Mail className="w-3.5 h-3.5 text-[var(--accent-cyan-text)] mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm text-[var(--text-primary)] font-medium">Send to BVI on submit</p>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
              When ON, BVI ops gets the intake PDF + utility bill emailed automatically once you submit.
            </p>
          </div>
        </div>
        <Switch
          checked={sendOnSubmit}
          onChange={onSendOnSubmitChange}
          ariaLabel={sendOnSubmit ? 'Disable auto-send to BVI' : 'Enable auto-send to BVI'}
        />
      </div>
    </div>
  );
}
