'use client';

import { useState, useEffect, useRef, useMemo, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useIsHydrated, useMediaQuery } from '../../../lib/hooks';
import { useApp } from '../../../lib/context';
import { useToast } from '../../../lib/toast';
import {
  PRODUCT_TYPES, Project,
  getTrainerOverrideRate, calculateCommission, splitCloserSetterPay,
  SOLARTECH_FAMILIES, SOLARTECH_FAMILY_FINANCER,
  getSolarTechBaseline, getInstallerRatesForDeal, getProductCatalogBaselineVersioned,
  INSTALLER_PAY_CONFIGS, DEFAULT_INSTALL_PAY_PCT,
} from '../../../lib/data';
import { Check, Loader2, PlusCircle, RotateCcw } from 'lucide-react';
import { SetterPickerPopover } from '../components/SetterPickerPopover';
import { SearchableSelect } from '../components/SearchableSelect';
import { Breadcrumb } from '../components/Breadcrumb';
import MobileNewDeal from '../mobile/MobileNewDeal';

import { SubmittedDeal, DEAL_STEPS, validateField, genId, FieldError, PpwHint } from './components/shared';
import { CommissionPreview } from './components/CommissionPreview';
import { SuccessScreen } from './components/SuccessScreen';
import { DealEntryPage } from './components/DealEntryPage';
import { NewDealSkeleton } from './components/NewDealSkeleton';

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewDealPageWrapper() {
  return (
    <Suspense>
      <NewDealPage />
    </Suspense>
  );
}

function NewDealPage() {
  const { dbReady, currentRole, currentRepId, currentRepName, addDeal, projects, trainerAssignments, activeInstallers, activeFinancers, reps, installerPricingVersions, productCatalogInstallerConfigs, productCatalogProducts, productCatalogPricingVersions, getInstallerPrepaidOptions, installerBaselines, installerPayConfigs, solarTechProducts } = useApp();
  const { toast } = useToast();
  const router = useRouter();
  useEffect(() => { document.title = 'New Deal | Kilo Energy'; }, []);
  const isHydrated = useIsHydrated();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isSubDealer = currentRole === 'sub-dealer';

  const blankForm = () => ({
    customerName: '',
    soldDate: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })(),
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
  // Synchronous lock — React batches state updates inside the same event
  // tick, so `submitting` (state) still reads false on a rapid double-click.
  // The ref flips immediately and guards against double-submission.
  const submittingRef = useRef(false);

  // Blitz list for lead source attribution
  const [rawBlitzes, setRawBlitzes] = useState<any[]>([]);
  useEffect(() => {
    fetch('/api/blitzes').then((r) => r.ok ? r.json() : Promise.reject(r.status)).then((data) => {
      setRawBlitzes(data ?? []);
    }).catch(() => {
      toast('Failed to load blitz list. Please refresh the page.', 'error');
    });
  }, []);
  const availableBlitzes = useMemo<Array<{ id: string; name: string; status: string; startDate?: string; endDate?: string }>>(() => {
    return rawBlitzes.filter((b: any) => {
      const statusOk = b.status === 'upcoming' || b.status === 'active' || b.status === 'completed';
      if (!statusOk) return false;
      if (currentRole === 'admin') {
        // When a rep is selected, only show blitzes that rep is approved for
        if (form.repId) {
          return b.participants?.some((p: any) => p.userId === form.repId && p.joinStatus === 'approved');
        }
        return true;
      }
      return b.participants?.some((p: any) => p.userId === currentRepId && p.joinStatus === 'approved');
    });
  }, [rawBlitzes, currentRole, currentRepId, form.repId]);

  // ── Duplicate deal pre-fill from query params ─────────────────────────────
  const searchParams = useSearchParams();
  const duplicateApplied = useRef(false);
  const duplicateCustomerName = searchParams.get('duplicate') === 'true' ? (searchParams.get('customerName') ?? '') : '';
  const customerNameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (duplicateApplied.current) return;
    if (searchParams.get('duplicate') !== 'true') return;
    if (!dbReady) return;
    duplicateApplied.current = true;
    const rawInstaller = searchParams.get('installer') ?? '';
    const installer = activeInstallers.includes(rawInstaller) ? rawInstaller : '';
    const rawFinancer = searchParams.get('financer') ?? '';
    const financer = activeFinancers.includes(rawFinancer) ? rawFinancer : '';
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
  }, [searchParams, dbReady, currentRole, currentRepId, activeInstallers, activeFinancers, toast]);

  // ── Pre-fill last-used installer from localStorage ────────────────────────
  const lastInstallerApplied = useRef(false);
  useEffect(() => {
    if (lastInstallerApplied.current) return;
    if (searchParams.get('duplicate') === 'true') return; // duplicate overrides
    if (!dbReady) return; // wait for DB hydration so admin-added installers are present
    lastInstallerApplied.current = true;
    try {
      const lastInstaller = localStorage.getItem('lastInstaller');
      if (lastInstaller && activeInstallers.includes(lastInstaller)) {
        setForm((prev) => prev.installer ? prev : { ...prev, installer: lastInstaller });
      }
    } catch {}
  }, [searchParams, activeInstallers, dbReady]);

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
  const solarTechFamilyProducts = solarTechProducts.filter((p) => p.family === solarTechFamily);
  const hasSolarTechProducts = solarTechFamilyProducts.length > 0;

  // Derived: product catalog installer detection
  const pcConfig = productCatalogInstallerConfigs[form.installer] ?? null;
  const isPcInstaller = pcConfig !== null;
  // For PC installer: family comes from form, not from financer
  const pcFamily = isPcInstaller ? form.pcFamily : '';
  const pcFamilyProducts = isPcInstaller ? productCatalogProducts.filter((p) => p.installer === form.installer && p.family === pcFamily) : [];
  const hasPcProducts = isPcInstaller && pcFamily !== '' && pcFamilyProducts.length > 0;

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
    return <Check className="w-3.5 h-3.5 text-[var(--accent-green)] shrink-0" />;
  };

  const handleInstallerChange = (value: string) => {
    setForm((prev) => ({ ...prev, installer: value, financer: '', productType: '', solarTechFamily: '', solarTechProductId: '', pcFamily: '', installerProductId: '', prepaidSubType: '' }));
    setErrors((prev) => ({ ...prev, installer: validateField('installer', value), financer: '', productType: '', solarTechFamily: '', solarTechProductId: '', pcFamily: '', installerProductId: '' }));
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
    setForm((prev) => ({ ...prev, solarTechFamily: value, solarTechProductId: '', financer: effectiveFinancer, prepaidSubType: '' }));
    const financerCleared = !effectiveFinancer;
    setErrors((prev) => ({ ...prev, solarTechFamily: validateField('solarTechFamily', value), solarTechProductId: '', financer: (touched.has('financer') || financerCleared) ? validateField('financer', effectiveFinancer) : '' }));
    setTouched((prev) => { const next = new Set(prev); next.add('solarTechFamily'); if (financerCleared) next.add('financer'); return next; });
  };

  const handlePcFamilyChange = (value: string) => {
    const rawMappedFinancer = pcConfig?.familyFinancerMap?.[value] ?? '';
    const mappedFinancer = rawMappedFinancer && activeFinancers.includes(rawMappedFinancer) ? rawMappedFinancer : '';
    // Loan deals must not inherit a financer from the family mapping
    const effectiveFinancer = form.productType === 'Loan' ? '' : mappedFinancer;
    setForm((prev) => ({ ...prev, pcFamily: value, installerProductId: '', financer: effectiveFinancer, prepaidSubType: '' }));
    const financerCleared = !effectiveFinancer;
    setErrors((prev) => ({ ...prev, pcFamily: validateField('pcFamily', value), installerProductId: '', financer: (touched.has('financer') || financerCleared) ? validateField('financer', effectiveFinancer) : '' }));
    setTouched((prev) => { const next = new Set(prev); next.add('pcFamily'); if (financerCleared) next.add('financer'); return next; });
  };

  // ── Derived values ─────────────────────────────────────────────────────────

  const closerId = currentRole === 'admin' ? form.repId : (currentRepId ?? '');

  // When a blitz is selected, only approved participants of that blitz may be setters.
  const setterPickerReps = useMemo(() => {
    if (!form.blitzId) return reps.filter((r) => r.active && (r.repType === 'setter' || r.repType === 'both'));
    const selectedBlitz = rawBlitzes.find((b) => b.id === form.blitzId);
    const approvedIds = new Set(
      (selectedBlitz?.participants ?? [])
        .filter((p: any) => p.joinStatus === 'approved')
        .map((p: any) => p.userId as string),
    );
    return reps.filter((r) => r.active && approvedIds.has(r.id) && (r.repType === 'setter' || r.repType === 'both'));
  }, [form.blitzId, rawBlitzes, reps]);

  // Trainer override tier progression counts deals where the FINAL milestone
  // payment has actually been paid out. The "final" milestone depends on
  // the installer's payment model:
  //   installPayPct < 100  → installer pays at Installed AND PTO. Final
  //                          payment is M3 (paid at PTO). Count m3Paid.
  //   installPayPct === 100 → installer pays in full at Installed (no
  //                          M3 leg, e.g. SolarTech). Final payment is
  //                          M2. Count m2Paid.
  // Phase-based counting was wrong on both ends: it credited deals before
  // money flowed (Installed phase) and ignored that some installers skip
  // M3 entirely (would never reach Completed under the agent's restricted
  // logic if admin doesn't manually advance them).
  const isFullyPaidOut = (p: typeof projects[number]): boolean => {
    const pct = (installerPayConfigs ?? INSTALLER_PAY_CONFIGS)[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
    if (pct < 100) {
      return p.m3Paid === true;
    }
    return p.m2Paid === true;
  };

  const setterAssignment = form.setterId ? trainerAssignments.find((a) => a.traineeId === form.setterId) : null;
  const setterCompletedDeals = form.setterId
    ? projects.filter((p) => (p.setterId === form.setterId || p.repId === form.setterId) && isFullyPaidOut(p)).length
    : 0;
  const trainerOverrideRate = setterAssignment ? getTrainerOverrideRate(setterAssignment, setterCompletedDeals) : 0;
  const trainerRep = setterAssignment ? reps.find((r) => r.id === setterAssignment.trainerId) : null;

  const closerAssignment = closerId ? trainerAssignments.find((a) => a.traineeId === closerId) : null;
  const closerCompletedDeals = closerId
    ? projects.filter((p) => (p.repId === closerId || p.setterId === closerId) && isFullyPaidOut(p)).length
    : 0;
  const closerTrainerOverrideRate = closerAssignment ? getTrainerOverrideRate(closerAssignment, closerCompletedDeals) : 0;
  const closerTrainerRep = closerAssignment ? reps.find((r) => r.id === closerAssignment.trainerId) : null;

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
  const closerTrainerTotal = closerAssignment && closerTrainerOverrideRate > 0
    ? Math.round(closerTrainerOverrideRate * kW * 1000 * 100) / 100 : 0;

  const { closerTotal, setterTotal } = (() => {
    if (!form.setterId || setterBaselinePerW === 0) {
      return { closerTotal: calculateCommission(soldPPW, closerPerW, kW), setterTotal: 0 };
    }
    const closerDifferential = soldPPW > closerPerW ? Math.round(Math.max(0, Math.min(setterBaselinePerW - closerPerW, soldPPW - closerPerW)) * kW * 1000 * 100) / 100 : 0;
    const splitPoint = setterBaselinePerW + trainerOverrideRate;
    const aboveSplit = calculateCommission(soldPPW, splitPoint, kW);
    const half = Math.floor(aboveSplit / 2 * 100) / 100;
    return { closerTotal: closerDifferential + half, setterTotal: aboveSplit - half };
  })();

  const kiloTotal = calculateCommission(closerPerW, kiloPerW, kW);

  // M1 is a flat milestone payment: $500 if <5kW, $1000 if ≥5kW (only one M1 per project).
  // It goes to the setter. Closer only receives M1 if self-gen (no setter).
  // Trainers are paid post-installation — M2 stage only, no M1.
  const m1Flat = kW >= 5 ? 1000 : 500;
  const isSelfGen = !form.setterId || setterBaselinePerW === 0;
  const closerM1 = Math.min(isSelfGen ? m1Flat : 0, Math.max(0, closerTotal));
  const closerM2Full = Math.max(0, closerTotal - closerM1);
  const setterM1 = isSelfGen ? 0 : Math.min(m1Flat, Math.max(0, setterTotal));
  const setterM2Full = Math.max(0, setterTotal - setterM1);
  const trainerM1 = 0;
  const trainerM2 = trainerTotal;

  // M2/M3 split based on installer pay config
  const installPayPct = (installerPayConfigs ?? INSTALLER_PAY_CONFIGS)[form.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
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
    if (baseline) return baseline.subDealerPerW ?? 0;
    // Tiered installer: resolve the correct band using the deal's kW
    if (kW <= 0) return 0;
    const soldDate = form.soldDate || new Date().toISOString().split('T')[0];
    const r = getInstallerRatesForDeal(form.installer, soldDate, kW, installerPricingVersions);
    return r.subDealerPerW ?? 0;
  })();
  const subDealerCommission = isSubDealer && kW > 0 && subDealerRate > 0 && subDealerRate > kiloPerW
    ? Math.round((subDealerRate - kiloPerW) * kW * 1000 * 100) / 100
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
  const s3Fields: string[] = [
    ...(form.leadSource === 'blitz' ? ['blitzId'] : []),
  ];

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
  }, [stepsComplete[currentStep], currentStep]);

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
    autoAdvancedSteps.current.add(currentStep);
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
    if (submittingRef.current) return;
    submittingRef.current = true;
    if (!dbReady) {
      toast('Data is still loading, please wait...', 'error');
      submittingRef.current = false;
      return;
    }

    const fieldsToValidate: string[] = [
      'customerName', 'soldDate', 'installer', ...(form.productType === 'Cash' ? [] : ['financer']), 'productType', 'kWSize', 'netPPW',
      ...(currentRole === 'admin' ? ['repId'] : []),
      ...(form.installer === 'SolarTech' ? ['solarTechFamily'] : []),
      ...(form.installer === 'SolarTech' && hasSolarTechProducts ? ['solarTechProductId'] : []),
      ...(isPcInstaller && form.installer !== 'SolarTech' ? ['pcFamily'] : []),
      ...(isPcInstaller && form.installer !== 'SolarTech' && hasPcProducts ? ['installerProductId'] : []),
      ...(form.leadSource === 'blitz' ? ['blitzId'] : []),
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
    if (hasErrors) {
      submittingRef.current = false;
      return;
    }

    setSubmitting(true);

    try {
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
      m1Amount: isSubDealer ? 0 : closerM1,
      m2Paid: false,
      m2Amount: isSubDealer ? subDealerCommission : closerM2,
      m3Amount: isSubDealer ? 0 : closerM3,
      m3Paid: false,
      setterM1Amount: isSubDealer ? 0 : setterM1,
      setterM2Amount: isSubDealer ? 0 : setterM2,
      setterM3Amount: isSubDealer ? 0 : setterM3,
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
    let dealAccepted: boolean;
    if (isSubDealer) {
      // Sub-dealer deals: no M1, M2 = sub-dealer commission, no setter/trainer entries
      dealAccepted = addDeal(newProject, 0, subDealerCommission, 0, 0, 0, 0, undefined);
    } else {
      dealAccepted = addDeal(newProject, closerM1, closerM2, setterM1, setterM2, trainerM1, trainerM2,
        trainerTotal > 0 ? setterAssignment?.trainerId : undefined);
    }

    if (!dealAccepted) {
      setSubmitting(false);
      submittingRef.current = false;
      return;
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
      setterM1: isSubDealer ? 0 : setterM1,
      setterM2: isSubDealer ? 0 : setterM2,
      setterM3: isSubDealer ? 0 : setterM3,
      setterName: setter?.name ?? '',
      repName: rep?.name ?? currentRepName ?? 'You',
    });
    setSubmitting(false);
    submittingRef.current = false;
    } catch (e) {
      setSubmitting(false);
      submittingRef.current = false;
      throw e;
    }
  };

  // ── Style helpers ──────────────────────────────────────────────────────────

  const inputCls = (field: string) =>
    `w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-green)]/50 focus-visible:border-[var(--accent-green)] transition-all duration-200 placeholder-slate-500`;

  const inputFieldStyle = (field: string): React.CSSProperties => ({
    background: 'var(--surface-card)',
    border: `1px solid ${errors[field] ? 'var(--accent-red)' : 'var(--border-subtle)'}`,
    color: 'var(--text-primary)',
    fontFamily: "'DM Sans', sans-serif",
  });

  const selectCls = (field: string) =>
    `w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-green)]/50 focus-visible:border-[var(--accent-green)] transition-all duration-200`;

  const labelCls = 'block text-xs font-medium mb-1.5 uppercase tracking-wider';
  const labelStyle: React.CSSProperties = { color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" };

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
          setCurrentStep(0);
          autoAdvancedSteps.current = new Set();
          userNavigatedBack.current = false;
        }}
      />
    );
  }

  if (view === 'entry') {
    return <DealEntryPage onStart={() => setView('form')} projects={projects} currentRepId={currentRepId} />;
  }

  // Compute month count for the left panel
  const _now = new Date();
  const _today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}-${String(_now.getDate()).padStart(2, '0')}`;
  const _monthPrefix = _today.slice(0, 7);
  const monthCount = currentRepId == null ? 0 : projects.filter((p) => p.soldDate?.startsWith(_monthPrefix) && (p.repId === currentRepId || p.setterId === currentRepId)).length;
  const todayCount = currentRepId == null ? 0 : projects.filter((p) => p.soldDate?.startsWith(_today) && (p.repId === currentRepId || p.setterId === currentRepId)).length;

  return (
    <div className="p-4 md:p-8" style={{ maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 32, alignItems: 'flex-start' }}>

        {/* ── Left panel — 220px ── */}
        <div style={{ flex: '0 0 220px' }}>
          {/* Your Deals card */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, marginBottom: 16 }}>
            <p style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, marginBottom: 16 }}>Your Deals</p>
            <p style={{ fontFamily: "'DM Serif Display',serif", fontSize: 42, color: todayCount > 0 ? 'var(--accent-green)' : 'var(--text-primary)', letterSpacing: '-0.04em', lineHeight: 1, textShadow: todayCount > 0 ? '0 0 20px rgba(0,224,122,0.25)' : 'none' }}>{todayCount}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, marginTop: 6 }}>Today</p>
            <p style={{ fontFamily: "'DM Serif Display',serif", fontSize: 42, color: monthCount > 0 ? 'var(--accent-green)' : 'var(--text-primary)', letterSpacing: '-0.04em', lineHeight: 1, marginTop: 16, textShadow: monthCount > 0 ? '0 0 20px rgba(0,224,122,0.25)' : 'none' }}>{monthCount}</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, marginTop: 6 }}>This Month</p>
          </div>

          {/* Step guide card */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
            <p style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: 700, marginBottom: 16 }}>Steps</p>
            {DEAL_STEPS.map((step, i) => {
              const n = i + 1;
              const done = !!submitted || currentStep > i;
              const active = !submitted && currentStep === i;
              return (
                <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: i < 2 ? 14 : 0 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                    background: done ? 'var(--accent-green)' : active ? 'rgba(0,224,122,0.1)' : 'var(--surface-card)',
                    border: `1.5px solid ${done || active ? 'var(--accent-green)' : 'var(--border-subtle)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 700, color: done ? '#000' : active ? 'var(--accent-green)' : 'var(--text-muted)',
                    boxShadow: active ? '0 0 20px rgba(0,224,122,0.25)' : 'none',
                  }}>
                    {done ? '\u2713' : n}
                  </div>
                  <p style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--text-primary)' : done ? 'var(--accent-green)' : 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif" }}>{step}</p>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right panel — form ── */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Page header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 28 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>{'\u2295'}</div>
            <div>
              <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>New Deal</h1>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13, fontFamily: "'DM Sans',sans-serif", fontWeight: 500, marginTop: 5 }}>Log a closed solar deal and track commissions in seconds.</p>
            </div>
          </div>

      {/* Duplicate info badge */}
      {duplicateCustomerName && (
        <div className="mb-4 flex items-center gap-2 bg-[var(--accent-green)]/10 border border-[var(--accent-green)]/20 rounded-xl px-4 py-2.5">
          <RotateCcw className="w-4 h-4 text-[var(--accent-green)] flex-shrink-0" />
          <p className="text-[var(--accent-cyan)] text-sm">Duplicating from <span className="font-semibold text-white">{duplicateCustomerName}</span></p>
        </div>
      )}

      {/* Form card */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: 32 }}>

        {/* Step indicator (bar style) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
          {DEAL_STEPS.map((s, i) => {
            const done = currentStep > i;
            const active = currentStep === i;
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ height: 3, width: active ? 32 : 20, borderRadius: 99, background: done || active ? 'var(--accent-green)' : 'var(--border)', transition: 'all 0.2s', boxShadow: active ? '0 0 8px rgba(0,224,122,0.5)' : 'none' }} />
                  <span style={{ fontSize: 12, color: active ? 'var(--text-primary)' : done ? 'var(--accent-green)' : 'var(--text-muted)', fontFamily: "'DM Sans',sans-serif", fontWeight: active ? 700 : 400 }}>{s}</span>
                </div>
                {i < DEAL_STEPS.length - 1 && <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>{'\u203A'}</span>}
              </div>
            );
          })}
        </div>

      <form ref={formRef} onSubmit={handleSubmit} noValidate className="space-y-6">

        {/* ── Animated step content wrapper ── */}
        <div key={currentStep} className="animate-page-enter relative z-20">

        {/* ── Section 1: People ── */}
        {currentStep === 0 && (
        <div id="section-people" className="overflow-visible relative z-10">
          <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Sans',sans-serif", marginBottom: 16 }}>Who&apos;s the customer?</p>

          <div className="space-y-4">
            {/* Closer / Setter card — hidden for sub-dealers */}
            {!isSubDealer && (
            <div className="card-surface rounded-2xl p-5 animate-slide-in-scale stagger-1 space-y-4">
              {currentRole === 'admin' && (
                <div className="transition-all duration-200">
                  <label htmlFor="field-repId" className={labelCls} style={labelStyle}>
                    <span className="inline-flex items-center gap-1">Closer (Rep) {fieldCheck('repId')}</span>
                  </label>
                  <select id="field-repId" value={form.repId} onChange={(e) => { update('repId', e.target.value); update('blitzId', ''); }}
                    onBlur={() => handleBlur('repId')} aria-invalid={!!errors.repId} className={selectCls('repId')} style={inputFieldStyle('repId')}>
                    <option value="">— Select closer —</option>
                    {reps.filter((r) => r.repType !== 'setter' && r.id !== form.setterId && r.active).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <FieldError errors={errors} field="repId" />
                </div>
              )}

              <div className="transition-all duration-200">
                <label className={labelCls} style={labelStyle}>
                  Setter <span className="text-[var(--text-dim)] font-normal normal-case">(optional)</span>
                </label>
                <SetterPickerPopover
                  setterId={form.setterId}
                  onChange={(repId) => update('setterId', repId)}
                  reps={setterPickerReps}
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
                <label htmlFor="field-customerName" className={labelCls} style={labelStyle}>
                  <span className="inline-flex items-center gap-1">Customer Name {fieldCheck('customerName')}</span>
                </label>
                <input id="field-customerName" ref={customerNameInputRef} type="text" placeholder="e.g. John & Jane Smith"
                  value={form.customerName} onChange={(e) => update('customerName', e.target.value)}
                  onBlur={() => handleBlur('customerName')} aria-invalid={!!errors.customerName}
                  className={inputCls('customerName')} style={inputFieldStyle('customerName')} />
                <FieldError errors={errors} field="customerName" />
              </div>
              <div className="transition-all duration-200">
                <label htmlFor="field-soldDate" className={labelCls} style={labelStyle}>
                  <span className="inline-flex items-center gap-1">Sold Date {fieldCheck('soldDate')}</span>
                </label>
                <input id="field-soldDate" type="date" value={form.soldDate}
                  onChange={(e) => update('soldDate', e.target.value)} onBlur={() => handleBlur('soldDate')}
                  aria-invalid={!!errors.soldDate} className={inputCls('soldDate')} style={inputFieldStyle('soldDate')} />
                <FieldError errors={errors} field="soldDate" />
              </div>
            </div>
          </div>
        </div>
        )} {/* end currentStep === 0 */}

        {/* ── Section 2: Deal Details ── */}
        {currentStep === 1 && (
        <div id="section-deal" className="overflow-visible">
          <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Sans',sans-serif", marginBottom: 16 }}>System details {form.customerName && <span style={{ color: 'var(--accent-cyan)', fontWeight: 500 }}>for {form.customerName}</span>}</p>

          <div className="space-y-4">
            {/* ── Card 1: Installer / Financer / Product selects ── */}
            <div className="card-surface rounded-2xl p-5 mb-4 animate-slide-in-scale stagger-1 space-y-4 overflow-visible relative z-10">
            {/* Installer */}
            <div className="transition-all duration-200">
              <label htmlFor="field-installer" className={labelCls} style={labelStyle}>
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
                <label className={labelCls} style={labelStyle}>
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
                          financer: isCash ? 'Cash' : '',
                          // Reset family/product selections when product type changes
                          solarTechFamily: '', solarTechProductId: '', pcFamily: '', installerProductId: '', prepaidSubType: '',
                        }));
                        isDirty.current = true;
                        setErrors((prev) => ({ ...prev, productType: '', financer: isCash ? '' : prev.financer }));
                        setTouched((prev) => { const next = new Set(prev); next.add('productType'); return next; });
                      }}
                      className={`py-2.5 rounded-xl text-sm font-medium border transition-all ${
                        form.productType === pt
                          ? 'bg-[var(--accent-green)] border-[var(--accent-green)] text-white shadow-[0_0_10px_rgba(37,99,235,0.3)]'
                          : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-white'
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
              <div className="flex items-center gap-2 bg-[var(--surface-card)]/60 border border-[var(--border)]/50 rounded-xl px-4 py-2.5 text-sm text-[var(--text-secondary)]">
                <Check className="w-3.5 h-3.5 text-[var(--accent-green)]" />
                Cash deal — no financer required
              </div>
            )}

            {/* Financing — shown once product type is selected */}
            {form.installer && form.productType && (
              form.installer === 'SolarTech' ? (
                <>
                  {/* SolarTech: product family picker */}
                  <div className="transition-all duration-200">
                    <label className={labelCls} style={labelStyle}>
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
                                ? 'bg-[var(--surface-card)]/40 border-[var(--border)]/40 text-[var(--text-dim)] cursor-not-allowed opacity-50'
                                : selected
                                  ? 'bg-[var(--accent-green)]/20 border-[var(--accent-green)]/60 text-[var(--accent-cyan)] shadow-[0_0_12px_rgba(37,99,235,0.2)]'
                                  : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-white'
                            }`}
                          >
                            <span className={`text-xs font-semibold ${disabled ? 'text-[var(--text-dim)]' : selected ? 'text-[var(--accent-green)]' : 'text-[var(--text-muted)]'}`}>
                              {isPrepaid ? 'Prepaid' : family}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                    {(form.productType === 'Cash' || form.productType === 'Loan') && (
                      <p className="text-xs text-[var(--text-muted)] mt-1">Only Prepaid family is compatible with {form.productType} deals</p>
                    )}
                    <FieldError errors={errors} field="solarTechFamily" />
                  </div>

                  {/* Prepaid sub-type — shown when prepaid family is selected OR Cash/Loan with prepaid options */}
                  {getInstallerPrepaidOptions(form.installer).length > 0 && (
                    form.solarTechFamily === 'Cash/HDM/PE'
                  ) && (
                    <div className="transition-all duration-200">
                      <label className={labelCls} style={labelStyle}>
                        <span className="inline-flex items-center gap-1">Prepaid Type</span>
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {getInstallerPrepaidOptions(form.installer).map((opt) => (
                          <button key={opt} type="button"
                            onClick={() => { update('prepaidSubType', opt); setTouched((prev) => { const next = new Set(prev); next.add('prepaidSubType'); return next; }); }}
                            className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                              form.prepaidSubType === opt
                                ? 'bg-violet-600/20 border-violet-500/60 text-violet-300 shadow-[0_0_10px_rgba(139,92,246,0.2)]'
                                : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-white'
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
                      <label className={labelCls} style={labelStyle}>
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
                      <label htmlFor="field-solarTechProductId" className={labelCls} style={labelStyle}>
                        <span className="inline-flex items-center gap-1">Equipment Package {fieldCheck('solarTechProductId')}</span>
                      </label>
                      <SearchableSelect
                        value={form.solarTechProductId}
                        onChange={(val) => update('solarTechProductId', val)}
                        options={solarTechProducts.filter((p) => p.family === solarTechFamily).map((p) => ({ value: p.id, label: p.name }))}
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
                    <label className={labelCls} style={labelStyle}>
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
                                  ? 'bg-[var(--surface-card)]/40 border-[var(--border)]/40 text-[var(--text-dim)] cursor-not-allowed opacity-50'
                                  : selected
                                    ? 'bg-[var(--accent-green)]/20 border-[var(--accent-green)]/60 text-[var(--accent-cyan)] shadow-[0_0_12px_rgba(37,99,235,0.2)]'
                                    : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-white'
                              }`}
                            >
                              <span className={`text-xs font-semibold ${disabled ? 'text-[var(--text-dim)]' : selected ? 'text-[var(--accent-green)]' : 'text-[var(--text-muted)]'}`}>{family}</span>
                            </button>
                          );
                        });
                      })()}
                    </div>
                    {(form.productType === 'Cash' || form.productType === 'Loan') && pcConfig.prepaidFamily && (
                      <p className="text-xs text-[var(--text-muted)] mt-1">Only {pcConfig.prepaidFamily} family is compatible with {form.productType} deals</p>
                    )}
                    <FieldError errors={errors} field="pcFamily" />
                  </div>

                  {/* Prepaid sub-type — shown when installer has prepaid options AND (Cash/Loan or prepaid family selected) */}
                  {getInstallerPrepaidOptions(form.installer).length > 0 && (
                    (form.productType === 'Cash' || form.productType === 'Loan') ||
                    (pcConfig.prepaidFamily && form.pcFamily === pcConfig.prepaidFamily)
                  ) && (
                    <div className="transition-all duration-200">
                      <label className={labelCls} style={labelStyle}>
                        <span className="inline-flex items-center gap-1">Prepaid Type</span>
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {getInstallerPrepaidOptions(form.installer).map((opt) => (
                          <button key={opt} type="button"
                            onClick={() => { update('prepaidSubType', opt); setTouched((prev) => { const next = new Set(prev); next.add('prepaidSubType'); return next; }); }}
                            className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                              form.prepaidSubType === opt
                                ? 'bg-violet-600/20 border-violet-500/60 text-violet-300 shadow-[0_0_10px_rgba(139,92,246,0.2)]'
                                : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-white'
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
                      <label className={labelCls} style={labelStyle}>
                        <span className="inline-flex items-center gap-1">Financer {fieldCheck('financer')}</span>
                      </label>
                      <SearchableSelect
                        value={form.financer}
                        onChange={(val) => handleFinancerChange(val)}
                        options={(pcConfig?.familyFinancerMap?.[form.pcFamily] && form.productType !== 'Loan'
                          ? (activeFinancers.includes(pcConfig.familyFinancerMap[form.pcFamily])
                              ? activeFinancers.filter((f) => f === pcConfig.familyFinancerMap![form.pcFamily])
                              : activeFinancers)
                          : activeFinancers
                        ).map((f) => ({ value: f, label: f }))}
                        placeholder="— Select financer —"
                        error={!!errors.financer}
                      />
                      <FieldError errors={errors} field="financer" />
                    </div>
                  )}

                  {/* Product picker — revealed once a family is selected */}
                  {hasPcProducts && (
                    <div className="transition-all duration-200">
                      <label htmlFor="field-installerProductId" className={labelCls} style={labelStyle}>
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
                      <label className={labelCls} style={labelStyle}>
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
                      <label className={labelCls} style={labelStyle}>
                        <span className="inline-flex items-center gap-1">Prepaid Type</span>
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {getInstallerPrepaidOptions(form.installer).map((opt) => (
                          <button key={opt} type="button"
                            onClick={() => { update('prepaidSubType', opt); setTouched((prev) => { const next = new Set(prev); next.add('prepaidSubType'); return next; }); }}
                            className={`py-2 rounded-xl text-sm font-medium border transition-all ${
                              form.prepaidSubType === opt
                                ? 'bg-violet-600/20 border-violet-500/60 text-violet-300 shadow-[0_0_10px_rgba(139,92,246,0.2)]'
                                : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-white'
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
                  <label htmlFor="field-kWSize" className={labelCls} style={labelStyle}>
                    <span className="inline-flex items-center gap-1">System Size (kW) {fieldCheck('kWSize')}</span>
                  </label>
                  <div className="relative">
                    <input id="field-kWSize" type="number" step="0.1" min="0.1" placeholder="8.4"
                      value={form.kWSize} onChange={(e) => update('kWSize', e.target.value)}
                      onBlur={() => handleBlur('kWSize')} aria-invalid={!!errors.kWSize}
                      className={inputCls('kWSize') + (kW > 0 && !errors.kWSize ? ' pr-9' : '')} style={inputFieldStyle('kWSize')} />
                    {kW > 0 && !errors.kWSize && (
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                        <Check className="w-4 h-4 text-[var(--accent-green)]" strokeWidth={2.5} />
                      </span>
                    )}
                  </div>
                  <FieldError errors={errors} field="kWSize" />
                </div>
                <div className="transition-all duration-200">
                  <label htmlFor="field-netPPW" className={labelCls} style={labelStyle}>
                    <span className="inline-flex items-center gap-1">Net PPW ($/W) {fieldCheck('netPPW')}</span>
                  </label>
                  <div className="relative">
                    <input id="field-netPPW" type="number" step="0.01" min="0.01" placeholder="3.45"
                      value={form.netPPW} onChange={(e) => update('netPPW', e.target.value)}
                      onBlur={() => handleBlur('netPPW')} aria-invalid={!!errors.netPPW}
                      className={inputCls('netPPW') + (soldPPW > 0 && !errors.netPPW ? ' pr-9' : '')} style={inputFieldStyle('netPPW')} />
                    {soldPPW > 0 && !errors.netPPW && (
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
                        <Check className="w-4 h-4 text-[var(--accent-green)]" strokeWidth={2.5} />
                      </span>
                    )}
                  </div>
                  <FieldError errors={errors} field="netPPW" />
                  {!isSubDealer && <PpwHint soldPPW={soldPPW} closerPerW={closerPerW} hasError={!!errors.netPPW} />}
                </div>
              </div>

              {/* Commission preview */}
              <CommissionPreview
                showPreview={showPreview}
                isSubDealer={isSubDealer}
                subDealerCommission={subDealerCommission}
                kW={kW}
                soldPPW={soldPPW}
                closerPerW={closerPerW}
                kiloPerW={kiloPerW}
                closerTotal={closerTotal}
                closerM1={closerM1}
                closerM2={closerM2}
                closerM3={closerM3}
                hasM3={hasM3}
                setterTotal={setterTotal}
                setterM1={setterM1}
                setterM2={setterM2}
                setterM3={setterM3}
                setterId={form.setterId}
                setterBaselinePerW={setterBaselinePerW}
                trainerRep={trainerRep}
                trainerTotal={trainerTotal}
                trainerOverrideRate={trainerOverrideRate}
                closerTrainerRep={closerTrainerRep}
                closerTrainerTotal={closerTrainerTotal}
                closerTrainerOverrideRate={closerTrainerOverrideRate}
                kiloTotal={kiloTotal}
                currentRole={currentRole}
                subDealerRate={subDealerRate}
              />
            </div> {/* end card-surface 2 */}

          </div>
        </div>
        )} {/* end currentStep === 1 */}

        {/* ── Section 3: Review & Notes ── */}
        {currentStep === 2 && (
        <div id="section-review">
          <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Sans',sans-serif", marginBottom: 16 }}>Review &amp; submit</p>

          <div className="space-y-4">

            {/* ── Deal summary card — card-surface with top gradient accent ── */}
            <div className="relative card-surface rounded-2xl p-5 mb-4 overflow-hidden animate-slide-in-scale stagger-1 after:absolute after:inset-x-0 after:top-0 after:h-px after:bg-gradient-to-r after:from-transparent after:via-blue-500/30 after:to-transparent">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-3">Deal Summary</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
                <div>
                  <p className="text-[var(--text-muted)] text-xs mb-0.5">Customer</p>
                  <p className="text-white font-medium truncate">{form.customerName || <span className="text-[var(--text-dim)] italic">—</span>}</p>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] text-xs mb-0.5">Sold Date</p>
                  <p className="text-white font-medium">{form.soldDate || <span className="text-[var(--text-dim)] italic">—</span>}</p>
                </div>
                {currentRole === 'admin' && (
                  <div>
                    <p className="text-[var(--text-muted)] text-xs mb-0.5">Closer</p>
                    <p className="text-white font-medium truncate">
                      {reps.find((r) => r.id === form.repId)?.name || <span className="text-[var(--text-dim)] italic">—</span>}
                    </p>
                  </div>
                )}
                {form.setterId && (
                  <div>
                    <p className="text-[var(--text-muted)] text-xs mb-0.5">Setter</p>
                    <p className="text-white font-medium truncate">
                      {reps.find((r) => r.id === form.setterId)?.name || <span className="text-[var(--text-dim)] italic">—</span>}
                    </p>
                  </div>
                )}
                <div>
                  <p className="text-[var(--text-muted)] text-xs mb-0.5">Installer</p>
                  <p className="text-white font-medium truncate">{form.installer || <span className="text-[var(--text-dim)] italic">—</span>}</p>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] text-xs mb-0.5">Financer</p>
                  <p className="text-white font-medium truncate">{form.financer || <span className="text-[var(--text-dim)] italic">—</span>}</p>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] text-xs mb-0.5">Product Type</p>
                  <p className="text-white font-medium">{form.productType || <span className="text-[var(--text-dim)] italic">—</span>}</p>
                </div>
                <div>
                  <p className="text-[var(--text-muted)] text-xs mb-0.5">System Size</p>
                  <p className="text-white font-medium">
                    {kW > 0 ? `${kW.toFixed(1)} kW` : <span className="text-[var(--text-dim)] italic">—</span>}
                    {kW > 0 && soldPPW > 0 && <span className="text-[var(--text-secondary)]"> @ ${soldPPW.toFixed(2)}/W</span>}
                  </p>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div className="transition-all duration-200">
              <label htmlFor="field-notes" className={labelCls} style={labelStyle}>
                Notes <span className="text-[var(--text-dim)] font-normal normal-case">(optional)</span>
              </label>
              <textarea
                id="field-notes"
                ref={notesRef}
                placeholder="Add any notes about this deal (roof type, special conditions, follow-ups...)"
                value={form.notes}
                maxLength={500}
                onChange={(e) => update('notes', e.target.value)}
                onInput={(e) => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = el.scrollHeight + 'px';
                }}
                className={inputCls('') + ' min-h-[80px] max-h-[200px] overflow-y-auto resize-none'} style={inputFieldStyle('')}
              />
              <div className="flex items-center justify-between mt-1 mb-4">
                <p className="text-xs italic text-[var(--text-dim)]">Internal notes only — not visible to customer</p>
                <p className={`text-xs transition-colors duration-200 ${
                  form.notes.length >= 500 ? 'text-red-400' :
                  form.notes.length >= 400 ? 'text-amber-400' :
                  'text-[var(--text-muted)]'
                }`}>
                  {form.notes.length}/500
                </p>
              </div>
            </div>

            {/* Lead Source + Blitz Attribution */}
            <div className="transition-all duration-200 pt-2 border-t border-[var(--border-subtle)]/60">
              <label className={labelCls} style={labelStyle}>
                Lead Source <span className="text-[var(--text-dim)] font-normal normal-case">(optional)</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  { value: 'organic', label: 'Organic' },
                  { value: 'referral', label: 'Referral' },
                  { value: 'blitz', label: 'Blitz' },
                  { value: 'door_knock', label: 'Door Knock' },
                  { value: 'web', label: 'Web Lead' },
                  { value: 'other', label: 'Other' },
                ] as { value: string; label: string }[]).map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      update('leadSource', form.leadSource === value ? '' : value);
                      if (value !== 'blitz' || form.leadSource === 'blitz') {
                        update('blitzId', '');
                      }
                      if (form.leadSource !== 'blitz' && value === 'blitz' && !form.soldDate) {
                        update('soldDate', new Date().toLocaleDateString('en-CA'));
                      }
                    }}
                    className={`px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                      form.leadSource === value
                        ? 'bg-[var(--accent-green)] border-[var(--accent-green)] text-black shadow-[0_0_10px_rgba(0,224,122,0.25)]'
                        : 'bg-[var(--surface-card)] border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-subtle)] hover:text-white'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {form.leadSource === 'blitz' && (
                  <select
                    id="field-blitzId"
                    value={form.blitzId}
                    onChange={(e) => {
                      const blitzId = e.target.value;
                      update('blitzId', blitzId);
                      // Smart default sold date based on blitz date range (#15)
                      // Only apply if user hasn't manually entered a date (still on the default today value)
                      if (blitzId) {
                        const blitz = availableBlitzes.find((b) => b.id === blitzId);
                        if (blitz?.startDate && blitz?.endDate) {
                          const today = new Date().toLocaleDateString('en-CA');
                          if (form.soldDate === today) {
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
                      }
                      // Blitz deselected — leave soldDate as-is to preserve any manually entered date
                      // Clear setter whenever a blitz is selected (including first selection); don't clear on deselect
                      if (blitzId) update('setterId', '');
                    }}
                    onBlur={() => handleBlur('blitzId')}
                    className={inputCls('blitzId')} style={inputFieldStyle('blitzId')}
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
        )} {/* end currentStep === 2 */}

        </div> {/* end animated step wrapper */}

        {/* ── Navigation buttons ── */}
        <div style={{ display: 'flex', justifyContent: currentStep > 0 ? 'space-between' : 'flex-end', alignItems: 'center', marginTop: 24 }}>
          {/* Back */}
          {currentStep > 0 && (
            <button
              type="button"
              onClick={handlePrev}
              disabled={submitting}
              style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 20px', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}
            >
              Previous
            </button>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Next — shown on steps 0 and 1 */}
          {currentStep < DEAL_STEPS.length - 1 && (
            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-2 active:scale-[0.97]"
              style={{ background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))', borderRadius: 10, padding: '9px 20px', color: '#000', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer' }}
            >
              Next
            </button>
          )}

          {/* Submit — shown on the last step only */}
          {currentStep === DEAL_STEPS.length - 1 && (
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center gap-2 active:scale-[0.97] disabled:opacity-60 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))', borderRadius: 10, padding: '9px 20px', color: '#000', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer' }}
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
          )}

          {currentStep === DEAL_STEPS.length - 1 && !submitting && (
            <kbd
              className="font-mono text-[9px] text-[var(--text-muted)] bg-[var(--surface-card)]/80 border border-[var(--border)]/60 rounded px-1.5 py-0.5 leading-none select-none"
              aria-hidden="true"
              title="Press ⌘Enter (or Ctrl+Enter) to submit"
            >
              ⌘↵ submit
            </kbd>
          )}
          </div>
        </div>

      </form>
      </div> {/* end form card */}
      </div> {/* end right panel */}
      </div> {/* end split layout */}

      {/* ── Sticky mobile commission preview bar (step 2 only) ── */}
      {currentStep === 1 && (showPreview || (isSubDealer && subDealerCommission > 0)) && (
        <div className="fixed bottom-0 left-0 right-0 md:hidden z-40 bg-[var(--surface)]/95 backdrop-blur-sm border-t border-[var(--border-subtle)] px-4 py-3">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <div className="flex flex-col">
              <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider leading-none mb-0.5">
                {form.installer}{kW > 0 ? ` \u00B7 ${kW.toFixed(1)} kW` : ''}
              </span>
              <span className="text-lg font-black text-[var(--accent-green)]" style={{ fontVariantNumeric: 'tabular-nums' }}>
                Est. Commission: ${(isSubDealer ? subDealerCommission : closerTotal).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
