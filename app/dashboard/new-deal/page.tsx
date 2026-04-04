'use client';

import { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useIsHydrated, useMediaQuery } from '../../../lib/hooks';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import {
  PRODUCT_TYPES, Project,
  getTrainerOverrideRate, calculateCommission,
  SOLARTECH_FAMILIES, SOLARTECH_FAMILY_FINANCER, SOLARTECH_PRODUCTS,
  getSolarTechBaseline, getInstallerRatesForDeal, getProductCatalogBaselineVersioned,
  INSTALLER_PAY_CONFIGS, DEFAULT_INSTALL_PAY_PCT,
} from '../../../lib/data';
import { Check, Loader2, PlusCircle, CheckCircle2, ArrowRight, RotateCcw } from 'lucide-react';
import { SetterPickerPopover } from '../components/SetterPickerPopover';
import { SearchableSelect } from '../components/SearchableSelect';
import { Breadcrumb } from '../components/Breadcrumb';
import MobileNewDeal from '../mobile/MobileNewDeal';

// ── Validation ────────────────────────────────────────────────────────────────

function validateField(field: string, value: string): string {
  switch (field) {
    case 'repId':        return value ? '' : 'Closer is required';
    case 'customerName': return value.trim() ? '' : 'Customer name is required';
    case 'soldDate':     return value ? '' : 'Sold date is required';
    case 'installer':    return value ? '' : 'Installer is required';
    case 'financer':     return value ? '' : 'Financer is required'; // skipped at call-site when product type is Cash
    case 'productType':  return value ? '' : 'Product type is required';
    case 'solarTechFamily':    return value ? '' : 'Product family is required';
    case 'solarTechProductId': return value ? '' : 'Product is required';
    case 'pcFamily':           return value ? '' : 'Product family is required';
    case 'installerProductId': return value ? '' : 'Product is required';
    case 'kWSize':
      if (!value) return 'kW size is required';
      if (parseFloat(value) <= 0) return 'Must be greater than 0';
      return '';
    case 'netPPW':
      if (!value) return 'Net PPW is required';
      if (parseFloat(value) <= 0) return 'Must be greater than 0';
      return '';
    default: return '';
  }
}

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}`;
}

// ── FieldError ────────────────────────────────────────────────────────────────

function FieldError({ field, errors }: { field: string; errors: Record<string, string> }) {
  return errors[field] ? (
    <p id={`${field}-error`} className="text-red-400 text-xs mt-1" role="alert">
      {errors[field]}
    </p>
  ) : null;
}

// ── Inline hints ──────────────────────────────────────────────────────────────


function PpwHint({ soldPPW, closerPerW, hasError }: { soldPPW: number; closerPerW: number; hasError: boolean }) {
  if (hasError || soldPPW <= 0 || closerPerW <= 0) return null;
  const above = soldPPW >= closerPerW;
  const diff = Math.abs(soldPPW - closerPerW).toFixed(2);
  return (
    <p id="netPPW-hint" className={`text-xs mt-1 ${above ? 'text-emerald-400' : 'text-amber-400'}`}>
      {above ? `$${diff}/W above baseline ✓` : `$${diff}/W below baseline — no commission`}
    </p>
  );
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ step, label }: { step: number; label: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="w-5 h-5 rounded-full bg-blue-600/20 border border-blue-600/40 flex items-center justify-center text-[10px] font-bold text-blue-400 shrink-0">
        {step}
      </span>
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{label}</span>
      <div className="flex-1 h-px bg-slate-800" />
    </div>
  );
}

// ── Form stepper ─────────────────────────────────────────────────────────────

const DEAL_STEPS = ['People', 'Deal Details', 'Review & Notes'] as const;

interface FormStepperProps {
  currentStep: number;
  stepsComplete: boolean[];
  progressPct: number;
  onStepClick?: (step: number) => void;
  pulseStep?: number | null;
}

function FormStepper({ currentStep, stepsComplete, progressPct, onStepClick, pulseStep }: FormStepperProps) {
  return (
    <div
      className="sticky top-[60px] md:top-0 z-20 border-b border-slate-800/60"
      style={{ backgroundColor: 'var(--navy-base)' }}
    >
      {/* ── Desktop stepper (md+) ── */}
      <div className="hidden md:flex items-center px-4 md:px-8 py-3 max-w-2xl">
        {DEAL_STEPS.map((label, idx) => {
          const isComplete = stepsComplete[idx];
          const isCurrent  = currentStep === idx && !isComplete;
          return (
            <div key={label} className={`flex items-center ${idx < DEAL_STEPS.length - 1 ? 'flex-1' : ''}`}>
              {/* Step node */}
              <div
                className={`flex flex-col items-center shrink-0${isComplete && onStepClick ? ' cursor-pointer group/step' : ''}`}
                onClick={isComplete && onStepClick ? () => onStepClick(idx) : undefined}
                role={isComplete && onStepClick ? 'button' : undefined}
                tabIndex={isComplete && onStepClick ? 0 : undefined}
                onKeyDown={isComplete && onStepClick ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStepClick(idx); } } : undefined}
              >
                <div
                  className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all duration-300 ${
                    isComplete
                      ? 'bg-emerald-600 text-white group-hover/step:bg-emerald-500 group-hover/step:shadow-lg group-hover/step:shadow-emerald-500/25'
                      : isCurrent
                      ? 'bg-blue-600 text-white ring-2 ring-blue-500 ring-offset-[3px] ring-offset-[var(--navy-base)]'
                      : 'bg-slate-800 border border-slate-700 text-slate-500'
                  } ${pulseStep === idx ? 'animate-pulse shadow-lg shadow-emerald-500/40 scale-110' : ''}`}
                >
                  {isComplete ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : idx + 1}
                </div>
                <span
                  className={`mt-1 text-[10px] font-medium whitespace-nowrap transition-colors ${
                    isCurrent    ? 'text-blue-400'
                    : isComplete ? 'text-emerald-500 group-hover/step:text-emerald-400'
                    : 'text-slate-600'
                  }`}
                >
                  {label}
                </span>
              </div>

              {/* Connector line between steps */}
              {idx < DEAL_STEPS.length - 1 && (
                <div className="flex-1 mx-3 h-[2px] relative overflow-hidden rounded-full mt-[-10px]">
                  <div className="absolute inset-0 bg-slate-700" />
                  <div
                    className="absolute inset-0 bg-gradient-to-r from-emerald-600 to-emerald-400 transition-transform duration-500 origin-left"
                    style={{ transform: `scaleX(${stepsComplete[idx] ? 1 : 0})` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── Mobile compact bar (<md) ── */}
      <div className="flex md:hidden items-center gap-2.5 px-4 py-2.5">
        {/* Mini step dots */}
        <div className="flex items-center gap-1.5">
          {DEAL_STEPS.map((_, idx) => {
            const isComplete = stepsComplete[idx];
            const isCurrent  = currentStep === idx;
            return (
              <div
                key={idx}
                onClick={isComplete && onStepClick ? () => onStepClick(idx) : undefined}
                role={isComplete && onStepClick ? 'button' : undefined}
                className={`rounded-full flex items-center justify-center transition-all duration-300 ${
                  isComplete
                    ? `w-4 h-4 bg-emerald-600${onStepClick ? ' cursor-pointer hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-500/25' : ''}`
                    : isCurrent
                    ? 'w-4 h-4 bg-blue-600 ring-2 ring-blue-500 ring-offset-1 ring-offset-[var(--navy-base)]'
                    : 'w-2 h-2 bg-slate-700'
                }`}
              >
                {isComplete && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
              </div>
            );
          })}
        </div>
        <span className="text-xs font-semibold text-slate-300">
          {currentStep + 1} of {DEAL_STEPS.length}
        </span>
        <span className="text-xs text-slate-500 truncate">— {DEAL_STEPS[currentStep]}</span>
      </div>

      {/* ── Thin progress bar ── */}
      <div className="h-[2px] bg-slate-800/80">
        <div
          className={`h-full transition-[width,box-shadow] duration-500 ease-out ${
            progressPct >= 100
              ? 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-emerald-400 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
              : 'bg-gradient-to-r from-blue-600 via-blue-500 to-emerald-500'
          }`}
          style={{ width: `${progressPct}%` }}
        />
      </div>
    </div>
  );
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonField({ delay }: { delay: number }) {
  return (
    <div className="space-y-1.5">
      <div className="h-3 w-24 bg-slate-800/70 rounded animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
      <div className="h-10 w-full bg-slate-800 rounded-xl animate-skeleton" style={{ animationDelay: `${delay}ms` }} />
    </div>
  );
}

function NewDealSkeleton() {
  return (
    <div>
      {/* Stepper bar skeleton — mirrors the sticky FormStepper (3 steps + connecting lines) */}
      <div
        className="sticky top-[60px] md:top-0 z-20 border-b border-slate-800/60"
        style={{ backgroundColor: 'var(--navy-base)' }}
      >
        {/* Desktop stepper (md+): 3 dots connected by 2 lines */}
        <div className="hidden md:flex items-center px-4 md:px-8 py-3 max-w-2xl">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`flex items-center ${i < 2 ? 'flex-1' : ''}`}>
              <div className="flex flex-col items-center shrink-0">
                <div
                  className="w-7 h-7 rounded-full bg-slate-800 animate-skeleton"
                  style={{ animationDelay: `${i * 60}ms` }}
                />
                <div
                  className="mt-1 h-2 w-14 bg-slate-800/60 rounded animate-skeleton"
                  style={{ animationDelay: `${i * 60 + 30}ms` }}
                />
              </div>
              {i < 2 && (
                <div
                  className="flex-1 mx-3 h-[2px] bg-slate-700/60 rounded-full mt-[-10px] animate-skeleton"
                  style={{ animationDelay: `${i * 60 + 50}ms` }}
                />
              )}
            </div>
          ))}
        </div>
        {/* Mobile stepper: progress bar + step label */}
        <div className="md:hidden h-12 flex items-center px-4 gap-3">
          <div className="h-1.5 flex-1 bg-slate-800 rounded-full animate-skeleton" />
          <div className="h-3 w-20 bg-slate-800/60 rounded animate-skeleton" style={{ animationDelay: '50ms' }} />
        </div>
      </div>

      {/* Page header + form */}
      <div className="p-4 md:p-8 max-w-2xl">
        <div className="mb-8">
          <div className="h-[3px] w-12 rounded-full bg-slate-700 animate-skeleton mb-3" />
          <div className="flex items-center gap-3 mb-1">
            <div className="h-9 w-9 bg-slate-800 rounded-lg animate-skeleton" />
            <div className="h-8 w-32 bg-slate-800 rounded animate-skeleton" style={{ animationDelay: '75ms' }} />
          </div>
          <div className="h-3 w-72 bg-slate-800/70 rounded animate-skeleton ml-12 mt-1" style={{ animationDelay: '150ms' }} />
        </div>

        {/* Form card — 2-column grid with 6 field placeholders */}
        <div className="card-surface rounded-2xl p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SkeletonField delay={0} />
            <SkeletonField delay={75} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SkeletonField delay={150} />
            <SkeletonField delay={225} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SkeletonField delay={300} />
            <SkeletonField delay={375} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Success screen ────────────────────────────────────────────────────────────

interface SubmittedDeal {
  projectId: string;
  customerName: string;
  installer: string;
  financer: string;
  productType: string;
  kW: number;
  soldPPW: number;
  closerTotal: number;
  closerM1: number;
  closerM2: number;
  closerM3: number;
  setterTotal: number;
  setterName: string;
  repName: string;
}

function SuccessScreen({ deal, onReset }: { deal: SubmittedDeal; onReset: () => void }) {
  const router = useRouter();

  return (
    <div className="p-4 md:p-8 max-w-2xl animate-slide-in-scale">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
            <PlusCircle className="w-5 h-5 text-blue-400" />
          </div>
          <h1 className="text-3xl font-black text-gradient-brand tracking-tight">New Deal</h1>
        </div>
      </div>

      {/* Success card */}
      <div className="bg-slate-900 border border-green-700/30 rounded-2xl overflow-hidden shadow-[0_0_30px_rgba(34,197,94,0.08)]">
        {/* Green top bar */}
        <div className="h-1 bg-gradient-to-r from-green-500 to-emerald-400" />

        <div className="p-8">
          {/* Icon + message */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center mb-4">
              <CheckCircle2 className="w-8 h-8 text-green-400" strokeWidth={1.5} />
            </div>
            <h2 className="text-2xl font-black text-white mb-1">Deal Submitted!</h2>
            <p className="text-slate-400 text-sm">
              <span className="text-white font-semibold">{deal.customerName}</span> has been added to your pipeline.
            </p>
          </div>

          {/* Deal summary */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 mb-4 space-y-2.5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Deal Summary</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              <div>
                <p className="text-slate-500 text-xs mb-0.5">Installer</p>
                <p className="text-white font-medium">{deal.installer}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs mb-0.5">Financer</p>
                <p className="text-white font-medium">{deal.financer || '—'}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs mb-0.5">Product Type</p>
                <p className="text-white font-medium">{deal.productType}</p>
              </div>
              <div>
                <p className="text-slate-500 text-xs mb-0.5">System Size</p>
                <p className="text-white font-medium">{deal.kW.toFixed(1)} kW @ ${deal.soldPPW.toFixed(2)}/W</p>
              </div>
            </div>
          </div>

          {/* Commission summary */}
          <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 mb-6 space-y-2.5">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Commission</p>
            {deal.closerTotal > 0 ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-slate-300 text-sm font-medium">{deal.repName} (Closer)</p>
                  <p className="text-slate-500 text-xs">M1: ${deal.closerM1.toLocaleString()} · M2: ${deal.closerM2.toLocaleString()}{deal.closerM3 > 0 && ` · M3: $${deal.closerM3.toLocaleString()}`}</p>
                </div>
                <p className="text-2xl font-black text-green-400">${deal.closerTotal.toLocaleString()}</p>
              </div>
            ) : (
              <p className="text-slate-500 text-sm">Commission will be calculated once pricing is confirmed.</p>
            )}
            {deal.setterTotal > 0 && (
              <div className="flex items-center justify-between border-t border-slate-700 pt-2.5">
                <div>
                  <p className="text-slate-300 text-sm font-medium">{deal.setterName} (Setter)</p>
                </div>
                <p className="text-lg font-bold text-blue-400">${deal.setterTotal.toLocaleString()}</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3">
            <button
              onClick={() => router.push('/dashboard/projects')}
              className="flex-1 inline-flex items-center justify-center gap-2 btn-primary text-white font-semibold px-5 py-2.5 rounded-xl text-sm"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              View Projects <ArrowRight className="w-4 h-4" />
            </button>
            <button
              onClick={onReset}
              className="flex-1 inline-flex items-center justify-center gap-2 bg-slate-700 hover:bg-slate-600 text-white font-medium px-5 py-2.5 rounded-xl text-sm transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Submit Another
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── TickerAmount ──────────────────────────────────────────────────────────────
// Wraps a formatted dollar amount in a span with tabular-nums and a brief
// opacity fade whenever the underlying number changes — gives the live
// commission preview a "premium ticker" feel without an animation library.

function TickerAmount({ amount, className }: { amount: number; className?: string }) {
  const [visible, setVisible] = useState(true);
  const prevRef = useRef(amount);

  useEffect(() => {
    if (prevRef.current === amount) return;
    prevRef.current = amount;
    const t1 = setTimeout(() => setVisible(false), 0);
    const t2 = setTimeout(() => setVisible(true), 60);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [amount]);

  return (
    <span
      className={className}
      style={{
        fontVariantNumeric: 'tabular-nums',
        transition: 'opacity 0.22s ease-in-out',
        opacity: visible ? 1 : 0,
        display: 'inline-block',
      }}
    >
      ${amount.toLocaleString()}
    </span>
  );
}

// ── Entry Page ────────────────────────────────────────────────────────────────

function DealEntryPage({ onStart, projects }: { onStart: () => void; projects: { soldDate: string }[] }) {
  const today = new Date().toISOString().split('T')[0];
  const monthPrefix = today.slice(0, 7);
  const todayCount = projects.filter((p) => p.soldDate === today).length;
  const monthCount = projects.filter((p) => p.soldDate.startsWith(monthPrefix)).length;

  return (
    <div className="p-4 md:p-8 max-w-2xl animate-slide-in-scale">
      <div className="card-surface rounded-2xl">
        <div className="px-6 py-8 sm:px-8 sm:py-10 md:px-12 md:py-14">
          {/* Icon + heading */}
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-xl" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
              <PlusCircle className="w-6 h-6 text-blue-400" />
            </div>
            <h1 className="text-4xl md:text-5xl font-black text-gradient-brand tracking-tight leading-none">
              New Deal
            </h1>
          </div>

          <p className="text-slate-400 text-[15px] mb-8 max-w-sm leading-relaxed ml-[52px]">
            Log a closed solar deal and track commissions in seconds.
          </p>

          {/* Stats strip */}
          {(todayCount > 0 || monthCount > 0) && (
            <div className="flex items-center gap-6 mb-8 ml-[52px]">
              <div>
                <p className="text-2xl font-black text-white tabular-nums">{todayCount}</p>
                <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">Today</p>
              </div>
              <div className="w-px h-8 bg-slate-700/70" />
              <div>
                <p className="text-2xl font-black text-white tabular-nums">{monthCount}</p>
                <p className="text-[11px] text-slate-500 uppercase tracking-widest mt-0.5">This Month</p>
              </div>
            </div>
          )}

          {/* CTA — matches dashboard glow style */}
          <div className="ml-[52px]">
            <div className="relative inline-flex">
              <div className="absolute -inset-0.5 rounded-2xl bg-gradient-to-r from-blue-500 to-emerald-500 opacity-[0.06] blur-[2px] animate-pulse" />
              <button
                onClick={onStart}
                className="relative inline-flex items-center gap-2.5 btn-primary text-white font-bold px-8 py-4 rounded-2xl text-base active:scale-[0.97]"
              >
                <PlusCircle className="w-5 h-5" />
                Submit a Deal
              </button>
            </div>
          </div>
          <span className="text-slate-600 text-xs hidden sm:block">or press ⌘↵ on the form</span>
        </div>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewDealPageWrapper() {
  return (
    <Suspense>
      <NewDealPage />
    </Suspense>
  );
}

function NewDealPage() {
  const { dbReady, currentRole, currentRepId, currentRepName, addDeal, projects, trainerAssignments, activeInstallers, activeFinancers, reps, installerPricingVersions, productCatalogInstallerConfigs, productCatalogProducts, productCatalogPricingVersions, getInstallerPrepaidOptions, installerBaselines } = useApp();
  const { toast } = useToast();
  const router = useRouter();
  useEffect(() => { document.title = 'New Deal | Kilo Energy'; }, []);
  const isHydrated = useIsHydrated();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isSubDealer = currentRole === 'sub-dealer';

  const blankForm = () => ({
    customerName: '',
    soldDate: new Date().toISOString().split('T')[0],
    installer: '',
    financer: '',
    productType: '',
    kWSize: '',
    netPPW: '',
    notes: '',
    repId: currentRole === 'admin' ? '' : (currentRepId ?? ''),
    setterId: '',
    solarTechFamily: '',
    solarTechProductId: '',
    pcFamily: '',
    installerProductId: '',
    prepaidSubType: '',
    leadSource: '',
    blitzId: '',
  });

  const [view, setView] = useState<'entry' | 'form'>('entry');
  const [form, setForm] = useState(blankForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<SubmittedDeal | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const isDirty = useRef(false);

  // Blitz list for lead source attribution
  const [availableBlitzes, setAvailableBlitzes] = useState<Array<{ id: string; name: string; status: string; startDate?: string; endDate?: string }>>([]);
  useEffect(() => {
    fetch('/api/blitzes').then((r) => r.json()).then((data) => {
      setAvailableBlitzes((data ?? []).filter((b: any) => b.status === 'upcoming' || b.status === 'active' || b.status === 'completed'));
    }).catch(() => {});
  }, []);

  // ── Duplicate deal pre-fill from query params ─────────────────────────────
  const searchParams = useSearchParams();
  const duplicateApplied = useRef(false);
  const duplicateCustomerName = searchParams.get('duplicate') === 'true' ? (searchParams.get('customerName') ?? '') : '';
  const customerNameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (duplicateApplied.current) return;
    if (searchParams.get('duplicate') !== 'true') return;
    duplicateApplied.current = true;
    const installer = searchParams.get('installer') ?? '';
    const financer = searchParams.get('financer') ?? '';
    const productType = searchParams.get('productType') ?? '';
    const repId = searchParams.get('repId') ?? (currentRole === 'admin' ? '' : (currentRepId ?? ''));
    const setterId = searchParams.get('setterId') ?? '';
    setForm((prev) => ({
      ...prev,
      installer,
      financer,
      productType,
      repId,
      setterId,
      // Leave customer name, kW, netPPW, notes blank for the new deal
    }));
    setView('form');
    toast('Deal duplicated — fill in the new customer details', 'info');
    // Auto-focus customer name field after a brief delay for form to render
    setTimeout(() => customerNameInputRef.current?.focus(), 150);
  }, [searchParams, currentRole, currentRepId, toast]);

  // ── Pre-fill last-used installer from localStorage ────────────────────────
  const lastInstallerApplied = useRef(false);
  useEffect(() => {
    if (lastInstallerApplied.current) return;
    if (searchParams.get('duplicate') === 'true') return; // duplicate overrides
    lastInstallerApplied.current = true;
    try {
      const lastInstaller = localStorage.getItem('lastInstaller');
      if (lastInstaller && activeInstallers.includes(lastInstaller)) {
        setForm((prev) => prev.installer ? prev : { ...prev, installer: lastInstaller });
      }
    } catch {}
  }, [searchParams, activeInstallers]);

  // ── Multi-step navigation ──────────────────────────────────────────────────
  const [currentStep, setCurrentStep] = useState(0);
  const [slideDirection, setSlideDirection] = useState<'forward' | 'backward'>('forward');
  // Track whether the user manually navigated backward (suppress auto-advance)
  const userNavigatedBack = useRef(false);
  // Track which steps have already been auto-advanced (so we only auto-advance once per step)
  const autoAdvancedSteps = useRef<Set<number>>(new Set());
  // Track the step circle pulse animation
  const [pulseStep, setPulseStep] = useState<number | null>(null);

  // Derived: SolarTech — family comes from form, not from financer
  const solarTechFamily = form.installer === 'SolarTech' ? form.solarTechFamily : '';
  const hasSolarTechProducts = solarTechFamily !== '';

  // Derived: product catalog installer detection
  const pcConfig = productCatalogInstallerConfigs[form.installer] ?? null;
  const isPcInstaller = pcConfig !== null;
  // For PC installer: family comes from form, not from financer
  const pcFamily = isPcInstaller ? form.pcFamily : '';
  const hasPcProducts = isPcInstaller && pcFamily !== '';

  // ── Unsaved-changes guard ──────────────────────────────────────────────────
  const isFormDirty =
    form.customerName.trim() !== '' || form.installer !== '' || form.financer !== '' ||
    form.productType !== '' || form.kWSize !== '' || form.netPPW !== '' ||
    form.notes.trim() !== '' || form.setterId !== '' || form.solarTechFamily !== '' ||
    form.solarTechProductId !== '' || form.pcFamily !== '' || form.installerProductId !== '' || form.prepaidSubType !== '' ||
    form.leadSource !== '' || form.blitzId !== '' ||
    (currentRole === 'admin' && form.repId !== '');

  useEffect(() => {
    if (!isFormDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isFormDirty]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); formRef.current?.requestSubmit(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Field helpers ──────────────────────────────────────────────────────────

  const update = (field: string, value: string) => { isDirty.current = true; setForm((prev) => ({ ...prev, [field]: value })); };

  const handleBlur = (field: string) => {
    const value = form[field as keyof typeof form] ?? '';
    setErrors((prev) => ({ ...prev, [field]: validateField(field, value) }));
    setTouched((prev) => { const next = new Set(prev); next.add(field); return next; });
  };

  // Returns a green check icon when the field is touched, valid, and non-empty
  const fieldCheck = (field: string, value?: string) => {
    const v = value ?? form[field as keyof typeof form] ?? '';
    if (!touched.has(field) || errors[field] || !v) return null;
    return <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  };

  const handleInstallerChange = (value: string) => {
    setForm((prev) => ({ ...prev, installer: value, financer: '', productType: '', solarTechFamily: '', solarTechProductId: '', pcFamily: '', installerProductId: '', prepaidSubType: '' }));
    setErrors((prev) => ({ ...prev, installer: validateField('installer', value), financer: '', solarTechFamily: '', solarTechProductId: '', pcFamily: '', installerProductId: '' }));
  };

  const handleFinancerChange = (value: string) => {
    setForm((prev) => ({ ...prev, financer: value }));
    setErrors((prev) => ({ ...prev, financer: validateField('financer', value) }));
  };

  const handleSolarTechFamilyChange = (value: string) => {
    setForm((prev) => ({ ...prev, solarTechFamily: value, solarTechProductId: '' }));
    setErrors((prev) => ({ ...prev, solarTechFamily: validateField('solarTechFamily', value), solarTechProductId: '' }));
    setTouched((prev) => { const next = new Set(prev); next.add('solarTechFamily'); return next; });
  };

  const handlePcFamilyChange = (value: string) => {
    setForm((prev) => ({ ...prev, pcFamily: value, installerProductId: '' }));
    setErrors((prev) => ({ ...prev, pcFamily: validateField('pcFamily', value), installerProductId: '' }));
    setTouched((prev) => { const next = new Set(prev); next.add('pcFamily'); return next; });
  };

  // ── Derived values ─────────────────────────────────────────────────────────

  const closerId = currentRole === 'admin' ? form.repId : (currentRepId ?? '');

  const setterAssignment = form.setterId ? trainerAssignments.find((a) => a.traineeId === form.setterId) : null;
  const setterCompletedDeals = form.setterId
    ? projects.filter((p) => p.repId === form.setterId || p.setterId === form.setterId).length
    : 0;
  const trainerOverrideRate = setterAssignment ? getTrainerOverrideRate(setterAssignment, setterCompletedDeals) : 0;
  const trainerRep = setterAssignment ? reps.find((r) => r.id === setterAssignment.trainerId) : null;

  const kW = parseFloat(form.kWSize) || 0;
  const soldPPW = parseFloat(form.netPPW) || 0;

  const { closerPerW, setterBaselinePerW, kiloPerW, activeVersionId } = (() => {
    if (form.installer === 'SolarTech' && hasSolarTechProducts && form.solarTechProductId && kW > 0) {
      const b = getSolarTechBaseline(form.solarTechProductId, kW);
      return { closerPerW: b.closerPerW, setterBaselinePerW: b.setterPerW, kiloPerW: b.kiloPerW, activeVersionId: null };
    } else if (isPcInstaller && hasPcProducts && form.installerProductId && kW > 0) {
      const soldDate = form.soldDate || new Date().toISOString().split('T')[0];
      const b = getProductCatalogBaselineVersioned(productCatalogProducts, form.installerProductId, kW, soldDate, productCatalogPricingVersions);
      return { closerPerW: b.closerPerW, setterBaselinePerW: b.setterPerW, kiloPerW: b.kiloPerW, activeVersionId: b.pcPricingVersionId };
    } else if (form.installer && form.installer !== 'SolarTech' && !isPcInstaller && kW > 0) {
      const soldDate = form.soldDate || new Date().toISOString().split('T')[0];
      const r = getInstallerRatesForDeal(form.installer, soldDate, kW, installerPricingVersions);
      return { closerPerW: r.closerPerW, setterBaselinePerW: r.setterPerW, kiloPerW: r.kiloPerW, activeVersionId: r.versionId };
    }
    return { closerPerW: 0, setterBaselinePerW: 0, kiloPerW: 0, activeVersionId: null };
  })();

  const trainerTotal = setterAssignment && trainerOverrideRate > 0
    ? Math.round(trainerOverrideRate * kW * 1000 * 100) / 100 : 0;

  const { closerTotal, setterTotal } = (() => {
    if (!form.setterId || setterBaselinePerW === 0) {
      return { closerTotal: calculateCommission(soldPPW, closerPerW, kW), setterTotal: 0 };
    }
    const closerDifferential = Math.round((setterBaselinePerW - closerPerW) * kW * 1000 * 100) / 100;
    const splitPoint = setterBaselinePerW + trainerOverrideRate;
    const aboveSplit = calculateCommission(soldPPW, splitPoint, kW);
    const half = Math.round(aboveSplit / 2);
    return { closerTotal: closerDifferential + half, setterTotal: aboveSplit - half };
  })();

  const kiloTotal = calculateCommission(closerPerW, kiloPerW, kW);

  // M1 is a flat milestone payment: $500 if <5kW, $1000 if ≥5kW (only one M1 per project).
  // It goes to the setter. Closer only receives M1 if self-gen (no setter).
  // Trainers are paid post-installation — M2 stage only, no M1.
  const m1Flat = kW >= 5 ? 1000 : 500;
  const isSelfGen = !form.setterId || setterBaselinePerW === 0;
  const closerM1 = isSelfGen ? m1Flat : 0;
  const closerM2Full = closerTotal - closerM1;
  const setterM1 = isSelfGen ? 0 : m1Flat;
  const setterM2Full = Math.max(0, setterTotal - setterM1);
  const trainerM1 = 0;
  const trainerM2 = trainerTotal;

  // M2/M3 split based on installer pay config
  const installPayPct = INSTALLER_PAY_CONFIGS[form.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
  const hasM3 = installPayPct < 100;
  const closerM2 = Math.round(closerM2Full * (installPayPct / 100) * 100) / 100;
  const closerM3 = hasM3 ? Math.round(closerM2Full * ((100 - installPayPct) / 100) * 100) / 100 : 0;
  const setterM2 = Math.round(setterM2Full * (installPayPct / 100) * 100) / 100;
  const setterM3 = hasM3 ? Math.round(setterM2Full * ((100 - installPayPct) / 100) * 100) / 100 : 0;

  const currentTierIndex = setterAssignment
    ? setterAssignment.tiers.findIndex((t) => t.upToDeal === null || setterCompletedDeals < t.upToDeal)
    : -1;
  const currentTier = currentTierIndex >= 0 ? setterAssignment!.tiers[currentTierIndex] : null;
  const nextTier = currentTierIndex >= 0 ? setterAssignment!.tiers[currentTierIndex + 1] : null;

  const showPreview = closerPerW > 0 && kW > 0 && soldPPW > 0;

  // ── Sub-dealer commission calculation ────────────────────────────────────
  // Uses subDealerPerW from installer baselines — this is what Kilo pays the sub-dealer per watt.
  // Commission = (subDealerPerW - kiloPerW) * kW * 1000
  const subDealerRate = (() => {
    if (!isSubDealer || !form.installer) return 0;
    const baseline = installerBaselines[form.installer];
    return baseline?.subDealerPerW ?? closerPerW;
  })();
  const subDealerCommission = isSubDealer && kW > 0 && soldPPW > 0 && subDealerRate > 0
    ? calculateCommission(soldPPW, subDealerRate, kW)
    : 0;

  // ── Stepper: section completion & progress ────────────────────────────────

  const isFieldValid = (field: string) => {
    const value = (form as Record<string, string>)[field] ?? '';
    return !validateField(field, value);
  };

  const s1Fields: string[] = [
    ...(currentRole === 'admin' ? ['repId'] : []),
    'customerName',
    'soldDate',
  ];
  const isCashDeal = form.productType === 'Cash';
  const s2Fields: string[] = [
    'installer',
    ...(isCashDeal ? [] : ['financer']),
    'productType',
    ...(form.installer === 'SolarTech' ? ['solarTechFamily'] : []),
    ...(form.installer === 'SolarTech' && hasSolarTechProducts ? ['solarTechProductId'] : []),
    ...(isPcInstaller && form.installer !== 'SolarTech' ? ['pcFamily'] : []),
    ...(isPcInstaller && form.installer !== 'SolarTech' && hasPcProducts ? ['installerProductId'] : []),
    'kWSize',
    'netPPW',
  ];
  const s3Fields: string[] = [];

  const stepsComplete = [
    s1Fields.every(isFieldValid),
    s2Fields.every(isFieldValid),
    s3Fields.every(isFieldValid),
  ];

  const allRequired = [...s1Fields, ...s2Fields, ...s3Fields];
  const progressPct = allRequired.length
    ? Math.round((allRequired.filter(isFieldValid).length / allRequired.length) * 100)
    : 0;

  // ── Auto-advance when a step is fully filled (#5) ──────────────────────────
  useEffect(() => {
    // Only auto-advance if: step is complete, user hasn't navigated backward,
    // we haven't already auto-advanced this step, and there's a next step
    if (
      !userNavigatedBack.current &&
      stepsComplete[currentStep] &&
      !autoAdvancedSteps.current.has(currentStep) &&
      currentStep < DEAL_STEPS.length - 1
    ) {
      autoAdvancedSteps.current.add(currentStep);
      // Brief green pulse on the step circle
      setPulseStep(currentStep);
      const pulseClear = setTimeout(() => setPulseStep(null), 600);
      // Auto-advance after 500ms delay
      const advanceTimer = setTimeout(() => {
        setSlideDirection('forward');
        setCurrentStep((prev) => Math.min(prev + 1, DEAL_STEPS.length - 1));
      }, 500);
      return () => { clearTimeout(advanceTimer); clearTimeout(pulseClear); };
    }
  }, [stepsComplete, currentStep]);

  // ── Step navigation handlers ───────────────────────────────────────────────

  const handleNext = () => {
    // Validate the fields on the current step before advancing. This prevents
    // the user from skipping ahead and discovering validation errors on hidden
    // steps only after hitting Submit.
    const stepFields = currentStep === 0 ? s1Fields : currentStep === 1 ? s2Fields : s3Fields;
    const stepErrors: Record<string, string> = {};
    let hasStepErrors = false;
    for (const field of stepFields) {
      const value = (form as Record<string, string>)[field] ?? '';
      const error = validateField(field, value);
      stepErrors[field] = error;
      if (error) hasStepErrors = true;
    }
    // Mark all current-step fields as touched so error messages render
    setTouched((prev) => {
      const next = new Set(prev);
      stepFields.forEach((f) => next.add(f));
      return next;
    });
    setErrors((prev) => ({ ...prev, ...stepErrors }));
    if (hasStepErrors) return;

    userNavigatedBack.current = false;
    setSlideDirection('forward');
    setCurrentStep((prev) => Math.min(prev + 1, DEAL_STEPS.length - 1));
  };

  const handlePrev = () => {
    userNavigatedBack.current = true;
    setSlideDirection('backward');
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!dbReady) {
      toast('Data is still loading, please wait...', 'error');
      return;
    }

    const fieldsToValidate: string[] = [
      'customerName', 'soldDate', 'installer', ...(form.productType === 'Cash' ? [] : ['financer']), 'productType', 'kWSize', 'netPPW',
      ...(currentRole === 'admin' ? ['repId'] : []),
      ...(form.installer === 'SolarTech' ? ['solarTechFamily'] : []),
      ...(form.installer === 'SolarTech' && hasSolarTechProducts ? ['solarTechProductId'] : []),
      ...(isPcInstaller && form.installer !== 'SolarTech' ? ['pcFamily'] : []),
      ...(isPcInstaller && form.installer !== 'SolarTech' && hasPcProducts ? ['installerProductId'] : []),
    ];

    const newErrors: Record<string, string> = {};
    let hasErrors = false;
    for (const field of fieldsToValidate) {
      const value = form[field as keyof typeof form] ?? '';
      const error = validateField(field, value);
      newErrors[field] = error;
      if (error) hasErrors = true;
    }
    setErrors(newErrors);
    if (hasErrors) return;

    setSubmitting(true);

    const rep = reps.find((r) => r.id === closerId);
    const setter = form.setterId ? reps.find((r) => r.id === form.setterId) : null;
    const projectId = genId('proj');

    const newProject: Project = {
      id: projectId,
      customerId: genId('cust'),
      customerName: form.customerName,
      repId: isSubDealer ? (currentRepId ?? '') : closerId,
      repName: isSubDealer ? (currentRepName ?? '') : (rep?.name ?? currentRepName ?? ''),
      setterId: isSubDealer ? undefined : setter?.id,
      setterName: isSubDealer ? undefined : setter?.name,
      soldDate: form.soldDate,
      installer: form.installer,
      financer: form.financer,
      productType: form.productType,
      kWSize: kW,
      netPPW: soldPPW,
      phase: 'New',
      m1Paid: false,
      m1Amount: isSubDealer ? 0 : m1Flat,
      m2Paid: false,
      m2Amount: isSubDealer ? subDealerCommission : closerM2Full,
      notes: form.notes,
      flagged: false,
      solarTechProductId: form.installer === 'SolarTech' && hasSolarTechProducts ? form.solarTechProductId : undefined,
      installerProductId: isPcInstaller && hasPcProducts ? form.installerProductId : undefined,
      pcPricingVersionId: isPcInstaller && hasPcProducts && activeVersionId ? activeVersionId : undefined,
      pricingVersionId: !isPcInstaller && form.installer !== 'SolarTech' && activeVersionId ? activeVersionId : undefined,
      prepaidSubType: form.prepaidSubType || undefined,
      leadSource: form.leadSource || undefined,
      blitzId: form.leadSource === 'blitz' && form.blitzId ? form.blitzId : undefined,
      subDealerId: isSubDealer ? currentRepId ?? undefined : undefined,
      subDealerName: isSubDealer ? currentRepName ?? undefined : undefined,
    };

    isDirty.current = false;
    if (isSubDealer) {
      // Sub-dealer deals: no M1, M2 = sub-dealer commission, no setter/trainer entries
      addDeal(newProject, 0, subDealerCommission, 0, 0, 0, 0, undefined);
    } else {
      addDeal(newProject, closerM1, closerM2, setterM1, setterM2, trainerM1, trainerM2,
        trainerTotal > 0 ? setterAssignment?.trainerId : undefined);
    }

    // Remember installer for next deal
    if (form.installer) {
      try { localStorage.setItem('lastInstaller', form.installer); } catch {}
    }

    toast(`Deal submitted for ${form.customerName}`, 'success');

    setSubmitted({
      projectId,
      customerName: form.customerName,
      installer: form.installer,
      financer: form.financer,
      productType: form.productType,
      kW,
      soldPPW,
      closerTotal: isSubDealer ? subDealerCommission : closerTotal,
      closerM1: isSubDealer ? 0 : closerM1,
      closerM2: isSubDealer ? subDealerCommission : closerM2,
      closerM3: isSubDealer ? 0 : closerM3,
      setterTotal,
      setterName: setter?.name ?? '',
      repName: rep?.name ?? currentRepName ?? 'You',
    });
    setSubmitting(false);
  };

  // ── Style helpers ──────────────────────────────────────────────────────────

  const inputCls = (field: string) =>
    `w-full bg-slate-800 border ${errors[field] ? 'border-red-500' : 'border-slate-700'} text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-900 transition-all duration-200 input-focus-glow placeholder-slate-500`;

  const selectCls = (field: string) =>
    `w-full bg-slate-800 border ${errors[field] ? 'border-red-500' : 'border-slate-700'} text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-slate-900 transition-all duration-200 input-focus-glow`;

  const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider';

  // ── Render ────────────────────────────────────────────────────────────────

  if (isMobile) return <MobileNewDeal />;

  if (!isHydrated) return <NewDealSkeleton />;

  if (submitted) {
    return (
      <SuccessScreen
        deal={submitted}
        onReset={() => {
          setSubmitted(null);
          setForm(blankForm());
          setErrors({});
          setTouched(new Set());
        }}
      />
    );
  }

  if (view === 'entry') {
    return <DealEntryPage onStart={() => setView('form')} projects={projects} />;
  }

  return (
    <div>
      {/* ── Sticky multi-step progress tracker ── */}
      <FormStepper
        currentStep={currentStep}
        stepsComplete={stepsComplete}
        progressPct={progressPct}
        onStepClick={(step) => setCurrentStep(step)}
        pulseStep={pulseStep}
      />

      <div className="p-4 md:p-8 max-w-2xl">
      <Breadcrumb items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'New Deal' }]} />
      <div className="mb-8">
        <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
            <PlusCircle className="w-5 h-5 text-blue-400" />
          </div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-3xl md:text-4xl font-black text-gradient-brand tracking-tight">New Deal</h1>
            {isFormDirty && (
              <div
                className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"
                title="Unsaved changes — ⌘Enter to submit"
              />
            )}
          </div>
        </div>
      </div>

      {/* Duplicate info badge */}
      {duplicateCustomerName && (
        <div className="mb-4 flex items-center gap-2 bg-blue-500/10 border border-blue-500/20 rounded-xl px-4 py-2.5">
          <RotateCcw className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <p className="text-blue-300 text-sm">Duplicating from <span className="font-semibold text-white">{duplicateCustomerName}</span></p>
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-6">

        {/* ── Animated step content wrapper ── */}
        <div key={currentStep} className="animate-page-enter relative z-20">

        {/* ── Section 1: People ── */}
        {currentStep === 0 && (
        <div id="section-people" className="card-surface rounded-2xl p-6 overflow-visible relative z-10">
          <SectionHeader step={1} label={isSubDealer ? 'Deal Info' : 'People'} />

          <div className="space-y-4">
            {/* Closer / Setter card — hidden for sub-dealers */}
            {!isSubDealer && (
            <div className="card-surface rounded-2xl p-5 animate-slide-in-scale stagger-1 space-y-4">
              {currentRole === 'admin' && (
                <div className="transition-all duration-200">
                  <label htmlFor="field-repId" className={labelCls}>
                    <span className="inline-flex items-center gap-1">Closer (Rep) {fieldCheck('repId')}</span>
                  </label>
                  <select id="field-repId" value={form.repId} onChange={(e) => update('repId', e.target.value)}
                    onBlur={() => handleBlur('repId')} aria-invalid={!!errors.repId} className={selectCls('repId')}>
                    <option value="">— Select closer —</option>
                    {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <FieldError errors={errors} field="repId" />
                </div>
              )}

              <div className="transition-all duration-200">
                <label className={labelCls}>
                  Setter <span className="text-slate-600 font-normal normal-case">(optional)</span>
                </label>
                <SetterPickerPopover
                  setterId={form.setterId}
                  onChange={(repId) => update('setterId', repId)}
                  reps={reps}
                  trainerAssignments={trainerAssignments}
                  excludeRepId={closerId || undefined}
                />
                {setterAssignment && trainerRep && (
                  <p className="text-xs text-amber-400 mt-1.5">
                    ★ Trainer: {trainerRep.name} — override{' '}
                    <span className="font-semibold">${trainerOverrideRate.toFixed(2)}/W</span>
                    {currentTier?.upToDeal !== null && nextTier
                      ? ` (${currentTier!.upToDeal! - setterCompletedDeals} deals until $${nextTier.ratePerW.toFixed(2)}/W)`
                      : ' (perpetual)'}
                  </p>
                )}
              </div>
            </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="transition-all duration-200">
                <label htmlFor="field-customerName" className={labelCls}>
                  <span className="inline-flex items-center gap-1">Customer Name {fieldCheck('customerName')}</span>
                </label>
                <input id="field-customerName" ref={customerNameInputRef} type="text" placeholder="e.g. John & Jane Smith"
                  value={form.customerName} onChange={(e) => update('customerName', e.target.value)}
                  onBlur={() => handleBlur('customerName')} aria-invalid={!!errors.customerName}
                  className={inputCls('customerName')} />
                <FieldError errors={errors} field="customerName" />
              </div>
              <div className="transition-all duration-200">
                <label htmlFor="field-soldDate" className={labelCls}>
                  <span className="inline-flex items-center gap-1">Sold Date {fieldCheck('soldDate')}</span>
                </label>
                <input id="field-soldDate" type="date" value={form.soldDate}
                  onChange={(e) => update('soldDate', e.target.value)} onBlur={() => handleBlur('soldDate')}
                  aria-invalid={!!errors.soldDate} className={inputCls('soldDate')} />
                <FieldError errors={errors} field="soldDate" />
              </div>
            </div>
          </div>
        </div>
        )} {/* end currentStep === 0 */}

        {/* ── Section 2: Deal Details ── */}
        {currentStep === 1 && (
        <div id="section-deal" className="card-surface rounded-2xl p-6 overflow-visible">
          <SectionHeader step={2} label="Deal Details" />

          <div className="space-y-4">
            {/* ── Card 1: Installer / Financer / Product selects ── */}
            <div className="card-surface rounded-2xl p-5 mb-4 animate-slide-in-scale stagger-1 space-y-4 overflow-visible relative z-10">
            {/* Installer */}
            <div className="transition-all duration-200">
              <label htmlFor="field-installer" className={labelCls}>
                <span className="inline-flex items-center gap-1">Installer {fieldCheck('installer')}</span>
              </label>
              <SearchableSelect
                value={form.installer}
                onChange={(val) => handleInstallerChange(val)}
                options={activeInstallers.map((i) => ({ value: i, label: i }))}
                placeholder="— Select installer —"
                error={!!errors.installer}
              />
              <FieldError errors={errors} field="installer" />
            </div>

            {/* Product Type — shown once installer is selected */}
            {form.installer && (
              <div className="transition-all duration-200">
                <label className={labelCls}>
                  <span className="inline-flex items-center gap-1">Product Type {fieldCheck('productType')}</span>
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {PRODUCT_TYPES.map((pt) => (
                    <button
                      key={pt}
                      type="button"
                      onClick={() => {
                        const isCash = pt === 'Cash';
                        setForm((prev) => ({
                          ...prev,
                          productType: pt,
                          // Auto-set financer for Cash (no financing needed)
                          financer: isCash ? 'Cash' : (prev.productType === 'Cash' ? '' : prev.financer),
                          // Reset family/product selections when product type changes
                          solarTechFamily: '', solarTechProductId: '', pcFamily: '', installerProductId: '', prepaidSubType: '',
                        }));
                        isDirty.current = true;
                        setErrors((prev) => ({ ...prev, productType: '', financer: isCash ? '' : prev.financer }));
                        setTouched((prev) => { const next = new Set(prev); next.add('productType'); return next; });
                      }}
                      className={`py-2.5 rounded-xl text-sm font-medium border transition-all ${
                        form.productType === pt
                          ? 'bg-blue-600 border-blue-500 text-white shadow-[0_0_10px_rgba(37,99,235,0.3)]'
                          : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
                      }`}
                    >
                      {pt}
                    </button>
                  ))}
                </div>
                <FieldError errors={errors} field="productType" />
              </div>
            )}

            {/* Cash product type — no financer needed indicator */}
            {form.installer && form.productType === 'Cash' && (
              <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/50 rounded-xl px-4 py-2.5 text-sm text-slate-300">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Cash deal — no financer required
              </div>
            )}

            {/* Financing — shown once product type is selected */}
            {form.installer && form.productType && (
              form.installer === 'SolarTech' ? (
                <>
                  {/* SolarTech: product family picker */}
                  <div className="transition-all duration-200">
                    <label className={labelCls}>
                      <span className="inline-flex items-center gap-1">Product Family {fieldCheck('solarTechFamily')}</span>
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {SOLARTECH_FAMILIES.map((family) => {
                        const selected = form.solarTechFamily === family;
                        const isPrepaid = family === 'Cash/HDM/PE';
                        const cashOrLoan = form.productType === 'Cash' || form.productType === 'Loan';
                        const disabled = cashOrLoan && !isPrepaid;
                        return (
                          <button
                            key={family}
                            type="button"
                            disabled={disabled}
                            onClick={() => !disabled && handleSolarTechFamilyChange(family)}
                            className={`py-2.5 px-3 rounded-xl text-sm font-medium border transition-all text-left leading-tight ${
                              disabled
                                ? 'bg-slate-800/40 border-slate-700/40 text-slate-600 cursor-not-allowed opacity-50'
                                : selected
                                  ? 'bg-blue-600/20 border-blue-500/60 text-blue-300 shadow-[0_0_12px_rgba(37,99,235,0.2)]'
                                  : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
                            }`}
                          >
                            <span className={`text-xs font-semibold ${disabled ? 'text-slate-600' : selected ? 'text-blue-400' : 'text-slate-500'}`}>
                              {isPrepaid ? 'Prepaid' : family}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {(form.productType === 'Cash' || form.productType === 'Loan') && (
                      <p className="text-xs text-slate-500 mt-1">Only Prepaid family is compatible with {form.productType} deals</p>
                    )}
                    <FieldError errors={errors} field="solarTechFamily" />
                  </div>

                  {/* Prepaid sub-type — shown when prepaid family is selected OR Cash/Loan with prepaid options */}
                  {getInstallerPrepaidOptions(form.installer).length > 0 && (
                    form.solarTechFamily === 'Cash/HDM/PE' || (form.productType === 'Cash' || form.productType === 'Loan')
                  ) && (
                    <div className="transition-all duration-200">
                      <label className={labelCls}>
                        <span className="inline-flex items-center gap-1">Prepaid Type</span>
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {getInstallerPrepaidOptions(form.installer).map((opt) => (
                          <button key={opt} type="button"
                            onClick={() => { update('prepaidSubType', opt); setTouched((prev) => { const next = new Set(prev); next.add('prepaidSubType'); return next; }); }}
                            className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                              form.prepaidSubType === opt
                                ? 'bg-violet-600/20 border-violet-500/60 text-violet-300 shadow-[0_0_10px_rgba(139,92,246,0.2)]'
                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Financer — independent dropdown for SolarTech (hidden for Cash) */}
                  {form.productType !== 'Cash' && (
                    <div className="transition-all duration-200">
                      <label className={labelCls}>
                        <span className="inline-flex items-center gap-1">Financer {fieldCheck('financer')}</span>
                      </label>
                      <SearchableSelect
                        value={form.financer}
                        onChange={(val) => handleFinancerChange(val)}
                        options={activeFinancers.map((f) => ({ value: f, label: f }))}
                        placeholder="— Select financer —"
                        error={!!errors.financer}
                      />
                      <FieldError errors={errors} field="financer" />
                    </div>
                  )}

                  {/* Equipment Package — revealed once a family is selected */}
                  {hasSolarTechProducts && (
                    <div className="transition-all duration-200">
                      <label htmlFor="field-solarTechProductId" className={labelCls}>
                        <span className="inline-flex items-center gap-1">Equipment Package {fieldCheck('solarTechProductId')}</span>
                      </label>
                      <SearchableSelect
                        value={form.solarTechProductId}
                        onChange={(val) => update('solarTechProductId', val)}
                        options={SOLARTECH_PRODUCTS.filter((p) => p.family === solarTechFamily).map((p) => ({ value: p.id, label: p.name }))}
                        placeholder="— Select package —"
                        error={!!errors.solarTechProductId}
                      />
                      <FieldError errors={errors} field="solarTechProductId" />
                    </div>
                  )}
                </>
              ) : isPcInstaller ? (
                <>
                  {/* Product Catalog installer: product family button picker */}
                  <div className="transition-all duration-200">
                    <label className={labelCls}>
                      <span className="inline-flex items-center gap-1">Product Family {fieldCheck('pcFamily')}</span>
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(() => {
                        const cashOrLoan = form.productType === 'Cash' || form.productType === 'Loan';
                        const hasPrepaidConfig = !!pcConfig.prepaidFamily;
                        return pcConfig.families.map((family) => {
                          const selected = form.pcFamily === family;
                          const isPrepaidFamily = pcConfig.prepaidFamily === family;
                          // Only restrict families if a prepaid family is actually configured
                          const disabled = cashOrLoan && hasPrepaidConfig && !isPrepaidFamily;
                          return (
                            <button
                              key={family}
                              type="button"
                              disabled={disabled}
                              onClick={() => !disabled && handlePcFamilyChange(family)}
                              className={`py-2.5 px-3 rounded-xl text-sm font-medium border transition-all text-left leading-tight ${
                                disabled
                                  ? 'bg-slate-800/40 border-slate-700/40 text-slate-600 cursor-not-allowed opacity-50'
                                  : selected
                                    ? 'bg-blue-600/20 border-blue-500/60 text-blue-300 shadow-[0_0_12px_rgba(37,99,235,0.2)]'
                                    : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
                              }`}
                            >
                              <span className={`text-xs font-semibold ${disabled ? 'text-slate-600' : selected ? 'text-blue-400' : 'text-slate-500'}`}>{family}</span>
                            </button>
                          );
                        });
                      })()}
                    </div>
                    {(form.productType === 'Cash' || form.productType === 'Loan') && pcConfig.prepaidFamily && (
                      <p className="text-xs text-slate-500 mt-1">Only {pcConfig.prepaidFamily} family is compatible with {form.productType} deals</p>
                    )}
                    <FieldError errors={errors} field="pcFamily" />
                  </div>

                  {/* Prepaid sub-type — shown when installer has prepaid options AND (Cash/Loan or prepaid family selected) */}
                  {getInstallerPrepaidOptions(form.installer).length > 0 && (
                    (form.productType === 'Cash' || form.productType === 'Loan') ||
                    (pcConfig.prepaidFamily && form.pcFamily === pcConfig.prepaidFamily)
                  ) && (
                    <div className="transition-all duration-200">
                      <label className={labelCls}>
                        <span className="inline-flex items-center gap-1">Prepaid Type</span>
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {getInstallerPrepaidOptions(form.installer).map((opt) => (
                          <button key={opt} type="button"
                            onClick={() => { update('prepaidSubType', opt); setTouched((prev) => { const next = new Set(prev); next.add('prepaidSubType'); return next; }); }}
                            className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                              form.prepaidSubType === opt
                                ? 'bg-violet-600/20 border-violet-500/60 text-violet-300 shadow-[0_0_10px_rgba(139,92,246,0.2)]'
                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Financer — independent dropdown for PC installer (hidden for Cash) */}
                  {form.productType !== 'Cash' && (
                    <div className="transition-all duration-200">
                      <label className={labelCls}>
                        <span className="inline-flex items-center gap-1">Financer {fieldCheck('financer')}</span>
                      </label>
                      <SearchableSelect
                        value={form.financer}
                        onChange={(val) => handleFinancerChange(val)}
                        options={activeFinancers.map((f) => ({ value: f, label: f }))}
                        placeholder="— Select financer —"
                        error={!!errors.financer}
                      />
                      <FieldError errors={errors} field="financer" />
                    </div>
                  )}

                  {/* Product picker — revealed once a family is selected */}
                  {hasPcProducts && (
                    <div className="transition-all duration-200">
                      <label htmlFor="field-installerProductId" className={labelCls}>
                        <span className="inline-flex items-center gap-1">Equipment Package {fieldCheck('installerProductId')}</span>
                      </label>
                      <SearchableSelect
                        value={form.installerProductId}
                        onChange={(val) => update('installerProductId', val)}
                        options={productCatalogProducts.filter((p) => p.installer === form.installer && p.family === pcFamily).map((p) => ({ value: p.id, label: p.name }))}
                        placeholder="— Select package —"
                        error={!!errors.installerProductId}
                      />
                      <FieldError errors={errors} field="installerProductId" />
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Standard installer: financer dropdown (hidden for Cash) */}
                  {form.productType !== 'Cash' && (
                    <div className="transition-all duration-200">
                      <label className={labelCls}>
                        <span className="inline-flex items-center gap-1">Financer {fieldCheck('financer')}</span>
                      </label>
                      <SearchableSelect
                        value={form.financer}
                        onChange={(val) => handleFinancerChange(val)}
                        options={activeFinancers.map((f) => ({ value: f, label: f }))}
                        placeholder="— Select financer —"
                        error={!!errors.financer}
                      />
                      <FieldError errors={errors} field="financer" />
                    </div>
                  )}

                  {/* Prepaid sub-type for standard installers — shown for Cash/Loan when installer has prepaid options */}
                  {getInstallerPrepaidOptions(form.installer).length > 0 && (form.productType === 'Cash' || form.productType === 'Loan') && (
                    <div className="transition-all duration-200">
                      <label className={labelCls}>
                        <span className="inline-flex items-center gap-1">Prepaid Type</span>
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {getInstallerPrepaidOptions(form.installer).map((opt) => (
                          <button key={opt} type="button"
                            onClick={() => { update('prepaidSubType', opt); setTouched((prev) => { const next = new Set(prev); next.add('prepaidSubType'); return next; }); }}
                            className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                              form.prepaidSubType === opt
                                ? 'bg-violet-600/20 border-violet-500/60 text-violet-300 shadow-[0_0_10px_rgba(139,92,246,0.2)]'
                                : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-500 hover:text-white'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )
            )}
            </div> {/* end card-surface 1 */}

            {/* ── Card 2: System Size & Pricing ── */}
            <div className="card-surface rounded-2xl p-5 animate-slide-in-scale stagger-2 space-y-4 relative z-0">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="transition-all duration-200">
                  <label htmlFor="field-kWSize" className={labelCls}>
                    <span className="inline-flex items-center gap-1">System Size (kW) {fieldCheck('kWSize')}</span>
                  </label>
                  <div className="relative">
                    <input id="field-kWSize" type="number" step="0.1" min="0.1" placeholder="8.4"
                      value={form.kWSize} onChange={(e) => update('kWSize', e.target.value)}
                      onBlur={() => handleBlur('kWSize')} aria-invalid={!!errors.kWSize}
                      className={inputCls('kWSize') + (kW > 0 && !errors.kWSize ? ' pr-9' : '')} />
                    {kW > 0 && !errors.kWSize && (
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                        <Check className="w-4 h-4 text-emerald-400" strokeWidth={2.5} />
                      </span>
                    )}
                  </div>
                  <FieldError errors={errors} field="kWSize" />
                </div>
                <div className="transition-all duration-200">
                  <label htmlFor="field-netPPW" className={labelCls}>
                    <span className="inline-flex items-center gap-1">Net PPW ($/W) {fieldCheck('netPPW')}</span>
                  </label>
                  <div className="relative">
                    <input id="field-netPPW" type="number" step="0.01" min="0.01" placeholder="3.45"
                      value={form.netPPW} onChange={(e) => update('netPPW', e.target.value)}
                      onBlur={() => handleBlur('netPPW')} aria-invalid={!!errors.netPPW}
                      className={inputCls('netPPW') + (soldPPW > 0 && !errors.netPPW ? ' pr-9' : '')} />
                    {soldPPW > 0 && !errors.netPPW && (
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                        <Check className="w-4 h-4 text-emerald-400" strokeWidth={2.5} />
                      </span>
                    )}
                  </div>
                  <FieldError errors={errors} field="netPPW" />
                  <PpwHint soldPPW={soldPPW} closerPerW={closerPerW} hasError={!!errors.netPPW} />
                </div>
              </div>

              {/* Commission preview */}
              <div style={{ maxHeight: showPreview || (isSubDealer && subDealerCommission > 0) ? '400px' : '0px', overflow: 'hidden', transition: 'max-height 0.4s ease-in-out' }}>
                <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 text-sm space-y-2">
                  <p className="text-slate-400 font-medium text-xs uppercase tracking-wider mb-2">Commission Preview</p>
                  {isSubDealer ? (
                    <>
                      {subDealerRate > 0 && (
                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                          <span>Sub-dealer rate</span>
                          <span>${subDealerRate.toFixed(2)}/W</span>
                        </div>
                      )}
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>M1</span>
                        <span className="text-slate-600">N/A &mdash; paid at install</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-slate-400">M2 commission</span>
                        <span className="text-emerald-400 font-semibold">
                          <TickerAmount amount={subDealerCommission} />
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between text-xs text-slate-500 mb-1">
                        <span>Your redline</span>
                        <span>${closerPerW.toFixed(2)}/W</span>
                      </div>
                      {currentRole === 'admin' && (
                        <div className="flex justify-between text-xs text-slate-500 mb-1">
                          <span>Kilo baseline</span>
                          <span>${kiloPerW.toFixed(2)}/W</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-slate-400">Closer commission</span>
                        <span className="text-emerald-400 font-semibold">
                          <TickerAmount amount={closerTotal} />
                          <span className="text-slate-500 font-normal">
                            {' '}(M1: <TickerAmount amount={closerM1} className="tabular-nums" /> · M2: <TickerAmount amount={closerM2} className="tabular-nums" />{hasM3 && <> · M3: <TickerAmount amount={closerM3} className="tabular-nums" /></>})
                          </span>
                        </span>
                      </div>
                      {form.setterId && setterTotal > 0 && (
                        <div className="flex justify-between">
                          <span className="text-slate-400">Setter commission</span>
                          <span className="text-blue-400 font-semibold">
                            <TickerAmount amount={setterTotal} />
                            <span className="text-slate-500 font-normal">
                              {' '}(M1: <TickerAmount amount={setterM1} className="tabular-nums" /> · M2: <TickerAmount amount={setterM2} className="tabular-nums" />{hasM3 && <> · M3: <TickerAmount amount={setterM3} className="tabular-nums" /></>})
                            </span>
                          </span>
                        </div>
                      )}
                      {trainerRep && trainerTotal > 0 && (
                        <div className="flex justify-between">
                          <span className="text-slate-400">Trainer override ({trainerRep.name})</span>
                          <span className="text-amber-400 font-semibold">
                            <TickerAmount amount={trainerTotal} />
                            <span className="text-slate-500 font-normal"> (${trainerOverrideRate.toFixed(2)}/W)</span>
                          </span>
                        </div>
                      )}
                      {currentRole === 'admin' && (
                        <div className="flex justify-between border-t border-slate-700 pt-2">
                          <span className="text-slate-400">Kilo revenue</span>
                          <TickerAmount amount={kiloTotal} className="text-slate-300 font-semibold" />
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div> {/* end card-surface 2 */}

          </div>
        </div>
        )} {/* end currentStep === 1 */}

        {/* ── Section 3: Review & Notes ── */}
        {currentStep === 2 && (
        <div id="section-review" className="card-surface rounded-2xl p-6">
          <SectionHeader step={3} label="Review & Notes" />

          <div className="space-y-4">

            {/* ── Deal summary card — card-surface with top gradient accent ── */}
            <div className="relative card-surface rounded-2xl p-5 mb-4 overflow-hidden animate-slide-in-scale stagger-1 after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-blue-500/30 after:to-transparent">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Deal Summary</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                <div>
                  <p className="text-slate-500 text-xs mb-0.5">Customer</p>
                  <p className="text-white font-medium truncate">{form.customerName || <span className="text-slate-600 italic">—</span>}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-xs mb-0.5">Sold Date</p>
                  <p className="text-white font-medium">{form.soldDate || <span className="text-slate-600 italic">—</span>}</p>
                </div>
                {currentRole === 'admin' && (
                  <div>
                    <p className="text-slate-500 text-xs mb-0.5">Closer</p>
                    <p className="text-white font-medium truncate">
                      {reps.find((r) => r.id === form.repId)?.name || <span className="text-slate-600 italic">—</span>}
                    </p>
                  </div>
                )}
                {form.setterId && (
                  <div>
                    <p className="text-slate-500 text-xs mb-0.5">Setter</p>
                    <p className="text-white font-medium truncate">
                      {reps.find((r) => r.id === form.setterId)?.name || <span className="text-slate-600 italic">—</span>}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-slate-500 text-xs mb-0.5">Installer</p>
                  <p className="text-white font-medium truncate">{form.installer || <span className="text-slate-600 italic">—</span>}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-xs mb-0.5">Financer</p>
                  <p className="text-white font-medium truncate">{form.financer || <span className="text-slate-600 italic">—</span>}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-xs mb-0.5">Product Type</p>
                  <p className="text-white font-medium">{form.productType || <span className="text-slate-600 italic">—</span>}</p>
                </div>
                <div>
                  <p className="text-slate-500 text-xs mb-0.5">System Size</p>
                  <p className="text-white font-medium">
                    {kW > 0 ? `${kW.toFixed(1)} kW` : <span className="text-slate-600 italic">—</span>}
                    {kW > 0 && soldPPW > 0 && <span className="text-slate-400"> @ ${soldPPW.toFixed(2)}/W</span>}
                  </p>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="transition-all duration-200">
              <label htmlFor="field-notes" className={labelCls}>
                Notes <span className="text-slate-600 font-normal normal-case">(optional)</span>
              </label>
              <textarea
                id="field-notes"
                ref={notesRef}
                placeholder="Add any notes about this deal (roof type, special conditions, follow-ups...)"
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = el.scrollHeight + 'px';
                }}
                className={inputCls('') + ' min-h-[80px] max-h-[200px] overflow-y-auto resize-none'}
              />
              <div className="flex items-center justify-between mt-1 mb-4">
                <p className="text-xs italic text-slate-600">Internal notes only — not visible to customer</p>
                <p className={`text-xs transition-colors duration-200 ${
                  form.notes.length >= 500 ? 'text-red-400' :
                  form.notes.length >= 400 ? 'text-amber-400' :
                  'text-slate-500'
                }`}>
                  {form.notes.length}/500
                </p>
              </div>
            </div>

            {/* Lead Source + Blitz Attribution */}
            <div className="transition-all duration-200 pt-2 border-t border-slate-800/60">
              <label htmlFor="field-leadSource" className={labelCls}>
                Lead Source <span className="text-slate-600 font-normal normal-case">(optional)</span>
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <select
                  id="field-leadSource"
                  value={form.leadSource}
                  onChange={(e) => {
                    const val = e.target.value;
                    update('leadSource', val);
                    if (val !== 'blitz') update('blitzId', '');
                  }}
                  className={inputCls('')}
                >
                  <option value="">— Select —</option>
                  <option value="organic">Organic</option>
                  <option value="referral">Referral</option>
                  <option value="blitz">Blitz</option>
                  <option value="door_knock">Door Knock</option>
                  <option value="web">Web Lead</option>
                  <option value="other">Other</option>
                </select>

                {form.leadSource === 'blitz' && (
                  <select
                    id="field-blitzId"
                    value={form.blitzId}
                    onChange={(e) => {
                      const blitzId = e.target.value;
                      update('blitzId', blitzId);
                      // Smart default sold date based on blitz date range (#15)
                      if (blitzId) {
                        const blitz = availableBlitzes.find((b) => b.id === blitzId);
                        if (blitz?.startDate && blitz?.endDate) {
                          const today = new Date().toISOString().split('T')[0];
                          if (today >= blitz.startDate && today <= blitz.endDate) {
                            // Today is within the blitz range — keep today
                            update('soldDate', today);
                          } else if (today < blitz.startDate) {
                            // Before blitz — set to blitz start
                            update('soldDate', blitz.startDate);
                          } else {
                            // After blitz — set to blitz end
                            update('soldDate', blitz.endDate);
                          }
                        }
                      }
                    }}
                    className={inputCls('')}
                  >
                    <option value="">— Select Blitz —</option>
                    {availableBlitzes.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          </div>
        </div>
        )} {/* end currentStep === 2 */}

        </div> {/* end animated step wrapper */}

        {/* ── Actions ── */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Previous — shown on steps 1 and 2 */}
          {currentStep > 0 && (
            <button
              type="button"
              onClick={handlePrev}
              disabled={submitting}
              className="btn-secondary bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-medium px-6 py-3 rounded-xl active:scale-[0.97] disabled:opacity-60 text-sm transition-colors"
            >
              Previous
            </button>
          )}

          {/* Next — shown on steps 0 and 1 */}
          {currentStep < DEAL_STEPS.length - 1 && (
            <button
              type="button"
              onClick={handleNext}
              className="btn-primary inline-flex items-center gap-2 text-white font-semibold px-8 py-3 rounded-xl active:scale-[0.97] text-sm"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              Next
            </button>
          )}

          {/* Submit — shown on the last step only, with pulsing glow */}
          {currentStep === DEAL_STEPS.length - 1 && (
            <div className="relative inline-flex">
              {!submitting && <div className="absolute -inset-0.5 rounded-xl bg-gradient-to-r from-blue-500 to-emerald-500 opacity-[0.06] blur-[2px] animate-pulse" />}
            <button
              type="submit"
              disabled={submitting}
              className="relative btn-primary inline-flex items-center gap-2 text-white font-semibold px-8 py-3 rounded-xl active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 text-sm"
              style={{ backgroundColor: 'var(--brand)' }}
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Submitting…</>
              ) : (
                <>
                  <Check className="w-4 h-4" />
                  Submit Deal
                </>
              )}
            </button>
            </div>
          )}

          {/* Cancel — always visible */}
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            disabled={submitting}
            className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 font-medium px-6 py-3 rounded-xl active:scale-[0.97] disabled:opacity-60 text-sm transition-colors"
          >
            Cancel
          </button>

          {currentStep === DEAL_STEPS.length - 1 && !submitting && (
            <kbd
              className="ml-auto font-mono text-[9px] text-slate-500 bg-slate-800/80 border border-slate-700/60 rounded px-1.5 py-0.5 leading-none select-none"
              aria-hidden="true"
              title="Press ⌘Enter (or Ctrl+Enter) to submit"
            >
              ⌘↵ submit
            </kbd>
          )}
        </div>

      </form>
      </div>

      {/* ── Sticky mobile commission preview bar (step 2 only) ── */}
      {currentStep === 1 && showPreview && (
        <div className="fixed bottom-0 left-0 right-0 md:hidden z-40 bg-slate-900/95 backdrop-blur-sm border-t border-slate-800 px-4 py-3">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider leading-none mb-0.5">
                {form.installer}{kW > 0 ? ` \u00B7 ${kW.toFixed(1)} kW` : ''}
              </span>
              <span className="text-lg font-black text-blue-400" style={{ fontVariantNumeric: 'tabular-nums' }}>
                Est. Commission: ${closerTotal.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
