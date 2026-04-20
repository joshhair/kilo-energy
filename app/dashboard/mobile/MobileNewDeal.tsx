'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import {
  PRODUCT_TYPES, Project,
  getTrainerOverrideRate, calculateCommission,
  SOLARTECH_FAMILIES, SOLARTECH_FAMILY_FINANCER,
  getSolarTechBaseline, getInstallerRatesForDeal, getProductCatalogBaselineVersioned,
  INSTALLER_PAY_CONFIGS, DEFAULT_INSTALL_PAY_PCT,
} from '../../../lib/data';
import { Check, Loader2, ChevronLeft, CheckCircle2, ArrowRight, RotateCcw, Pencil } from 'lucide-react';
import { SetterPickerPopover } from '../components/SetterPickerPopover';
import { CoPartySection, type CoPartyDraft } from '../projects/components/CoPartySection';
import { evenSplit } from '../../../lib/commission-split';
import { splitCloserSetterPay } from '../../../lib/commission';
import MobileCard from './shared/MobileCard';

// ── Validation (mirrors desktop exactly) ────────────────────────────────────

function validateField(field: string, value: string): string {
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

function genId(prefix: string): string {
  return `${prefix}_${Date.now()}`;
}

// ── Inline components ────────────────────────────────────────────────────────

function FieldError({ field, errors }: { field: string; errors: Record<string, string> }) {
  return errors[field] ? (
    <p className="text-red-400 text-base mt-1" role="alert">{errors[field]}</p>
  ) : null;
}

// ── Step indicator ───────────────────────────────────────────────────────────

const DEAL_STEPS = ['People', 'Deal Details', 'Review'] as const;

function StepIndicator({ currentStep }: { currentStep: number }) {
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
                ? '#1de9b6'
                : idx < currentStep
                ? 'rgba(29,233,182,0.35)'
                : 'rgba(255,255,255,0.18)',
              transition: 'all 320ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              flexShrink: 0,
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: '12px', color: 'rgba(255,255,255,0.4)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>
        Step {currentStep + 1} of {DEAL_STEPS.length}
      </span>
    </div>
  );
}

// ── Success screen ───────────────────────────────────────────────────────────

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

function MobileSuccessScreen({ deal, onReset }: { deal: SubmittedDeal; onReset: () => void }) {
  const router = useRouter();
  return (
    <div className="px-4 pt-3 pb-24 space-y-4">
      <div className="flex flex-col items-center text-center pt-4 mb-4">
        <div className="success-icon-spring w-14 h-14 rounded-full flex items-center justify-center mb-3" style={{ background: 'rgba(0,229,160,0.1)', border: '1px solid rgba(0,229,160,0.3)' }}>
          <CheckCircle2 className="w-7 h-7 text-green-400" strokeWidth={1.5} />
        </div>
        <div className="success-up-1">
          <h2 className="text-xl font-black text-white mb-1" style={{ fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>Deal Submitted!</h2>
          <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
            <span className="text-white font-semibold">{deal.customerName}</span> has been added to your pipeline.
          </p>
        </div>
      </div>

      <MobileCard className="success-up-2">
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Deal Summary</p>
        <div className="space-y-2 text-base">
          <div className="flex justify-between">
            <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Installer</span>
            <span className="text-white font-medium">{deal.installer}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Financer</span>
            <span className="text-white font-medium">{deal.financer || '---'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Product Type</span>
            <span className="text-white font-medium">{deal.productType}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>System</span>
            <span className="text-white font-medium">{deal.kW.toFixed(1)} kW @ ${deal.soldPPW.toFixed(2)}/W</span>
          </div>
        </div>
      </MobileCard>

      <MobileCard className="success-up-3">
        <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Commission</p>
        {deal.closerTotal > 0 ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-base font-medium" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>{deal.repName} (Closer)</p>
              <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                M1: ${deal.closerM1.toLocaleString()} · M2: ${deal.closerM2.toLocaleString()}
                {deal.closerM3 > 0 && ` · M3: $${deal.closerM3.toLocaleString()}`}
              </p>
            </div>
            <p className="text-xl font-black" style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>${deal.closerTotal.toLocaleString()}</p>
          </div>
        ) : (
          <p className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Commission will be calculated once pricing is confirmed.</p>
        )}
        {deal.setterTotal > 0 && (
          <div className="flex items-center justify-between pt-2 mt-2" style={{ borderTop: '1px solid var(--m-border, var(--border-mobile))' }}>
            <p className="text-base font-medium" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>{deal.setterName} (Setter)</p>
            <p className="text-lg font-bold text-blue-400">${deal.setterTotal.toLocaleString()}</p>
          </div>
        )}
      </MobileCard>

      <div className="success-up-4 space-y-2 pt-2">
        <button
          onClick={() => router.push('/dashboard/projects')}
          className="w-full min-h-[48px] flex items-center justify-center gap-2 text-black font-semibold rounded-xl text-base active:scale-[0.97]"
          style={{
            background: 'linear-gradient(135deg, var(--accent-emerald), var(--accent-cyan2))',
            boxShadow: '0 4px 20px rgba(0,229,160,0.25)',
            fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
          }}
        >
          View Projects <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={onReset}
          className="w-full min-h-[48px] flex items-center justify-center gap-2 font-medium rounded-xl text-base active:scale-[0.97]"
          style={{ background: 'var(--m-card, var(--surface-mobile-card))', border: '1px solid var(--m-border, var(--border-mobile))', color: 'var(--m-text-muted, var(--text-mobile-muted))' }}
        >
          <RotateCcw className="w-4 h-4" /> Submit Another
        </button>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function MobileNewDeal() {
  const {
    dbReady, effectiveRole, currentRepId, effectiveRepId, currentRepName,
    addDeal, projects, trainerAssignments,
    activeInstallers, activeFinancers, reps,
    installerPricingVersions, productCatalogInstallerConfigs,
    productCatalogProducts, productCatalogPricingVersions,
    getInstallerPrepaidOptions, installerBaselines,
    installerPayConfigs, solarTechProducts,
  } = useApp();
  const { toast } = useToast();
  const isSubDealer = effectiveRole === 'sub-dealer';

  // ── Form state ──────────────────────────────────────────────────────────────

  const blankForm = () => ({
    customerName: '',
    soldDate: new Date().toISOString().split('T')[0],
    installer: '',
    financer: '',
    productType: '',
    kWSize: '',
    netPPW: '',
    notes: '',
    repId: effectiveRole === 'admin' ? '' : (effectiveRepId ?? ''),
    setterId: '',
    solarTechFamily: '',
    solarTechProductId: '',
    pcFamily: '',
    installerProductId: '',
    prepaidSubType: '',
    leadSource: '',
    blitzId: '',
    // Tag-team co-parties. Mobile reuses the same CoPartySection the
    // desktop new-deal + project-detail admin edit use — grid gets tight
    // on 360px but stays functional. Future: mobile-optimized card list.
    additionalClosers: [] as CoPartyDraft[],
    additionalSetters: [] as CoPartyDraft[],
  });

  const [form, setForm] = useState(blankForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [_touched, setTouched] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [_stepping, setStepping] = useState(false);
  const [exitAnimClass, setExitAnimClass] = useState('');
  // Synchronous lock — React batches state updates inside the same event
  // tick, so `submitting` (state) still reads false on a rapid double-tap.
  // The ref flips immediately and guards against double-submission.
  const submittingRef = useRef(false);
  const [submitted, setSubmitted] = useState<SubmittedDeal | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const stepDirectionRef = useRef<'fwd' | 'back'>('fwd');
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const fieldWrapperRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const customerNameRef = useRef<HTMLInputElement>(null);
  const kWSizeRef = useRef<HTMLInputElement>(null);

  // Scroll to top when step changes
  useEffect(() => {
    const el = document.querySelector('main');
    if (el) el.scrollTop = 0;
    window.scrollTo(0, 0);
  }, [currentStep]);

  // Auto-focus first field after step enter animation completes
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t = setTimeout(() => {
      if (currentStep === 0) customerNameRef.current?.focus();
      else if (currentStep === 1) kWSizeRef.current?.focus();
    }, 330);
    return () => clearTimeout(t);
  }, [currentStep]);

  // Blitz list
  type BlitzListItem = {
    id: string;
    name: string;
    status: string;
    startDate?: string;
    endDate?: string;
    participants?: Array<{ userId: string; joinStatus: string }>;
  };
  const [_rawBlitzes, setRawBlitzes] = useState<BlitzListItem[]>([]);
  const [availableBlitzes, setAvailableBlitzes] = useState<Array<{ id: string; name: string; status: string; startDate?: string; endDate?: string }>>([]);
  useEffect(() => {
    fetch('/api/blitzes').then((r) => r.json()).then((data: BlitzListItem[]) => {
      setRawBlitzes(data ?? []);
      setAvailableBlitzes((data ?? []).filter((b) => {
        const statusOk = b.status === 'upcoming' || b.status === 'active' || b.status === 'completed';
        if (!statusOk) return false;
        if (effectiveRole === 'admin') return true;
        return b.participants?.some((p) => p.userId === effectiveRepId && p.joinStatus === 'approved');
      }));
    }).catch(() => {});
  }, [effectiveRole, effectiveRepId]);

  // Pre-fill last-used installer
  const lastInstallerApplied = useRef(false);
  const netPPWRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (lastInstallerApplied.current) return;
    lastInstallerApplied.current = true;
    try {
      const lastInstaller = localStorage.getItem('lastInstaller');
      if (lastInstaller && activeInstallers.includes(lastInstaller)) {
        setForm((prev) => prev.installer ? prev : { ...prev, installer: lastInstaller });
      }
    } catch {}
  }, [activeInstallers]);

  // ── Field helpers ─────────────────────────────────────────────────────────

  const update = (field: string, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleBlur = (field: string) => {
    const raw = form[field as keyof typeof form];
    const value = typeof raw === 'string' ? raw : '';
    setErrors((prev) => ({ ...prev, [field]: validateField(field, value) }));
    setTouched((prev) => { const next = new Set(prev); next.add(field); return next; });
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
    const rawMappedFinancer = SOLARTECH_FAMILY_FINANCER[value] ?? '';
    const mappedFinancer = rawMappedFinancer && activeFinancers.includes(rawMappedFinancer) ? rawMappedFinancer : '';
    // Loan deals must not inherit a 'Cash' financer from the family mapping
    const effectiveFinancer = form.productType === 'Loan' ? '' : mappedFinancer;
    setForm((prev) => ({ ...prev, solarTechFamily: value, solarTechProductId: '', financer: effectiveFinancer }));
    setErrors((prev) => ({ ...prev, solarTechFamily: validateField('solarTechFamily', value), solarTechProductId: '', financer: validateField('financer', effectiveFinancer) }));
    setTouched((prev) => { const next = new Set(prev); next.add('solarTechFamily'); return next; });
  };

  const handlePcFamilyChange = (value: string) => {
    const rawMappedFinancer = pcConfig?.familyFinancerMap?.[value] ?? '';
    const mappedFinancer = rawMappedFinancer && activeFinancers.includes(rawMappedFinancer) ? rawMappedFinancer : '';
    const effectiveFinancer = form.productType === 'Loan' ? '' : mappedFinancer;
    setForm((prev) => ({ ...prev, pcFamily: value, installerProductId: '', financer: effectiveFinancer, prepaidSubType: '' }));
    setErrors((prev) => ({ ...prev, pcFamily: validateField('pcFamily', value), installerProductId: '', financer: validateField('financer', effectiveFinancer) }));
    setTouched((prev) => { const next = new Set(prev); next.add('pcFamily'); return next; });
  };

  // ── Derived values (mirrors desktop exactly) ─────────────────────────────

  const currentRep = reps.find((r) => r.id === effectiveRepId);
  const closerId = effectiveRole === 'admin' ? form.repId : (currentRep?.repType === 'setter' ? '' : (effectiveRepId ?? ''));

  const solarTechFamily = form.installer === 'SolarTech' ? form.solarTechFamily : '';
  const solarTechFamilyProducts = solarTechProducts.filter((p) => p.family === solarTechFamily);
  const hasSolarTechProducts = solarTechFamilyProducts.length > 0;

  const pcConfig = productCatalogInstallerConfigs[form.installer] ?? null;
  const isPcInstaller = pcConfig !== null;
  const pcFamily = isPcInstaller ? form.pcFamily : '';
  const pcFamilyProducts = isPcInstaller ? productCatalogProducts.filter((p) => p.installer === form.installer && p.family === pcFamily) : [];
  const hasPcProducts = isPcInstaller && pcFamily !== '' && pcFamilyProducts.length > 0;

  const setterAssignment = form.setterId ? trainerAssignments.find((a) => a.traineeId === form.setterId) : null;
  const isFullyPaidOut = (p: Project): boolean => {
    const pct = installerPayConfigs[p.installer]?.installPayPct ?? INSTALLER_PAY_CONFIGS[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
    return pct < 100 ? p.m3Paid === true : p.m2Paid === true;
  };
  const setterCompletedDeals = form.setterId
    ? projects.filter((p) => (p.setterId === form.setterId || p.repId === form.setterId) && isFullyPaidOut(p)).length
    : 0;
  const trainerOverrideRate = setterAssignment ? getTrainerOverrideRate(setterAssignment, setterCompletedDeals) : 0;
  const trainerRep = setterAssignment ? reps.find((r) => r.id === setterAssignment.trainerId) : null;

  const kW = parseFloat(form.kWSize) || 0;
  const soldPPW = parseFloat(form.netPPW) || 0;

  const { closerPerW, setterBaselinePerW, kiloPerW, activeVersionId } = (() => {
    if (form.installer === 'SolarTech' && hasSolarTechProducts && form.solarTechProductId && kW > 0) {
      const b = getSolarTechBaseline(form.solarTechProductId, kW, solarTechProducts);
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

  // Use the canonical splitCloserSetterPay so mobile preview stays
  // exactly in sync with what POST /api/projects + PATCH /api/projects
  // compute server-side (Batch 2b.4). Prevents the ±1¢ drift the old
  // manual float math produced when setter baseline + trainer rate +
  // installPayPct combined in edge cases.
  const installPayPct = installerPayConfigs[form.installer]?.installPayPct ?? INSTALLER_PAY_CONFIGS[form.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
  const hasM3 = installPayPct < 100;
  const isSelfGen = !form.setterId || setterBaselinePerW === 0;

  const split = splitCloserSetterPay(
    soldPPW,
    closerPerW,
    isSelfGen ? 0 : setterBaselinePerW,
    trainerOverrideRate,
    kW,
    installPayPct,
  );

  const closerTotal = split.closerTotal;
  const setterTotal = split.setterTotal;
  const closerM1 = split.closerM1;
  const closerM2 = split.closerM2;
  const closerM3 = split.closerM3;
  const setterM1 = split.setterM1;
  const setterM2 = split.setterM2;
  const setterM3 = split.setterM3;
  const trainerM1 = 0;
  const trainerM2 = trainerTotal;

  const kiloTotal = calculateCommission(soldPPW, kiloPerW, kW);

  const showPreview = closerPerW > 0 && kW > 0 && soldPPW > 0;

  const [commFlash, setCommFlash] = useState(false);
  const prevCloserTotalRef = useRef<number>(0);

  const prevShowPreviewRef = useRef(false);
  const [displayedTotal, setDisplayedTotal] = useState(0);
  const countUpRafRef = useRef<number | null>(null);
  const [pillMount, setPillMount] = useState(false);

  useEffect(() => {
    const firstAppear = !prevShowPreviewRef.current && showPreview;
    prevShowPreviewRef.current = showPreview;
    if (!showPreview) { setDisplayedTotal(0); setPillMount(false); return; }
    setPillMount(currentStep === 1);
    if (firstAppear && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const start = performance.now();
      const duration = 480;
      const target = closerTotal;
      const easeOutExpo = (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));
      if (countUpRafRef.current) cancelAnimationFrame(countUpRafRef.current);
      const tick = (now: number) => {
        const t = Math.min((now - start) / duration, 1);
        setDisplayedTotal(Math.round(easeOutExpo(t) * target));
        if (t < 1) countUpRafRef.current = requestAnimationFrame(tick);
      };
      countUpRafRef.current = requestAnimationFrame(tick);
      return () => { if (countUpRafRef.current) cancelAnimationFrame(countUpRafRef.current); };
    } else {
      setDisplayedTotal(closerTotal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- currentStep intentionally not a dep; count-up should only fire on closerTotal change
  }, [showPreview, closerTotal]);

  useEffect(() => {
    if (closerTotal !== prevCloserTotalRef.current && (closerTotal > 0 || prevCloserTotalRef.current > 0)) {
      prevCloserTotalRef.current = closerTotal;
      setCommFlash(false);
      // Force re-trigger by resetting then setting in rAF
      requestAnimationFrame(() => setCommFlash(true));
      const t = setTimeout(() => setCommFlash(false), 560);
      return () => clearTimeout(t);
    }
    prevCloserTotalRef.current = closerTotal;
  }, [closerTotal]);

  // Sub-dealer commission
  const subDealerRate = (() => {
    if (!isSubDealer || !form.installer) return 0;
    const baseline = installerBaselines[form.installer];
    if (baseline) return baseline.subDealerPerW ?? 0;
    // Tiered installer: resolve the correct band using the deal's kW
    if (kW <= 0) return 0;
    const soldDate = form.soldDate || new Date().toISOString().split('T')[0];
    const r = getInstallerRatesForDeal(form.installer, soldDate, kW, installerPricingVersions);
    return r.subDealerPerW ?? 0;
  })();
  const subDealerCommission = isSubDealer && kW > 0 && subDealerRate > 0
    ? Math.max(0, (subDealerRate - kiloPerW) * kW * 1000)
    : 0;

  // ── Step validation ───────────────────────────────────────────────────────

  const isCashDeal = form.productType === 'Cash';

  const s1Fields: string[] = [
    ...(effectiveRole === 'admin' ? ['repId'] : []),
    'customerName',
    'soldDate',
  ];
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

  const handleNext = () => {
    const stepFields = currentStep === 0 ? s1Fields : currentStep === 1 ? s2Fields : [];
    const stepErrors: Record<string, string> = {};
    let hasStepErrors = false;
    for (const field of stepFields) {
      const raw = form[field as keyof typeof form];
      const value = typeof raw === 'string' ? raw : '';
      const error = validateField(field, value);
      stepErrors[field] = error;
      if (error) hasStepErrors = true;
    }
    setTouched((prev) => {
      const next = new Set(prev);
      stepFields.forEach((f) => next.add(f));
      return next;
    });
    setErrors((prev) => ({ ...prev, ...stepErrors }));
    if (hasStepErrors) {
      const firstErrorField = stepFields.find((f) => stepErrors[f]);
      if (firstErrorField) {
        const el = fieldWrapperRefs.current[firstErrorField];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.remove('field-error-pulse');
          void el.offsetWidth;
          el.classList.add('field-error-pulse');
          el.addEventListener('animationend', () => el.classList.remove('field-error-pulse'), { once: true });
        }
      }
      return;
    }
    stepDirectionRef.current = 'fwd';
    setExitAnimClass('deal-step-exit-fwd');
    setStepping(true);
    setTimeout(() => {
      setExitAnimClass('');
      setStepping(false);
      setCurrentStep(prev => Math.min(prev + 1, DEAL_STEPS.length - 1));
    }, 190);
  };

  const handlePrev = () => {
    stepDirectionRef.current = 'back';
    setExitAnimClass('deal-step-exit-back');
    setTimeout(() => {
      setExitAnimClass('');
      setCurrentStep(prev => Math.max(prev - 1, 0));
    }, 190);
  };

  // ── Submit (mirrors desktop exactly) ──────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    if (!dbReady) {
      toast('Data is still loading, please wait...', 'error');
      submittingRef.current = false;
      return;
    }

    const fieldsToValidate: string[] = [
      'customerName', 'soldDate', 'installer', ...(form.productType === 'Cash' ? [] : ['financer']), 'productType', 'kWSize', 'netPPW',
      ...(effectiveRole === 'admin' ? ['repId'] : []),
      ...(form.installer === 'SolarTech' ? ['solarTechFamily'] : []),
      ...(form.installer === 'SolarTech' && hasSolarTechProducts ? ['solarTechProductId'] : []),
      ...(isPcInstaller && form.installer !== 'SolarTech' ? ['pcFamily'] : []),
      ...(isPcInstaller && form.installer !== 'SolarTech' && hasPcProducts ? ['installerProductId'] : []),
    ];

    const newErrors: Record<string, string> = {};
    let hasErrors = false;
    for (const field of fieldsToValidate) {
      const raw = form[field as keyof typeof form];
      const value = typeof raw === 'string' ? raw : '';
      const error = validateField(field, value);
      newErrors[field] = error;
      if (error) hasErrors = true;
    }
    setErrors(newErrors);
    if (hasErrors) {
      submittingRef.current = false;
      return;
    }

    if (closerPerW === 0 && kW > 0 && soldPPW > 0) {
      toast('No pricing baseline found for this system size. Check that a matching tier exists for this product and kW.', 'error');
      submittingRef.current = false;
      return;
    }

    if (form.setterId && setterBaselinePerW === 0 && kW > 0 && soldPPW > 0) {
      toast('No setter pricing baseline found for this product. Remove the setter or fix the product pricing before submitting.', 'error');
      submittingRef.current = false;
      return;
    }

    setSubmitting(true);

    const rep = reps.find((r) => r.id === closerId);
    const setter = form.setterId ? reps.find((r) => r.id === form.setterId) : null;
    const projectId = genId('proj');

    // Tag-team: parse + reduce primary's amounts by co-party sums so the
    // deal total stays consistent with pricing-calc output. Same logic as
    // desktop new-deal.
    const parseNum = (v: string): number => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const cleanAdditionalClosers = form.additionalClosers
      .filter((c) => !!c.userId && c.userId !== closerId)
      .map((c, i) => ({
        userId: c.userId,
        userName: reps.find((r) => r.id === c.userId)?.name ?? '',
        m1Amount: parseNum(c.m1Amount),
        m2Amount: parseNum(c.m2Amount),
        m3Amount: c.m3Amount.trim() === '' ? null : parseNum(c.m3Amount),
        position: i + 1,
      }));
    const cleanAdditionalSetters = form.additionalSetters
      .filter((s) => !!s.userId && s.userId !== form.setterId)
      .map((s, i) => ({
        userId: s.userId,
        userName: reps.find((r) => r.id === s.userId)?.name ?? '',
        m1Amount: parseNum(s.m1Amount),
        m2Amount: parseNum(s.m2Amount),
        m3Amount: s.m3Amount.trim() === '' ? null : parseNum(s.m3Amount),
        position: i + 1,
      }));
    const coCloserM1Sum = cleanAdditionalClosers.reduce((a, b) => a + b.m1Amount, 0);
    const coCloserM2Sum = cleanAdditionalClosers.reduce((a, b) => a + b.m2Amount, 0);
    const coCloserM3Sum = cleanAdditionalClosers.reduce((a, b) => a + (b.m3Amount ?? 0), 0);
    const coSetterM1Sum = cleanAdditionalSetters.reduce((a, b) => a + b.m1Amount, 0);
    const coSetterM2Sum = cleanAdditionalSetters.reduce((a, b) => a + b.m2Amount, 0);
    const coSetterM3Sum = cleanAdditionalSetters.reduce((a, b) => a + (b.m3Amount ?? 0), 0);

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
      m1Amount: isSubDealer ? 0 : Math.max(0, closerM1 - coCloserM1Sum),
      m2Paid: false,
      m2Amount: isSubDealer ? subDealerCommission : Math.max(0, closerM2 - coCloserM2Sum),
      m3Amount: isSubDealer ? 0 : Math.max(0, closerM3 - coCloserM3Sum),
      m3Paid: false,
      setterM1Amount: isSubDealer ? 0 : Math.max(0, setterM1 - coSetterM1Sum),
      setterM2Amount: isSubDealer ? 0 : Math.max(0, setterM2 - coSetterM2Sum),
      setterM3Amount: isSubDealer ? 0 : Math.max(0, setterM3 - coSetterM3Sum),
      additionalClosers: cleanAdditionalClosers,
      additionalSetters: cleanAdditionalSetters,
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

    if (isSubDealer) {
      addDeal(newProject, 0, subDealerCommission, 0, 0, 0, 0, undefined);
    } else {
      addDeal(newProject, closerM1, closerM2, setterM1, setterM2, trainerM1, trainerM2,
        trainerTotal > 0 ? setterAssignment?.trainerId : undefined);
    }

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
    submittingRef.current = false;
  };

  // ── Style helpers ─────────────────────────────────────────────────────────

  const v0InputStyle = (field: string): React.CSSProperties => ({
    background: 'rgba(255,255,255,0.05)',
    border: errors[field] ? '1px solid #ef4444' : '0.5px solid rgba(255,255,255,0.1)',
    borderRadius: 14,
    padding: '16px 18px',
    fontSize: '1rem',
    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
  });

  const v0FocusCss = 'focus:!border-[rgba(29,233,182,0.3)] focus:shadow-[0_0_0_3px_rgba(29,233,182,0.08)]';

  const inputCls = (_field: string) =>
    `w-full text-white focus:outline-none transition-colors placeholder-[rgba(255,255,255,0.25)] ${v0FocusCss}`;

  const selectCls = (_field: string) =>
    `w-full text-white focus:outline-none transition-colors appearance-none ${v0FocusCss}`;

  const labelCls = 'mb-1.5 block uppercase';
  const labelStyle: React.CSSProperties = { fontSize: '0.8rem', fontWeight: 500, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.08em', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" };

  // ── Render ────────────────────────────────────────────────────────────────

  const netPPWGlowStyle: React.CSSProperties = (() => {
    const base = v0InputStyle('netPPW');
    if (soldPPW > 0 && closerPerW > 0 && !errors.netPPW) {
      const above = soldPPW >= closerPerW;
      return {
        ...base,
        border: above
          ? '1px solid rgba(16,185,129,0.5)'
          : '1px solid rgba(245,158,11,0.45)',
        boxShadow: above
          ? '0 0 0 3px rgba(16,185,129,0.12), inset 0 1px 0 rgba(16,185,129,0.08)'
          : '0 0 0 3px rgba(245,158,11,0.12), inset 0 1px 0 rgba(245,158,11,0.08)',
        transition: 'box-shadow 280ms ease, border-color 280ms ease',
      };
    }
    return { ...base, transition: 'box-shadow 280ms ease, border-color 280ms ease' };
  })();

  if (submitted) {
    return (
      <MobileSuccessScreen
        deal={submitted}
        onReset={() => {
          setSubmitted(null);
          setForm(blankForm());
          setErrors({});
          setTouched(new Set());
          setCurrentStep(0);
        }}
      />
    );
  }

  return (
    <div
      className="px-6 pt-3 pb-28 flex flex-col min-h-[calc(100vh-120px)]"
      style={{ touchAction: 'pan-y' }}
      onTouchStart={(e) => { touchStartXRef.current = e.touches[0].clientX; touchStartYRef.current = e.touches[0].clientY; }}
      onTouchEnd={(e) => {
        if (touchStartXRef.current === null || touchStartYRef.current === null) return;
        const dx = e.changedTouches[0].clientX - touchStartXRef.current;
        const dy = Math.abs(e.changedTouches[0].clientY - (touchStartYRef.current ?? 0));
        touchStartXRef.current = null;
        touchStartYRef.current = null;
        if (Math.abs(dx) < 50 || dy > Math.abs(dx) * 0.75) return;
        if (dx < -50 && currentStep < DEAL_STEPS.length - 1) handleNext();
        else if (dx > 50 && currentStep > 0) handlePrev();
      }}
    >
      <StepIndicator currentStep={currentStep} />

      {/* Page header */}
      <div className="mb-6">
        <p style={{ fontSize: '11px', fontWeight: 500, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.1em', textTransform: 'uppercase' as const }}>NEW DEAL</p>
        <span key={currentStep} style={{ display: 'block', animation: 'deal-title-enter 200ms cubic-bezier(0.16,1,0.3,1) both' }}>
          <h1 style={{ fontSize: '26px', fontWeight: 500, color: '#fff', lineHeight: 1.2, fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}>{DEAL_STEPS[currentStep]}</h1>
        </span>
      </div>

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="flex-1 flex flex-col">

        {/* ── Step 1: People ── */}
        {currentStep === 0 && (
          <div key={0} className={`space-y-7 flex-1 flex flex-col pb-[176px] ${exitAnimClass || (stepDirectionRef.current === 'fwd' ? 'deal-step-enter-fwd' : 'deal-step-enter-back')}`}>
            {/* Customer Name */}
            <div ref={(el) => { fieldWrapperRefs.current['customerName'] = el; }}>
              <label className={labelCls} style={labelStyle}>Customer Name</label>
              <input
                type="text"
                placeholder="e.g. John & Jane Smith"
                value={form.customerName}
                onChange={(e) => update('customerName', e.target.value)}
                onBlur={() => handleBlur('customerName')}
                className={inputCls('customerName')} style={v0InputStyle('customerName')}
              />
              <FieldError errors={errors} field="customerName" />
            </div>

            {/* Sold Date */}
            <div ref={(el) => { fieldWrapperRefs.current['soldDate'] = el; }}>
              <label className={labelCls} style={labelStyle}>Sold Date</label>
              <input
                type="date"
                value={form.soldDate}
                onChange={(e) => update('soldDate', e.target.value)}
                onBlur={() => handleBlur('soldDate')}
                className={inputCls('soldDate')} style={v0InputStyle('soldDate')}
              />
              <FieldError errors={errors} field="soldDate" />
            </div>

            {/* Closer (admin/PM only) */}
            {!isSubDealer && effectiveRole === 'admin' && (
              <div ref={(el) => { fieldWrapperRefs.current['repId'] = el; }}>
                <label className={labelCls} style={labelStyle}>Closer (Rep)</label>
                <select
                  value={form.repId}
                  onChange={(e) => update('repId', e.target.value)}
                  onBlur={() => handleBlur('repId')}
                  className={selectCls('repId')} style={v0InputStyle('repId')}
                >
                  <option value="">-- Select closer --</option>
                  {reps.filter((r) => r.repType !== 'setter' && r.id !== form.setterId && r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <FieldError errors={errors} field="repId" />
              </div>
            )}

            {/* Setter (optional) */}
            {!isSubDealer && (
              <div>
                <label className={labelCls} style={labelStyle}>Setter <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.07)', borderRadius: 6, padding: '2px 7px', marginLeft: 4 }}>optional</span></label>
                <SetterPickerPopover
                  setterId={form.setterId}
                  onChange={(repId) => update('setterId', repId)}
                  reps={reps}
                  trainerAssignments={trainerAssignments}
                  excludeRepId={closerId || undefined}
                />
                {setterAssignment && trainerRep && (
                  <p className="text-base text-amber-400 mt-1">
                    Trainer: {trainerRep.name} -- ${trainerOverrideRate.toFixed(2)}/W
                  </p>
                )}
              </div>
            )}

            {/* ── Tag-team: co-closers / co-setters ── Admin-only. Same
                CoPartySection as desktop; grid is tight on 360px but
                remains tappable. */}
            {effectiveRole === 'admin' && (
              <>
                <CoPartySection
                  label="Co-closers"
                  rows={form.additionalClosers}
                  primaryUserId={form.repId}
                  excludeUserIds={[form.setterId, ...form.additionalClosers.map((c) => c.userId), ...form.additionalSetters.map((s) => s.userId)].filter(Boolean)}
                  repTypeFilter={(r) => r.repType !== 'setter'}
                  reps={reps}
                  onChange={(rows) => setForm((f) => ({ ...f, additionalClosers: rows }))}
                  onFirstAdd={() => {
                    if (!closerTotal || closerTotal <= 0) return;
                    const m1 = evenSplit(closerM1, 2);
                    const m2 = evenSplit(closerM2, 2);
                    const m3 = evenSplit(closerM3, 2);
                    setForm((f) => ({
                      ...f,
                      additionalClosers: [
                        { userId: '', m1Amount: String(m1[1]), m2Amount: String(m2[1]), m3Amount: m3[1] ? String(m3[1]) : '' },
                      ],
                    }));
                  }}
                />
                <CoPartySection
                  label="Co-setters"
                  rows={form.additionalSetters}
                  primaryUserId={form.setterId}
                  excludeUserIds={[form.repId, form.setterId, ...form.additionalSetters.map((s) => s.userId), ...form.additionalClosers.map((c) => c.userId)].filter(Boolean)}
                  repTypeFilter={(r) => r.repType === 'setter' || r.repType === 'both'}
                  reps={reps}
                  onChange={(rows) => setForm((f) => ({ ...f, additionalSetters: rows }))}
                  disabled={!form.setterId}
                  disabledReason="Select a primary setter first to add co-setters."
                  onFirstAdd={() => {
                    if (!setterTotal || setterTotal <= 0) return;
                    const m1 = evenSplit(setterM1, 2);
                    const m2 = evenSplit(setterM2, 2);
                    const m3 = evenSplit(setterM3, 2);
                    setForm((f) => ({
                      ...f,
                      additionalSetters: [
                        { userId: '', m1Amount: String(m1[1]), m2Amount: String(m2[1]), m3Amount: m3[1] ? String(m3[1]) : '' },
                      ],
                    }));
                  }}
                />
              </>
            )}

            {/* Fixed CTA bar — Next */}
            <div
              key={`cta-0`}
              className="cta-bar-enter fixed left-0 right-0 z-40 px-6"
              style={{
                bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
                paddingBottom: '12px',
                paddingTop: '12px',
                background: 'linear-gradient(to bottom, transparent 0%, rgba(6,14,26,0.92) 28%, rgba(6,14,26,1) 100%)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <button
                type="button"
                onClick={handleNext}
                disabled={!!exitAnimClass}
                className="w-full flex items-center justify-center gap-2 font-medium active:scale-[0.97]"
                style={{
                  background: 'linear-gradient(135deg, #1de9b6, #00b894)',

                  borderRadius: 16,
                  padding: 18,
                  fontSize: 16,
                  color: '#fff',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                }}
              >
                Next <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Deal Details ── */}
        {currentStep === 1 && (
          <div key={1} className={`space-y-7 flex-1 flex flex-col pb-[176px] ${exitAnimClass || (stepDirectionRef.current === 'fwd' ? 'deal-step-enter-fwd' : 'deal-step-enter-back')}`}>
            {/* Installer */}
            <div>
              <label className={labelCls} style={labelStyle}>Installer</label>
              <select
                value={form.installer}
                onChange={(e) => handleInstallerChange(e.target.value)}
                onBlur={() => handleBlur('installer')}
                className={selectCls('installer')} style={v0InputStyle('installer')}
              >
                <option value="">-- Select installer --</option>
                {activeInstallers.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
              <FieldError errors={errors} field="installer" />
            </div>

            {/* Product Type */}
            {form.installer && (
              <div key={form.installer || 'none'} className="field-slide-in">
                <label className={labelCls} style={labelStyle}>Product Type</label>
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
                          financer: isCash ? 'Cash' : (prev.productType === 'Cash' ? '' : prev.financer),
                          solarTechFamily: '', solarTechProductId: '', pcFamily: '', installerProductId: '', prepaidSubType: '',
                        }));
                        setErrors((prev) => ({ ...prev, productType: '', financer: isCash ? '' : prev.financer }));
                        setTouched((prev) => { const next = new Set(prev); next.add('productType'); return next; });
                      }}
                      className="min-h-[44px] rounded-xl text-base font-medium transition-transform active:scale-[0.97]"
                      style={{
                        background: form.productType === pt ? 'var(--accent-emerald)' : 'var(--m-card, var(--surface-mobile-card))',
                        color: form.productType === pt ? '#000' : 'var(--m-text-muted, var(--text-mobile-muted))',
                        border: form.productType === pt ? 'none' : '1px solid var(--m-border, var(--border-mobile))',
                        fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                        transition: 'background 180ms cubic-bezier(0.34, 1.56, 0.64, 1), border-color 180ms cubic-bezier(0.34, 1.56, 0.64, 1), color 180ms ease, transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                        transform: form.productType === pt ? 'scale(1.04)' : 'scale(1)',
                      }}
                    >
                      {pt}
                    </button>
                  ))}
                </div>
                <FieldError errors={errors} field="productType" />
              </div>
            )}

            {/* Cash indicator */}
            {form.installer && form.productType === 'Cash' && (
              <div className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-base" style={{ background: 'rgba(13,21,37,0.6)', border: '1px solid rgba(26,40,64,0.5)', color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                Cash deal -- no financer required
              </div>
            )}

            {/* ── Installer-specific product/financer flow ── */}
            {form.installer && form.productType && (
              form.installer === 'SolarTech' ? (
                <>
                  {/* SolarTech product family */}
                  <div>
                    <label className={labelCls} style={labelStyle}>Product Family</label>
                    <div className="grid grid-cols-2 gap-2">
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
                            className={`min-h-[44px] px-3 rounded-xl text-base font-medium transition-transform text-left active:scale-[0.97] ${
                              disabled ? 'opacity-50' : ''
                            }`}
                            style={{
                              background: disabled ? 'rgba(13,21,37,0.4)' : selected ? 'rgba(37,99,235,0.2)' : 'rgba(13,21,37,0.6)',
                              border: `1px solid ${disabled ? 'rgba(26,40,64,0.4)' : selected ? 'rgba(59,130,246,0.6)' : 'rgba(26,40,64,0.5)'}`,
                              color: disabled ? 'var(--m-text-muted, var(--text-mobile-muted))' : selected ? '#93c5fd' : 'var(--m-text-muted, var(--text-mobile-muted))',
                              transition: 'background 180ms cubic-bezier(0.34, 1.56, 0.64, 1), border-color 180ms cubic-bezier(0.34, 1.56, 0.64, 1), color 180ms ease, transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                              transform: selected ? 'scale(1.04)' : 'scale(1)',
                            }}
                          >
                            {isPrepaid ? 'Prepaid' : family}
                          </button>
                        );
                      })}
                    </div>
                    {(form.productType === 'Cash' || form.productType === 'Loan') && (
                      <p className="text-base mt-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Only Prepaid family is compatible with {form.productType} deals</p>
                    )}
                    <FieldError errors={errors} field="solarTechFamily" />
                  </div>

                  {/* SolarTech prepaid sub-type */}
                  {getInstallerPrepaidOptions(form.installer).length > 0 && (
                    form.solarTechFamily === 'Cash/HDM/PE' || (form.productType === 'Cash' || form.productType === 'Loan')
                  ) && (
                    <div>
                      <label className={labelCls} style={labelStyle}>Prepaid Type</label>
                      <div className="grid grid-cols-2 gap-2">
                        {getInstallerPrepaidOptions(form.installer).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => { update('prepaidSubType', opt); setTouched((prev) => { const next = new Set(prev); next.add('prepaidSubType'); return next; }); }}
                            className="min-h-[44px] rounded-xl text-base font-medium transition-transform active:scale-[0.97]"
                            style={{
                              background: form.prepaidSubType === opt ? 'rgba(124,58,237,0.2)' : 'rgba(13,21,37,0.6)',
                              border: `1px solid ${form.prepaidSubType === opt ? 'rgba(139,92,246,0.6)' : 'rgba(26,40,64,0.5)'}`,
                              color: form.prepaidSubType === opt ? '#c4b5fd' : 'var(--m-text-muted, var(--text-mobile-muted))',
                              transition: 'background 180ms cubic-bezier(0.34, 1.56, 0.64, 1), border-color 180ms cubic-bezier(0.34, 1.56, 0.64, 1), color 180ms ease, transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                              transform: form.prepaidSubType === opt ? 'scale(1.04)' : 'scale(1)',
                            }}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SolarTech financer (hidden for Cash) */}
                  {form.productType !== 'Cash' && (
                    <div key={'financer-' + form.productType} className="field-slide-in">
                      <label className={labelCls} style={labelStyle}>Financer</label>
                      <select
                        value={form.financer}
                        onChange={(e) => handleFinancerChange(e.target.value)}
                        onBlur={() => handleBlur('financer')}
                        className={selectCls('financer')} style={v0InputStyle('financer')}
                      >
                        <option value="">-- Select financer --</option>
                        {activeFinancers.filter((f) => f !== 'Cash').map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      {(() => {
                        const rawMappedFinancer = SOLARTECH_FAMILY_FINANCER[form.solarTechFamily] ?? '';
                        const hasFamilyMap = !!rawMappedFinancer && form.productType !== 'Loan';
                        const mappedIsArchived = hasFamilyMap && !activeFinancers.includes(rawMappedFinancer);
                        return mappedIsArchived ? (
                          <p className="mt-1 text-sm text-yellow-400">
                            The designated financer for this family (&quot;{rawMappedFinancer}&quot;) has been archived — select an alternative below.
                          </p>
                        ) : null;
                      })()}
                      <FieldError errors={errors} field="financer" />
                    </div>
                  )}

                  {/* SolarTech equipment package */}
                  {hasSolarTechProducts && (
                    <div key={'equip-' + form.solarTechFamily} className="field-slide-in">
                      <label className={labelCls} style={labelStyle}>Equipment Package</label>
                      <select
                        value={form.solarTechProductId}
                        onChange={(e) => update('solarTechProductId', e.target.value)}
                        onBlur={() => handleBlur('solarTechProductId')}
                        className={selectCls('solarTechProductId')} style={v0InputStyle('solarTechProductId')}
                      >
                        <option value="">-- Select package --</option>
                        {solarTechProducts.filter((p) => p.family === solarTechFamily).map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <FieldError errors={errors} field="solarTechProductId" />
                    </div>
                  )}
                </>
              ) : isPcInstaller ? (
                <>
                  {/* Product Catalog family */}
                  <div>
                    <label className={labelCls} style={labelStyle}>Product Family</label>
                    <div className="grid grid-cols-2 gap-2">
                      {(() => {
                        const cashOrLoan = form.productType === 'Cash' || form.productType === 'Loan';
                        const hasPrepaidConfig = !!pcConfig.prepaidFamily;
                        return pcConfig.families.map((family: string) => {
                          const selected = form.pcFamily === family;
                          const isPrepaidFamily = pcConfig.prepaidFamily === family;
                          const disabled = cashOrLoan && hasPrepaidConfig && !isPrepaidFamily;
                          return (
                            <button
                              key={family}
                              type="button"
                              disabled={disabled}
                              onClick={() => !disabled && handlePcFamilyChange(family)}
                              className={`min-h-[44px] px-3 rounded-xl text-base font-medium transition-transform text-left active:scale-[0.97] ${
                                disabled ? 'opacity-50' : ''
                              }`}
                              style={{
                                background: disabled ? 'rgba(13,21,37,0.4)' : selected ? 'rgba(37,99,235,0.2)' : 'rgba(13,21,37,0.6)',
                                border: `1px solid ${disabled ? 'rgba(26,40,64,0.4)' : selected ? 'rgba(59,130,246,0.6)' : 'rgba(26,40,64,0.5)'}`,
                                color: disabled ? 'var(--m-text-muted, var(--text-mobile-muted))' : selected ? '#93c5fd' : 'var(--m-text-muted, var(--text-mobile-muted))',
                                transition: 'background 180ms cubic-bezier(0.34, 1.56, 0.64, 1), border-color 180ms cubic-bezier(0.34, 1.56, 0.64, 1), color 180ms ease, transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                                transform: selected ? 'scale(1.04)' : 'scale(1)',
                              }}
                            >
                              {family}
                            </button>
                          );
                        });
                      })()}
                    </div>
                    {(form.productType === 'Cash' || form.productType === 'Loan') && pcConfig.prepaidFamily && (
                      <p className="text-base mt-1" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Only {pcConfig.prepaidFamily} family is compatible with {form.productType} deals</p>
                    )}
                    <FieldError errors={errors} field="pcFamily" />
                  </div>

                  {/* PC prepaid sub-type */}
                  {getInstallerPrepaidOptions(form.installer).length > 0 && (
                    (form.productType === 'Cash' || form.productType === 'Loan') ||
                    (pcConfig.prepaidFamily && form.pcFamily === pcConfig.prepaidFamily)
                  ) && (
                    <div>
                      <label className={labelCls} style={labelStyle}>Prepaid Type</label>
                      <div className="grid grid-cols-2 gap-2">
                        {getInstallerPrepaidOptions(form.installer).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => { update('prepaidSubType', opt); setTouched((prev) => { const next = new Set(prev); next.add('prepaidSubType'); return next; }); }}
                            className="min-h-[44px] rounded-xl text-base font-medium transition-transform active:scale-[0.97]"
                            style={{
                              background: form.prepaidSubType === opt ? 'rgba(124,58,237,0.2)' : 'rgba(13,21,37,0.6)',
                              border: `1px solid ${form.prepaidSubType === opt ? 'rgba(139,92,246,0.6)' : 'rgba(26,40,64,0.5)'}`,
                              color: form.prepaidSubType === opt ? '#c4b5fd' : 'var(--m-text-muted, var(--text-mobile-muted))',
                              transition: 'background 180ms cubic-bezier(0.34, 1.56, 0.64, 1), border-color 180ms cubic-bezier(0.34, 1.56, 0.64, 1), color 180ms ease, transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                              transform: form.prepaidSubType === opt ? 'scale(1.04)' : 'scale(1)',
                            }}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* PC financer (hidden for Cash) */}
                  {form.productType !== 'Cash' && (
                    <div key={'financer-' + form.productType} className="field-slide-in">
                      <label className={labelCls} style={labelStyle}>Financer</label>
                      <select
                        value={form.financer}
                        onChange={(e) => handleFinancerChange(e.target.value)}
                        onBlur={() => handleBlur('financer')}
                        className={selectCls('financer')} style={v0InputStyle('financer')}
                      >
                        <option value="">-- Select financer --</option>
                        {(pcConfig?.familyFinancerMap?.[form.pcFamily] && activeFinancers.includes(pcConfig.familyFinancerMap[form.pcFamily]) && form.productType !== 'Loan'
                          ? activeFinancers.filter((f) => f === pcConfig!.familyFinancerMap![form.pcFamily])
                          : activeFinancers
                        ).filter((f) => f !== 'Cash').map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <FieldError errors={errors} field="financer" />
                    </div>
                  )}

                  {/* PC equipment package */}
                  {hasPcProducts && (
                    <div>
                      <label className={labelCls} style={labelStyle}>Equipment Package</label>
                      <select
                        value={form.installerProductId}
                        onChange={(e) => update('installerProductId', e.target.value)}
                        onBlur={() => handleBlur('installerProductId')}
                        className={selectCls('installerProductId')} style={v0InputStyle('installerProductId')}
                      >
                        <option value="">-- Select package --</option>
                        {productCatalogProducts.filter((p) => p.installer === form.installer && p.family === pcFamily).map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <FieldError errors={errors} field="installerProductId" />
                    </div>
                  )}
                </>
              ) : (
                <>
                  {/* Standard installer financer (hidden for Cash) */}
                  {form.productType !== 'Cash' && (
                    <div key={'financer-' + form.productType} className="field-slide-in">
                      <label className={labelCls} style={labelStyle}>Financer</label>
                      <select
                        value={form.financer}
                        onChange={(e) => handleFinancerChange(e.target.value)}
                        onBlur={() => handleBlur('financer')}
                        className={selectCls('financer')} style={v0InputStyle('financer')}
                      >
                        <option value="">-- Select financer --</option>
                        {activeFinancers.filter((f) => f !== 'Cash').map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <FieldError errors={errors} field="financer" />
                    </div>
                  )}

                  {/* Standard installer prepaid sub-type (Cash/Loan only) */}
                  {getInstallerPrepaidOptions(form.installer).length > 0 && (form.productType === 'Cash' || form.productType === 'Loan') && (
                    <div>
                      <label className={labelCls} style={labelStyle}>Prepaid Type</label>
                      <div className="grid grid-cols-2 gap-2">
                        {getInstallerPrepaidOptions(form.installer).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => { update('prepaidSubType', opt); setTouched((prev) => { const next = new Set(prev); next.add('prepaidSubType'); return next; }); }}
                            className="min-h-[44px] rounded-xl text-base font-medium transition-transform active:scale-[0.97]"
                            style={{
                              background: form.prepaidSubType === opt ? 'rgba(124,58,237,0.2)' : 'rgba(13,21,37,0.6)',
                              border: `1px solid ${form.prepaidSubType === opt ? 'rgba(139,92,246,0.6)' : 'rgba(26,40,64,0.5)'}`,
                              color: form.prepaidSubType === opt ? '#c4b5fd' : 'var(--m-text-muted, var(--text-mobile-muted))',
                              transition: 'background 180ms cubic-bezier(0.34, 1.56, 0.64, 1), border-color 180ms cubic-bezier(0.34, 1.56, 0.64, 1), color 180ms ease, transform 120ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                              transform: form.prepaidSubType === opt ? 'scale(1.04)' : 'scale(1)',
                            }}
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

            {/* System Size */}
            <div>
              <label className={labelCls} style={labelStyle}>System Size (kW)</label>
              <input
                ref={kWSizeRef}
                type="number"
                inputMode="decimal"
                enterKeyHint="next"
                step="0.1"
                min="0.1"
                placeholder="8.4"
                value={form.kWSize}
                onChange={(e) => update('kWSize', e.target.value)}
                onBlur={() => handleBlur('kWSize')}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); netPPWRef.current?.focus(); } }}
                className={inputCls('kWSize')} style={v0InputStyle('kWSize')}
              />
              <FieldError errors={errors} field="kWSize" />
            </div>

            {/* Net PPW */}
            <div>
              <label className={labelCls} style={labelStyle}>Net PPW ($/W)</label>
              <input
                ref={netPPWRef}
                type="number"
                inputMode="decimal"
                enterKeyHint="done"
                step="0.01"
                min="0.01"
                placeholder="3.45"
                value={form.netPPW}
                onChange={(e) => update('netPPW', e.target.value)}
                onBlur={() => handleBlur('netPPW')}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); netPPWRef.current?.blur(); handleNext(); } }}
                className={inputCls('netPPW')} style={netPPWGlowStyle}
              />
              <FieldError errors={errors} field="netPPW" />
              {!errors.netPPW && soldPPW > 0 && closerPerW > 0 && (
                <p className={`text-base mt-1 ${soldPPW >= closerPerW ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {soldPPW >= closerPerW
                    ? `$${Math.abs(soldPPW - closerPerW).toFixed(2)}/W above baseline`
                    : `$${Math.abs(soldPPW - closerPerW).toFixed(2)}/W below baseline -- no commission`}
                </p>
              )}
            </div>

            {/* Divider */}
            {(showPreview || (isSubDealer && subDealerCommission > 0)) && (
              <div className="h-px" style={{ background: 'linear-gradient(to right, transparent, rgba(26,40,64,0.5), transparent)' }} />
            )}

            {/* Commission preview card */}
            {(showPreview || (isSubDealer && subDealerCommission > 0)) && (
              <MobileCard key={showPreview ? 'shown' : 'hidden'} className="field-slide-in">
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Commission Preview</p>
                {isSubDealer ? (
                  <div className="space-y-1.5 text-base">
                    {subDealerRate > 0 && (
                      <div className="flex justify-between text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                        <span>Sub-dealer rate</span>
                        <span>${subDealerRate.toFixed(2)}/W</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>M2 commission</span>
                      <span
                        key={commFlash ? 'flash' : 'idle'}
                        className={`font-black${commFlash ? ' commission-val-flash' : ''}`}
                        style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}
                      >${displayedTotal.toLocaleString()}</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-base">
                    <div className="flex justify-between text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                      <span>Your redline</span>
                      <span>${closerPerW.toFixed(2)}/W</span>
                    </div>
                    {effectiveRole === 'admin' && (
                      <div className="flex justify-between text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                        <span>Kilo baseline</span>
                        <span>${kiloPerW.toFixed(2)}/W</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Closer</span>
                      <span
                        key={commFlash ? 'flash' : 'idle'}
                        className={`font-black${commFlash ? ' commission-val-flash' : ''}`}
                        style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}
                      >${displayedTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                      <span>M1: ${closerM1.toLocaleString()} · M2: ${closerM2.toLocaleString()}{hasM3 ? ` · M3: $${closerM3.toLocaleString()}` : ''}</span>
                    </div>
                    {form.setterId && setterTotal > 0 && (
                      <div className="flex justify-between pt-1.5" style={{ borderTop: '1px solid rgba(26,40,64,0.5)' }}>
                        <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Setter</span>
                        <span className="text-blue-400 font-semibold">${setterTotal.toLocaleString()}</span>
                      </div>
                    )}
                    {trainerRep && trainerTotal > 0 && (
                      <div className="flex justify-between text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                        <span>Trainer ({trainerRep.name})</span>
                        <span className="text-amber-400">${trainerTotal.toLocaleString()}</span>
                      </div>
                    )}
                    {effectiveRole === 'admin' && (
                      <div className="flex justify-between pt-1.5" style={{ borderTop: '1px solid rgba(26,40,64,0.5)' }}>
                        <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Kilo margin</span>
                        <span className="font-semibold" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>${Math.max(0, kiloTotal - closerTotal - setterTotal - trainerTotal).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
              </MobileCard>
            )}

            {/* Fixed CTA bar — Back + Next */}
            <div
              key={`cta-1`}
              className="cta-bar-enter fixed left-0 right-0 z-40 px-6"
              style={{
                bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
                paddingBottom: '12px',
                paddingTop: '12px',
                background: 'linear-gradient(to bottom, transparent 0%, rgba(6,14,26,0.92) 28%, rgba(6,14,26,1) 100%)',
                backdropFilter: 'blur(8px)',
              }}
            >
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handlePrev}
                  className="flex-1 flex items-center justify-center gap-1 font-medium active:scale-[0.97]"
                  style={{
                    background: 'rgba(255,255,255,0.05)',
                    border: '0.5px solid rgba(255,255,255,0.1)',
                    borderRadius: 16,
                    padding: 18,
                    fontSize: 16,
                    color: 'rgba(255,255,255,0.6)',
                  }}
                >
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={!!exitAnimClass}
                  className="flex-1 flex items-center justify-center gap-1 font-medium active:scale-[0.97]"
                  style={{
                    background: 'linear-gradient(135deg, #1de9b6, #00b894)',

                    borderRadius: 16,
                    padding: 18,
                    fontSize: 16,
                    color: '#fff',
                    fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                  }}
                >
                  Next <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Step 3: Review & Notes ── */}
        {currentStep === 2 && (
          <div key={2} className={`space-y-7 flex-1 flex flex-col pb-24 ${exitAnimClass || (stepDirectionRef.current === 'fwd' ? 'deal-step-enter-fwd' : 'deal-step-enter-back')}`}>
            {/* Summary card */}
            <MobileCard>
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Deal Summary</p>
              {/* People section — tap to jump back to Step 1 */}
              <button
                type="button"
                onClick={() => { stepDirectionRef.current = 'back'; setCurrentStep(0); }}
                className="w-full text-left pb-2 rounded-xl active:bg-white/[0.06] transition-all duration-150 active:scale-[0.985] group"
                style={{ borderLeft: '2px solid rgba(29,233,182,0.18)', paddingLeft: '10px' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>People</span>
                  <span className="flex items-center gap-1 opacity-35 group-active:opacity-100 transition-opacity duration-150" style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)' }}><Pencil className="w-3 h-3" />Edit</span>
                </div>
                <div className="space-y-2 text-base">
                  <div className="flex justify-between">
                    <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Customer</span>
                    <span className="text-white font-medium text-right truncate ml-4">{form.customerName || '---'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Sold Date</span>
                    <span className="text-white font-medium">{form.soldDate || '---'}</span>
                  </div>
                  {effectiveRole === 'admin' && (
                    <div className="flex justify-between">
                      <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Closer</span>
                      <span className="text-white font-medium truncate ml-4">{reps.find((r) => r.id === form.repId)?.name || '---'}</span>
                    </div>
                  )}
                  {form.setterId && (
                    <div className="flex justify-between">
                      <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Setter</span>
                      <span className="text-white font-medium truncate ml-4">{reps.find((r) => r.id === form.setterId)?.name || '---'}</span>
                    </div>
                  )}
                </div>
              </button>
              {/* Deal Details section — tap to jump back to Step 2 */}
              <button
                type="button"
                onClick={() => { stepDirectionRef.current = 'back'; setCurrentStep(1); }}
                className="w-full text-left pt-2 mt-2 rounded-xl active:bg-white/[0.06] transition-all duration-150 active:scale-[0.985] group"
                style={{ borderTop: '1px solid rgba(26,40,64,0.5)', borderLeft: '2px solid rgba(29,233,182,0.18)', paddingLeft: '10px', paddingTop: '8px', marginTop: '8px' }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Deal Details</span>
                  <span className="flex items-center gap-1 opacity-35 group-active:opacity-100 transition-opacity duration-150" style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.3)' }}><Pencil className="w-3 h-3" />Edit</span>
                </div>
                <div className="space-y-2 text-base">
                  <div className="flex justify-between">
                    <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Installer</span>
                    <span className="text-white font-medium">{form.installer || '---'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Financer</span>
                    <span className="text-white font-medium">{form.financer || '---'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Product Type</span>
                    <span className="text-white font-medium">{form.productType || '---'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>System</span>
                    <span className="text-white font-medium">
                      {kW > 0 ? `${kW.toFixed(1)} kW` : '---'}
                      {kW > 0 && soldPPW > 0 && ` @ $${soldPPW.toFixed(2)}/W`}
                    </span>
                  </div>
                  {form.prepaidSubType && (
                    <div className="flex justify-between">
                      <span className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Prepaid Type</span>
                      <span className="text-white font-medium">{form.prepaidSubType}</span>
                    </div>
                  )}
                </div>
              </button>
            </MobileCard>

            {/* Commission breakdown */}
            {(showPreview || (isSubDealer && subDealerCommission > 0)) && (
              <MobileCard className="field-slide-in" key={closerTotal + '-' + setterTotal}>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Commission Breakdown</p>
                {isSubDealer ? (
                  <div className="space-y-1.5 text-base">
                    <div className="flex justify-between">
                      <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>M2 commission</span>
                      <span
                        key={commFlash ? 'flash' : 'idle'}
                        className={`font-black text-lg${commFlash ? ' commission-val-flash' : ''}`}
                        style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}
                      >${subDealerCommission.toLocaleString()}</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-base">
                    <div className="flex justify-between items-center">
                      <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Closer total</span>
                      <span
                        key={commFlash ? 'flash' : 'idle'}
                        className={`font-black text-lg${commFlash ? ' commission-val-flash' : ''}`}
                        style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}
                      >${closerTotal.toLocaleString()}</span>
                    </div>
                    <div className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                      M1: ${closerM1.toLocaleString()} · M2: ${closerM2.toLocaleString()}{hasM3 ? ` · M3: $${closerM3.toLocaleString()}` : ''}
                    </div>
                    {form.setterId && setterTotal > 0 && (
                      <>
                        <div className="flex justify-between pt-1.5" style={{ borderTop: '1px solid rgba(26,40,64,0.5)' }}>
                          <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Setter total</span>
                          <span className="text-blue-400 font-semibold">${setterTotal.toLocaleString()}</span>
                        </div>
                        <div className="text-base" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                          M1: ${setterM1.toLocaleString()} · M2: ${setterM2.toLocaleString()}{hasM3 ? ` · M3: $${setterM3.toLocaleString()}` : ''}
                        </div>
                      </>
                    )}
                    {trainerRep && trainerTotal > 0 && (
                      <div className="flex justify-between pt-1.5 text-base" style={{ borderTop: '1px solid rgba(26,40,64,0.5)' }}>
                        <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Trainer ({trainerRep.name})</span>
                        <span className="text-amber-400">${trainerTotal.toLocaleString()} (${trainerOverrideRate.toFixed(2)}/W)</span>
                      </div>
                    )}
                    {effectiveRole === 'admin' && (
                      <div className="flex justify-between pt-1.5" style={{ borderTop: '1px solid rgba(26,40,64,0.5)' }}>
                        <span style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Kilo margin</span>
                        <span className="font-semibold" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>${Math.max(0, kiloTotal - closerTotal - setterTotal - trainerTotal).toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
              </MobileCard>
            )}

            {/* Divider */}
            <div className="h-px" style={{ background: 'linear-gradient(to right, transparent, rgba(26,40,64,0.5), transparent)' }} />

            {/* Notes */}
            <div>
              <label className={labelCls} style={labelStyle}>Notes <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.07)', borderRadius: 6, padding: '2px 7px', marginLeft: 4 }}>optional</span></label>
              <textarea
                placeholder="Add any notes about this deal..."
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
                className={`${inputCls('')} min-h-[80px] max-h-[160px] resize-none py-2.5`} style={v0InputStyle('')}
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-base italic" style={{ color: 'var(--m-text-muted, var(--text-mobile-muted))' }}>Internal notes only</p>
                <p className="text-base" style={{ color: form.notes.length >= 500 ? '#f87171' : form.notes.length >= 400 ? '#fbbf24' : 'var(--m-text-muted, var(--text-mobile-muted))' }}>
                  {form.notes.length}/500
                </p>
              </div>
            </div>

            {/* Lead Source */}
            <div>
              <label className={labelCls} style={labelStyle}>Lead Source <span style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.07)', borderRadius: 6, padding: '2px 7px', marginLeft: 4 }}>optional</span></label>
              <select
                value={form.leadSource}
                onChange={(e) => {
                  const val = e.target.value;
                  update('leadSource', val);
                  if (val !== 'blitz') update('blitzId', '');
                }}
                className={selectCls('')} style={v0InputStyle('')}
              >
                <option value="">-- Select --</option>
                <option value="organic">Organic</option>
                <option value="referral">Referral</option>
                <option value="blitz">Blitz</option>
                <option value="door_knock">Door Knock</option>
                <option value="web">Web Lead</option>
                <option value="other">Other</option>
              </select>
            </div>

            {/* Blitz selector */}
            {form.leadSource === 'blitz' && (
              <div key={'blitz-sel'} className="field-slide-in">
                <label className={labelCls} style={labelStyle}>Blitz</label>
                <select
                  value={form.blitzId}
                  onChange={(e) => {
                    const blitzId = e.target.value;
                    update('blitzId', blitzId);
                    if (blitzId) {
                      const blitz = availableBlitzes.find((b) => b.id === blitzId);
                      if (blitz?.startDate && blitz?.endDate) {
                        const today = new Date().toISOString().split('T')[0];
                        if (today >= blitz.startDate && today <= blitz.endDate) {
                          update('soldDate', today);
                        } else if (today < blitz.startDate) {
                          update('soldDate', blitz.startDate);
                        } else {
                          update('soldDate', blitz.endDate);
                        }
                      }
                    }
                  }}
                  className={selectCls('')} style={v0InputStyle('')}
                >
                  <option value="">-- Select Blitz --</option>
                  {availableBlitzes.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Spacer to push buttons to bottom */}
            <div className="flex-1" />

            {/* Back + Submit buttons */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handlePrev}
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-1 font-medium active:scale-[0.97] disabled:opacity-60"
                style={{
                  background: 'rgba(255,255,255,0.05)',
                  border: '0.5px solid rgba(255,255,255,0.1)',
                  borderRadius: 16,
                  padding: 18,
                  fontSize: 16,
                  color: 'rgba(255,255,255,0.6)',
                }}
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="flex-1 flex items-center justify-center gap-2 font-medium active:scale-[0.97] disabled:opacity-60"
                style={{
                  background: 'linear-gradient(135deg, #1de9b6, #00b894)',

                  borderRadius: 16,
                  padding: 18,
                  fontSize: 16,
                  color: '#fff',
                  fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)",
                }}
              >
                {submitting ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Submitting...</>
                ) : (
                  <><Check className="w-4 h-4" /> Submit Deal</>
                )}
              </button>
            </div>
          </div>
        )}
      </form>

      {/* Floating commission pill — slides up from nav when preview unlocks on Step 2 */}
      {pillMount && (
        <div
          className="fixed left-4 right-4 z-50 rounded-2xl flex items-center justify-between px-5 py-3.5"
          style={{
            bottom: 'calc(72px + env(safe-area-inset-bottom, 0px))',
            background: 'linear-gradient(135deg, rgba(0,229,160,0.12), rgba(0,180,216,0.08))',
            border: '1px solid rgba(0,229,160,0.25)',
            backdropFilter: 'blur(12px)',
            animation: 'comm-pill-enter 350ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
          }}
        >
          <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.5)', fontFamily: "var(--m-font-body, 'DM Sans', sans-serif)" }}>Your Commission</span>
          <span
            key={commFlash ? 'flash' : 'idle'}
            className={`text-xl font-black${commFlash ? ' commission-val-flash' : ''}`}
            style={{ color: 'var(--m-accent, var(--accent-emerald))', fontFamily: "var(--m-font-display, 'DM Serif Display', serif)" }}
          >${displayedTotal.toLocaleString()}</span>
        </div>
      )}
    </div>
  );
}
