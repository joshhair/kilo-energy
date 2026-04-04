'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import {
  PRODUCT_TYPES, Project,
  getTrainerOverrideRate, calculateCommission,
  SOLARTECH_FAMILIES, SOLARTECH_PRODUCTS,
  getSolarTechBaseline, getInstallerRatesForDeal, getProductCatalogBaselineVersioned,
  INSTALLER_PAY_CONFIGS, DEFAULT_INSTALL_PAY_PCT,
} from '../../../lib/data';
import { Check, Loader2, ChevronLeft, ChevronRight, CheckCircle2, ArrowRight, RotateCcw } from 'lucide-react';
import { SetterPickerPopover } from '../components/SetterPickerPopover';
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

// ── Inline components ────────────────────────────────────────────────────────

function FieldError({ field, errors }: { field: string; errors: Record<string, string> }) {
  return errors[field] ? (
    <p className="text-red-400 text-xs mt-1" role="alert">{errors[field]}</p>
  ) : null;
}

// ── Step indicator ───────────────────────────────────────────────────────────

const DEAL_STEPS = ['People', 'Deal Details', 'Review & Notes'] as const;

function StepIndicator({ currentStep }: { currentStep: number }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="flex items-center gap-1.5">
        {DEAL_STEPS.map((_, idx) => (
          <div
            key={idx}
            className={`rounded-full transition-all ${
              idx < currentStep
                ? 'w-2.5 h-2.5 bg-emerald-500'
                : idx === currentStep
                ? 'w-2.5 h-2.5 bg-blue-500 ring-2 ring-blue-500/30'
                : 'w-2 h-2 bg-slate-700'
            }`}
          />
        ))}
      </div>
      <span className="text-xs text-slate-400 font-medium">
        Step {currentStep + 1} of {DEAL_STEPS.length} — {DEAL_STEPS[currentStep]}
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
        <div className="w-14 h-14 rounded-full bg-green-500/10 border border-green-500/30 flex items-center justify-center mb-3">
          <CheckCircle2 className="w-7 h-7 text-green-400" strokeWidth={1.5} />
        </div>
        <h2 className="text-xl font-black text-white mb-1">Deal Submitted!</h2>
        <p className="text-slate-400 text-sm">
          <span className="text-white font-semibold">{deal.customerName}</span> has been added to your pipeline.
        </p>
      </div>

      <MobileCard>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Deal Summary</p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500 text-xs">Installer</span>
            <span className="text-white font-medium">{deal.installer}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 text-xs">Financer</span>
            <span className="text-white font-medium">{deal.financer || '---'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 text-xs">Product Type</span>
            <span className="text-white font-medium">{deal.productType}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 text-xs">System</span>
            <span className="text-white font-medium">{deal.kW.toFixed(1)} kW @ ${deal.soldPPW.toFixed(2)}/W</span>
          </div>
        </div>
      </MobileCard>

      <MobileCard>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Commission</p>
        {deal.closerTotal > 0 ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-300 text-sm font-medium">{deal.repName} (Closer)</p>
              <p className="text-slate-500 text-xs">
                M1: ${deal.closerM1.toLocaleString()} · M2: ${deal.closerM2.toLocaleString()}
                {deal.closerM3 > 0 && ` · M3: $${deal.closerM3.toLocaleString()}`}
              </p>
            </div>
            <p className="text-xl font-black text-green-400">${deal.closerTotal.toLocaleString()}</p>
          </div>
        ) : (
          <p className="text-slate-500 text-sm">Commission will be calculated once pricing is confirmed.</p>
        )}
        {deal.setterTotal > 0 && (
          <div className="flex items-center justify-between border-t border-slate-700 pt-2 mt-2">
            <p className="text-slate-300 text-sm font-medium">{deal.setterName} (Setter)</p>
            <p className="text-lg font-bold text-blue-400">${deal.setterTotal.toLocaleString()}</p>
          </div>
        )}
      </MobileCard>

      <div className="space-y-2 pt-2">
        <button
          onClick={() => router.push('/dashboard/projects')}
          className="w-full min-h-[48px] flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold rounded-xl text-sm active:scale-[0.97]"
        >
          View Projects <ArrowRight className="w-4 h-4" />
        </button>
        <button
          onClick={onReset}
          className="w-full min-h-[48px] flex items-center justify-center gap-2 bg-slate-800 border border-slate-700 text-slate-300 font-medium rounded-xl text-sm active:scale-[0.97]"
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
    dbReady, currentRole, currentRepId, currentRepName,
    addDeal, projects, trainerAssignments,
    activeInstallers, activeFinancers, reps,
    installerPricingVersions, productCatalogInstallerConfigs,
    productCatalogProducts, productCatalogPricingVersions,
    getInstallerPrepaidOptions, installerBaselines,
  } = useApp();
  const { toast } = useToast();
  const router = useRouter();
  const isSubDealer = currentRole === 'sub-dealer';

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

  const [form, setForm] = useState(blankForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<SubmittedDeal | null>(null);
  const [currentStep, setCurrentStep] = useState(0);

  const formRef = useRef<HTMLFormElement>(null);

  // Blitz list
  const [availableBlitzes, setAvailableBlitzes] = useState<Array<{ id: string; name: string; status: string; startDate?: string; endDate?: string }>>([]);
  useEffect(() => {
    fetch('/api/blitzes').then((r) => r.json()).then((data) => {
      setAvailableBlitzes((data ?? []).filter((b: any) => b.status === 'upcoming' || b.status === 'active' || b.status === 'completed'));
    }).catch(() => {});
  }, []);

  // Pre-fill last-used installer
  const lastInstallerApplied = useRef(false);
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
    const value = form[field as keyof typeof form] ?? '';
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
    setForm((prev) => ({ ...prev, solarTechFamily: value, solarTechProductId: '' }));
    setErrors((prev) => ({ ...prev, solarTechFamily: validateField('solarTechFamily', value), solarTechProductId: '' }));
    setTouched((prev) => { const next = new Set(prev); next.add('solarTechFamily'); return next; });
  };

  const handlePcFamilyChange = (value: string) => {
    setForm((prev) => ({ ...prev, pcFamily: value, installerProductId: '' }));
    setErrors((prev) => ({ ...prev, pcFamily: validateField('pcFamily', value), installerProductId: '' }));
    setTouched((prev) => { const next = new Set(prev); next.add('pcFamily'); return next; });
  };

  // ── Derived values (mirrors desktop exactly) ─────────────────────────────

  const closerId = currentRole === 'admin' ? form.repId : (currentRepId ?? '');

  const solarTechFamily = form.installer === 'SolarTech' ? form.solarTechFamily : '';
  const hasSolarTechProducts = solarTechFamily !== '';

  const pcConfig = productCatalogInstallerConfigs[form.installer] ?? null;
  const isPcInstaller = pcConfig !== null;
  const pcFamily = isPcInstaller ? form.pcFamily : '';
  const hasPcProducts = isPcInstaller && pcFamily !== '';

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

  const m1Flat = kW >= 5 ? 1000 : 500;
  const isSelfGen = !form.setterId || setterBaselinePerW === 0;
  const closerM1 = isSelfGen ? m1Flat : 0;
  const closerM2Full = closerTotal - closerM1;
  const setterM1 = isSelfGen ? 0 : m1Flat;
  const setterM2Full = Math.max(0, setterTotal - setterM1);
  const trainerM1 = 0;
  const trainerM2 = trainerTotal;

  const installPayPct = INSTALLER_PAY_CONFIGS[form.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
  const hasM3 = installPayPct < 100;
  const closerM2 = Math.round(closerM2Full * (installPayPct / 100) * 100) / 100;
  const closerM3 = hasM3 ? Math.round(closerM2Full * ((100 - installPayPct) / 100) * 100) / 100 : 0;
  const setterM2 = Math.round(setterM2Full * (installPayPct / 100) * 100) / 100;
  const setterM3 = hasM3 ? Math.round(setterM2Full * ((100 - installPayPct) / 100) * 100) / 100 : 0;

  const showPreview = closerPerW > 0 && kW > 0 && soldPPW > 0;

  // Sub-dealer commission
  const subDealerRate = (() => {
    if (!isSubDealer || !form.installer) return 0;
    const baseline = installerBaselines[form.installer];
    return baseline?.subDealerPerW ?? closerPerW;
  })();
  const subDealerCommission = isSubDealer && kW > 0 && soldPPW > 0 && subDealerRate > 0
    ? calculateCommission(soldPPW, subDealerRate, kW)
    : 0;

  // ── Step validation ───────────────────────────────────────────────────────

  const isCashDeal = form.productType === 'Cash';

  const s1Fields: string[] = [
    ...(currentRole === 'admin' ? ['repId'] : []),
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
      const value = (form as Record<string, string>)[field] ?? '';
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
    if (hasStepErrors) return;
    setCurrentStep((prev) => Math.min(prev + 1, DEAL_STEPS.length - 1));
  };

  const handlePrev = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  // ── Submit (mirrors desktop exactly) ──────────────────────────────────────

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
  };

  // ── Style helpers ─────────────────────────────────────────────────────────

  const inputCls = (field: string) =>
    `w-full min-h-[44px] bg-slate-800/60 border ${errors[field] ? 'border-red-500' : 'border-slate-700/50'} rounded-xl px-3 text-sm text-white shadow-inner shadow-black/10 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/30 transition-colors placeholder-slate-500`;

  const selectCls = (field: string) =>
    `w-full min-h-[44px] bg-slate-800/60 border ${errors[field] ? 'border-red-500' : 'border-slate-700/50'} rounded-xl px-3 text-sm text-white shadow-inner shadow-black/10 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/30 transition-colors`;

  const labelCls = 'text-xs text-slate-500 mb-1 block';

  // ── Render ────────────────────────────────────────────────────────────────

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
    <div className="px-4 pt-3 pb-24 space-y-4">
      <StepIndicator currentStep={currentStep} />

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-4">

        {/* ── Step 1: People ── */}
        {currentStep === 0 && (
          <div className="space-y-4">
            {/* Customer Name */}
            <div>
              <label className={labelCls}>Customer Name</label>
              <input
                type="text"
                placeholder="e.g. John & Jane Smith"
                value={form.customerName}
                onChange={(e) => update('customerName', e.target.value)}
                onBlur={() => handleBlur('customerName')}
                className={inputCls('customerName')}
              />
              <FieldError errors={errors} field="customerName" />
            </div>

            {/* Sold Date */}
            <div>
              <label className={labelCls}>Sold Date</label>
              <input
                type="date"
                value={form.soldDate}
                onChange={(e) => update('soldDate', e.target.value)}
                onBlur={() => handleBlur('soldDate')}
                className={inputCls('soldDate')}
              />
              <FieldError errors={errors} field="soldDate" />
            </div>

            {/* Closer (admin/PM only) */}
            {!isSubDealer && currentRole === 'admin' && (
              <div>
                <label className={labelCls}>Closer (Rep)</label>
                <select
                  value={form.repId}
                  onChange={(e) => update('repId', e.target.value)}
                  onBlur={() => handleBlur('repId')}
                  className={selectCls('repId')}
                >
                  <option value="">-- Select closer --</option>
                  {reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
                <FieldError errors={errors} field="repId" />
              </div>
            )}

            {/* Setter (optional) */}
            {!isSubDealer && (
              <div>
                <label className={labelCls}>Setter <span className="text-slate-600">(optional)</span></label>
                <SetterPickerPopover
                  setterId={form.setterId}
                  onChange={(repId) => update('setterId', repId)}
                  reps={reps}
                  trainerAssignments={trainerAssignments}
                  excludeRepId={closerId || undefined}
                />
                {setterAssignment && trainerRep && (
                  <p className="text-xs text-amber-400 mt-1">
                    Trainer: {trainerRep.name} -- ${trainerOverrideRate.toFixed(2)}/W
                  </p>
                )}
              </div>
            )}

            {/* Divider */}
            <div className="h-px bg-gradient-to-r from-transparent via-slate-700/50 to-transparent" />

            {/* Next */}
            <button
              type="button"
              onClick={handleNext}
              className="w-full min-h-[48px] flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold rounded-xl text-sm active:scale-[0.97]"
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Step 2: Deal Details ── */}
        {currentStep === 1 && (
          <div className="space-y-4">
            {/* Installer */}
            <div>
              <label className={labelCls}>Installer</label>
              <select
                value={form.installer}
                onChange={(e) => handleInstallerChange(e.target.value)}
                onBlur={() => handleBlur('installer')}
                className={selectCls('installer')}
              >
                <option value="">-- Select installer --</option>
                {activeInstallers.map((i) => <option key={i} value={i}>{i}</option>)}
              </select>
              <FieldError errors={errors} field="installer" />
            </div>

            {/* Product Type */}
            {form.installer && (
              <div>
                <label className={labelCls}>Product Type</label>
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
                      className={`min-h-[44px] rounded-xl text-sm font-medium border transition-all ${
                        form.productType === pt
                          ? 'bg-blue-600 border-blue-500 text-white'
                          : 'bg-slate-800/60 border-slate-700/50 text-slate-400'
                      }`}
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
              <div className="flex items-center gap-2 bg-slate-800/60 border border-slate-700/50 rounded-xl px-3 py-2.5 text-sm text-slate-300">
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
                    <label className={labelCls}>Product Family</label>
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
                            className={`min-h-[44px] px-3 rounded-xl text-sm font-medium border transition-all text-left ${
                              disabled
                                ? 'bg-slate-800/40 border-slate-700/40 text-slate-600 opacity-50'
                                : selected
                                  ? 'bg-blue-600/20 border-blue-500/60 text-blue-300'
                                  : 'bg-slate-800/60 border-slate-700/50 text-slate-400'
                            }`}
                          >
                            {isPrepaid ? 'Prepaid' : family}
                          </button>
                        );
                      })}
                    </div>
                    {(form.productType === 'Cash' || form.productType === 'Loan') && (
                      <p className="text-xs text-slate-500 mt-1">Only Prepaid family is compatible with {form.productType} deals</p>
                    )}
                    <FieldError errors={errors} field="solarTechFamily" />
                  </div>

                  {/* SolarTech prepaid sub-type */}
                  {getInstallerPrepaidOptions(form.installer).length > 0 && (
                    form.solarTechFamily === 'Cash/HDM/PE' || (form.productType === 'Cash' || form.productType === 'Loan')
                  ) && (
                    <div>
                      <label className={labelCls}>Prepaid Type</label>
                      <div className="grid grid-cols-2 gap-2">
                        {getInstallerPrepaidOptions(form.installer).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => { update('prepaidSubType', opt); setTouched((prev) => { const next = new Set(prev); next.add('prepaidSubType'); return next; }); }}
                            className={`min-h-[44px] rounded-xl text-sm font-medium border transition-all ${
                              form.prepaidSubType === opt
                                ? 'bg-violet-600/20 border-violet-500/60 text-violet-300'
                                : 'bg-slate-800/60 border-slate-700/50 text-slate-400'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* SolarTech financer (hidden for Cash) */}
                  {form.productType !== 'Cash' && (
                    <div>
                      <label className={labelCls}>Financer</label>
                      <select
                        value={form.financer}
                        onChange={(e) => handleFinancerChange(e.target.value)}
                        onBlur={() => handleBlur('financer')}
                        className={selectCls('financer')}
                      >
                        <option value="">-- Select financer --</option>
                        {activeFinancers.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <FieldError errors={errors} field="financer" />
                    </div>
                  )}

                  {/* SolarTech equipment package */}
                  {hasSolarTechProducts && (
                    <div>
                      <label className={labelCls}>Equipment Package</label>
                      <select
                        value={form.solarTechProductId}
                        onChange={(e) => update('solarTechProductId', e.target.value)}
                        onBlur={() => handleBlur('solarTechProductId')}
                        className={selectCls('solarTechProductId')}
                      >
                        <option value="">-- Select package --</option>
                        {SOLARTECH_PRODUCTS.filter((p) => p.family === solarTechFamily).map((p) => (
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
                    <label className={labelCls}>Product Family</label>
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
                              className={`min-h-[44px] px-3 rounded-xl text-sm font-medium border transition-all text-left ${
                                disabled
                                  ? 'bg-slate-800/40 border-slate-700/40 text-slate-600 opacity-50'
                                  : selected
                                    ? 'bg-blue-600/20 border-blue-500/60 text-blue-300'
                                    : 'bg-slate-800/60 border-slate-700/50 text-slate-400'
                              }`}
                            >
                              {family}
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

                  {/* PC prepaid sub-type */}
                  {getInstallerPrepaidOptions(form.installer).length > 0 && (
                    (form.productType === 'Cash' || form.productType === 'Loan') ||
                    (pcConfig.prepaidFamily && form.pcFamily === pcConfig.prepaidFamily)
                  ) && (
                    <div>
                      <label className={labelCls}>Prepaid Type</label>
                      <div className="grid grid-cols-2 gap-2">
                        {getInstallerPrepaidOptions(form.installer).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => { update('prepaidSubType', opt); setTouched((prev) => { const next = new Set(prev); next.add('prepaidSubType'); return next; }); }}
                            className={`min-h-[44px] rounded-xl text-sm font-medium border transition-all ${
                              form.prepaidSubType === opt
                                ? 'bg-violet-600/20 border-violet-500/60 text-violet-300'
                                : 'bg-slate-800/60 border-slate-700/50 text-slate-400'
                            }`}
                          >
                            {opt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* PC financer (hidden for Cash) */}
                  {form.productType !== 'Cash' && (
                    <div>
                      <label className={labelCls}>Financer</label>
                      <select
                        value={form.financer}
                        onChange={(e) => handleFinancerChange(e.target.value)}
                        onBlur={() => handleBlur('financer')}
                        className={selectCls('financer')}
                      >
                        <option value="">-- Select financer --</option>
                        {activeFinancers.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <FieldError errors={errors} field="financer" />
                    </div>
                  )}

                  {/* PC equipment package */}
                  {hasPcProducts && (
                    <div>
                      <label className={labelCls}>Equipment Package</label>
                      <select
                        value={form.installerProductId}
                        onChange={(e) => update('installerProductId', e.target.value)}
                        onBlur={() => handleBlur('installerProductId')}
                        className={selectCls('installerProductId')}
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
                    <div>
                      <label className={labelCls}>Financer</label>
                      <select
                        value={form.financer}
                        onChange={(e) => handleFinancerChange(e.target.value)}
                        onBlur={() => handleBlur('financer')}
                        className={selectCls('financer')}
                      >
                        <option value="">-- Select financer --</option>
                        {activeFinancers.map((f) => <option key={f} value={f}>{f}</option>)}
                      </select>
                      <FieldError errors={errors} field="financer" />
                    </div>
                  )}

                  {/* Standard installer prepaid sub-type (Cash/Loan only) */}
                  {getInstallerPrepaidOptions(form.installer).length > 0 && (form.productType === 'Cash' || form.productType === 'Loan') && (
                    <div>
                      <label className={labelCls}>Prepaid Type</label>
                      <div className="grid grid-cols-2 gap-2">
                        {getInstallerPrepaidOptions(form.installer).map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() => { update('prepaidSubType', opt); setTouched((prev) => { const next = new Set(prev); next.add('prepaidSubType'); return next; }); }}
                            className={`min-h-[44px] rounded-xl text-sm font-medium border transition-all ${
                              form.prepaidSubType === opt
                                ? 'bg-violet-600/20 border-violet-500/60 text-violet-300'
                                : 'bg-slate-800/60 border-slate-700/50 text-slate-400'
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

            {/* System Size */}
            <div>
              <label className={labelCls}>System Size (kW)</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                placeholder="8.4"
                value={form.kWSize}
                onChange={(e) => update('kWSize', e.target.value)}
                onBlur={() => handleBlur('kWSize')}
                className={inputCls('kWSize')}
              />
              <FieldError errors={errors} field="kWSize" />
            </div>

            {/* Net PPW */}
            <div>
              <label className={labelCls}>Net PPW ($/W)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="3.45"
                value={form.netPPW}
                onChange={(e) => update('netPPW', e.target.value)}
                onBlur={() => handleBlur('netPPW')}
                className={inputCls('netPPW')}
              />
              <FieldError errors={errors} field="netPPW" />
              {!errors.netPPW && soldPPW > 0 && closerPerW > 0 && (
                <p className={`text-xs mt-1 ${soldPPW >= closerPerW ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {soldPPW >= closerPerW
                    ? `$${Math.abs(soldPPW - closerPerW).toFixed(2)}/W above baseline`
                    : `$${Math.abs(soldPPW - closerPerW).toFixed(2)}/W below baseline -- no commission`}
                </p>
              )}
            </div>

            {/* Divider */}
            {(showPreview || (isSubDealer && subDealerCommission > 0)) && (
              <div className="h-px bg-gradient-to-r from-transparent via-slate-700/50 to-transparent" />
            )}

            {/* Commission preview card */}
            {(showPreview || (isSubDealer && subDealerCommission > 0)) && (
              <MobileCard accent="emerald" className="border-emerald-500/20 shadow-sm shadow-black/20" style={{ boxShadow: 'inset 0 1px 0 rgba(16,185,129,0.1)' }}>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Commission Preview</p>
                {isSubDealer ? (
                  <div className="space-y-1.5 text-sm">
                    {subDealerRate > 0 && (
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Sub-dealer rate</span>
                        <span>${subDealerRate.toFixed(2)}/W</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-slate-400">M2 commission</span>
                      <span className="text-emerald-400 font-black">${subDealerCommission.toLocaleString()}</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>Your redline</span>
                      <span>${closerPerW.toFixed(2)}/W</span>
                    </div>
                    {currentRole === 'admin' && (
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Kilo baseline</span>
                        <span>${kiloPerW.toFixed(2)}/W</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-slate-400">Closer</span>
                      <span className="text-emerald-400 font-black">${closerTotal.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between text-xs text-slate-500">
                      <span>M1: ${closerM1.toLocaleString()} · M2: ${closerM2.toLocaleString()}{hasM3 ? ` · M3: $${closerM3.toLocaleString()}` : ''}</span>
                    </div>
                    {form.setterId && setterTotal > 0 && (
                      <div className="flex justify-between border-t border-slate-700/50 pt-1.5">
                        <span className="text-slate-400">Setter</span>
                        <span className="text-blue-400 font-semibold">${setterTotal.toLocaleString()}</span>
                      </div>
                    )}
                    {trainerRep && trainerTotal > 0 && (
                      <div className="flex justify-between text-xs text-slate-500">
                        <span>Trainer ({trainerRep.name})</span>
                        <span className="text-amber-400">${trainerTotal.toLocaleString()}</span>
                      </div>
                    )}
                    {currentRole === 'admin' && (
                      <div className="flex justify-between border-t border-slate-700/50 pt-1.5">
                        <span className="text-slate-400">Kilo revenue</span>
                        <span className="text-slate-300 font-semibold">${kiloTotal.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
              </MobileCard>
            )}

            {/* Divider */}
            <div className="h-px bg-gradient-to-r from-transparent via-slate-700/50 to-transparent" />

            {/* Back + Next buttons */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handlePrev}
                className="flex-1 min-h-[48px] flex items-center justify-center gap-1 bg-slate-800 border border-slate-700 text-slate-300 font-medium rounded-xl text-sm active:scale-[0.97]"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="flex-1 min-h-[48px] flex items-center justify-center gap-1 bg-blue-600 text-white font-semibold rounded-xl text-sm active:scale-[0.97]"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Review & Notes ── */}
        {currentStep === 2 && (
          <div className="space-y-4">
            {/* Summary card */}
            <MobileCard>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Deal Summary</p>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500 text-xs">Customer</span>
                  <span className="text-white font-medium text-right truncate ml-4">{form.customerName || '---'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 text-xs">Sold Date</span>
                  <span className="text-white font-medium">{form.soldDate || '---'}</span>
                </div>
                {currentRole === 'admin' && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 text-xs">Closer</span>
                    <span className="text-white font-medium truncate ml-4">{reps.find((r) => r.id === form.repId)?.name || '---'}</span>
                  </div>
                )}
                {form.setterId && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 text-xs">Setter</span>
                    <span className="text-white font-medium truncate ml-4">{reps.find((r) => r.id === form.setterId)?.name || '---'}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-slate-500 text-xs">Installer</span>
                  <span className="text-white font-medium">{form.installer || '---'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 text-xs">Financer</span>
                  <span className="text-white font-medium">{form.financer || '---'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 text-xs">Product Type</span>
                  <span className="text-white font-medium">{form.productType || '---'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500 text-xs">System</span>
                  <span className="text-white font-medium">
                    {kW > 0 ? `${kW.toFixed(1)} kW` : '---'}
                    {kW > 0 && soldPPW > 0 && ` @ $${soldPPW.toFixed(2)}/W`}
                  </span>
                </div>
                {form.prepaidSubType && (
                  <div className="flex justify-between">
                    <span className="text-slate-500 text-xs">Prepaid Type</span>
                    <span className="text-white font-medium">{form.prepaidSubType}</span>
                  </div>
                )}
              </div>
            </MobileCard>

            {/* Commission breakdown */}
            {(showPreview || (isSubDealer && subDealerCommission > 0)) && (
              <MobileCard accent="emerald" className="border-emerald-500/20 shadow-sm shadow-black/20" style={{ boxShadow: 'inset 0 1px 0 rgba(16,185,129,0.1)' }}>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Commission Breakdown</p>
                {isSubDealer ? (
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">M2 commission</span>
                      <span className="text-emerald-400 font-black text-lg">${subDealerCommission.toLocaleString()}</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-slate-400">Closer total</span>
                      <span className="text-emerald-400 font-black text-lg">${closerTotal.toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-slate-500">
                      M1: ${closerM1.toLocaleString()} · M2: ${closerM2.toLocaleString()}{hasM3 ? ` · M3: $${closerM3.toLocaleString()}` : ''}
                    </div>
                    {form.setterId && setterTotal > 0 && (
                      <>
                        <div className="flex justify-between border-t border-slate-700/50 pt-1.5">
                          <span className="text-slate-400">Setter total</span>
                          <span className="text-blue-400 font-semibold">${setterTotal.toLocaleString()}</span>
                        </div>
                        <div className="text-xs text-slate-500">
                          M1: ${setterM1.toLocaleString()} · M2: ${setterM2.toLocaleString()}{hasM3 ? ` · M3: $${setterM3.toLocaleString()}` : ''}
                        </div>
                      </>
                    )}
                    {trainerRep && trainerTotal > 0 && (
                      <div className="flex justify-between border-t border-slate-700/50 pt-1.5 text-xs">
                        <span className="text-slate-400">Trainer ({trainerRep.name})</span>
                        <span className="text-amber-400">${trainerTotal.toLocaleString()} (${trainerOverrideRate.toFixed(2)}/W)</span>
                      </div>
                    )}
                    {currentRole === 'admin' && (
                      <div className="flex justify-between border-t border-slate-700/50 pt-1.5">
                        <span className="text-slate-400">Kilo revenue</span>
                        <span className="text-slate-300 font-semibold">${kiloTotal.toLocaleString()}</span>
                      </div>
                    )}
                  </div>
                )}
              </MobileCard>
            )}

            {/* Divider */}
            <div className="h-px bg-gradient-to-r from-transparent via-slate-700/50 to-transparent" />

            {/* Notes */}
            <div>
              <label className={labelCls}>Notes <span className="text-slate-600">(optional)</span></label>
              <textarea
                placeholder="Add any notes about this deal..."
                value={form.notes}
                onChange={(e) => update('notes', e.target.value)}
                className={`${inputCls('')} min-h-[80px] max-h-[160px] resize-none py-2.5`}
              />
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-slate-600 italic">Internal notes only</p>
                <p className={`text-xs ${form.notes.length >= 500 ? 'text-red-400' : form.notes.length >= 400 ? 'text-amber-400' : 'text-slate-500'}`}>
                  {form.notes.length}/500
                </p>
              </div>
            </div>

            {/* Lead Source */}
            <div>
              <label className={labelCls}>Lead Source <span className="text-slate-600">(optional)</span></label>
              <select
                value={form.leadSource}
                onChange={(e) => {
                  const val = e.target.value;
                  update('leadSource', val);
                  if (val !== 'blitz') update('blitzId', '');
                }}
                className={selectCls('')}
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
              <div>
                <label className={labelCls}>Blitz</label>
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
                  className={selectCls('')}
                >
                  <option value="">-- Select Blitz --</option>
                  {availableBlitzes.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Back + Submit buttons */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={handlePrev}
                disabled={submitting}
                className="flex-1 min-h-[48px] flex items-center justify-center gap-1 bg-slate-800 border border-slate-700 text-slate-300 font-medium rounded-xl text-sm active:scale-[0.97] disabled:opacity-60"
              >
                <ChevronLeft className="w-4 h-4" /> Back
              </button>
              <button
                type="submit"
                disabled={submitting}
                className={`flex-1 min-h-[48px] flex items-center justify-center gap-2 bg-emerald-600 text-white font-semibold rounded-xl text-sm active:scale-[0.97] disabled:opacity-60 ${!submitting ? 'shadow-md shadow-emerald-500/20' : ''}`}
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
    </div>
  );
}
