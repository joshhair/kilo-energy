'use client';

/**
 * Shared primitives of the mobile New Deal wizard — extracted verbatim
 * from MobileNewDeal.tsx (T4.1, 2026-06-11). validateField/genId/
 * FieldError/DEAL_STEPS deliberately MIRROR the desktop copies in
 * app/dashboard/new-deal/components/shared.tsx (ADR 006 parallel files);
 * deduping the twins is explicit T4.2 follow-up — do not unify here.
 * Animation classes (step-dot, deal-step-counter, deal-title-enter) live
 * in app/globals.css.
 */

import type { CoPartyDraft } from '../../projects/components/CoPartySection';

/**
 * Bottom offset for the portaled fixed CTA bars so they clear the REAL
 * bottom-nav height. BottomNav measures itself and publishes
 * --kilo-bottom-nav-h; the REP nav is TALLER than the ADMIN nav because of
 * the protruding primary "New Deal" button (BottomNav.tsx `-mt-2.5`). A
 * hardcoded 72px therefore slid the CTA down BEHIND the nav whenever an admin
 * viewed-as-rep (2026-06-14 regression; same class as the 85db48e project-
 * detail fix). max() makes the offset MONOTONIC — it equals the legacy
 * 72px+safe-area floor when the nav is short (admin: zero visual change) and
 * grows only when the measured nav is taller (rep), so it physically cannot
 * push the CTA toward the nav. The pill variant uses a 60px floor to preserve
 * its original tuck.
 */
export const NAV_CLEAR_BOTTOM =
  'max(calc(72px + env(safe-area-inset-bottom, 0px)), var(--kilo-bottom-nav-h, 0px))';
export const PILL_CLEAR_BOTTOM =
  'max(calc(60px + env(safe-area-inset-bottom, 0px)), var(--kilo-bottom-nav-h, 0px))';

/** Mirror of MobileNewDeal's blankForm() shape — keep in lockstep. */
export interface MobileDealForm {
  customerName: string;
  soldDate: string;
  installer: string;
  financer: string;
  productType: string;
  kWSize: string;
  netPPW: string;
  notes: string;
  repId: string;
  setterId: string;
  solarTechFamily: string;
  solarTechProductId: string;
  pcFamily: string;
  installerProductId: string;
  prepaidSubType: string;
  leadSource: string;
  blitzId: string;
  additionalClosers: CoPartyDraft[];
  additionalSetters: CoPartyDraft[];
}

// ── Validation (mirrors desktop exactly) ────────────────────────────────────

export function validateField(field: string, value: string): string {
  switch (field) {
    case 'repId':        return value ? '' : 'Closer is required';
    case 'customerName': return value.trim() ? '' : 'Customer name is required';
    case 'soldDate':     return value ? '' : 'Sold date is required';
    case 'installer':    return value ? '' : 'Installer is required';
    case 'financer':     return value ? '' : 'Financer is required';
    case 'productType':  return value ? '' : 'Product type is required';
    case 'solarTechFamily':    return value ? '' : 'Product family is required';
    case 'solarTechProductId': return value ? '' : 'Product is required';
    case 'pcFamily':           return value ? '' : 'Product family is required';
    case 'installerProductId': return value ? '' : 'Product is required';
    case 'prepaidSubType':     return value ? '' : 'Prepaid type is required';
    case 'blitzId':            return value ? '' : 'Blitz is required';
    case 'kWSize':
      if (!value) return 'kW size is required';
      if (parseFloat(value) < 1) return 'Must be at least 1 kW';
      return '';
    case 'netPPW':
      if (!value) return 'Net PPW is required';
      if (parseFloat(value) <= 0) return 'Must be greater than 0';
      return '';
    default: return '';
  }
}

export function genId(prefix: string): string {
  return `${prefix}_${Date.now()}`;
}

// ── Inline components ────────────────────────────────────────────────────────

export function FieldError({ field, errors }: { field: string; errors: Record<string, string> }) {
  return errors[field] ? (
    <p className="text-[var(--accent-red-text)] text-base mt-1" role="alert">{errors[field]}</p>
  ) : null;
}

// ── Step indicator ───────────────────────────────────────────────────────────

export const DEAL_STEPS = ['People', 'Deal Details', 'Review & Notes'] as const;

export function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <div className="flex items-center gap-1.5">
        {DEAL_STEPS.map((_, idx) => (
          <div
            key={idx}
            className="step-dot rounded-full"
            style={{
              width:  idx === currentStep ? 10 : 8,
              height: idx === currentStep ? 10 : 8,
              background: idx === currentStep
                ? 'var(--accent-emerald-solid)'
                : idx < currentStep
                ? 'color-mix(in srgb, var(--accent-emerald-solid) 35%, transparent)'
                : 'color-mix(in srgb, var(--text-primary) 18%, transparent)',
              transition: 'all 320ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              flexShrink: 0,
            }}
          />
        ))}
      </div>
      <span
        key={currentStep}
        className="deal-step-counter"
        style={{
          display: 'inline-block',
          animation: 'deal-title-enter 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
          fontSize: '12px',
          color: 'var(--text-muted)',
          fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
        }}
      >
        Step {currentStep + 1} of {DEAL_STEPS.length}
      </span>
    </div>
  );
}

