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
import { CoPartySection, type CoPartyDraft } from '../projects/components/CoPartySection';
import { evenSplit } from '../../../lib/commission-split';
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
  const { dbReady, currentRole, effectiveRole, currentRepId, effectiveRepId, currentRepName, effectiveRepName, addDeal, projects, trainerAssignments, activeInstallers, activeFinancers, reps, installerPricingVersions, productCatalogInstallerConfigs, productCatalogProducts, productCatalogPricingVersions, getInstallerPrepaidOptions, installerBaselines, installerPayConfigs, solarTechProducts } = useApp();
  const { toast } = useToast();
  const router = useRouter();
  useEffect(() => { document.title = 'New Deal | Kilo Energy'; }, []);
  const isHydrated = useIsHydrated();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const isSubDealer = effectiveRole === 'sub-dealer';

  const blankForm = () => ({
    customerName: '',
    soldDate: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; })(),
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
    // Tag-team co-parties — admin-only in practice (primary closer/setter
    // filters strip non-closers/non-setters; co-parties follow the same
    // picker filters). Strings because the inputs are controlled.
    additionalClosers: [] as CoPartyDraft[],
    additionalSetters: [] as CoPartyDraft[],
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
      if (effectiveRole === 'admin') {
        // When a rep is selected, only show blitzes that rep is approved for
        if (form.repId) {
          return b.participants?.some((p: any) => p.userId === form.repId && p.joinStatus === 'approved');
        }
        return true;
      }
      return b.participants?.some((p: any) => p.userId === effectiveRepId && p.joinStatus === 'approved');
    });
  }, [rawBlitzes, effectiveRole, effectiveRepId, form.repId]);

  // ── Duplicate deal pre-fill from query params ─────────────────────────────
  const searchParams = useSearchParams();
  const duplicateApplied = useRef(false);
  const duplicateCustomerName = searchParams.get('duplicate') === 'true' ? (searchParams.get('customerName') ?? '') : '';
  const customerNameInputRef = useRef<HTMLInputElement>(null);
  const soldDateInputRef = useRef<HTMLInputElement>(null);
  const repIdSelectRef = useRef<HTMLSelectElement>(null);
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
    const repId = searchParams.get('repId') ?? (effectiveRole === 'admin' ? '' : (effectiveRepId ?? ''));
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
  }, [searchParams, dbReady, effectiveRole, effectiveRepId, activeInstallers, activeFinancers, toast]);

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
    (effectiveRole === 'admin' && form.repId !== '') ||
    form.additionalClosers.length > 0 || form.additionalSetters.length > 0;

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

  useEffect(() => {
    setForm((prev) => ({ ...prev, additionalSetters: [] }));
  }, [form.setterId]);

  // ── Field helpers ──────────────────────────────────────────────────────────

  const update = (field: string, value: string) => {
    isDirty.current = true;
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      next[field] = '';
      return next;
    });
  };

  const handleBlur = (field: string) => {
    const raw = form[field as keyof typeof form];
    // Array fields (co-parties) aren't blur-validated; only string inputs are.
    const value = typeof raw === 'string' ? raw : '';
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
    setForm((prev) => ({ ...prev, installer: value, financer: '', productType: '', solarTechFamily: '', solarTechProductId: '', pcFamily: '', installerProductId: '', prepaidSubType: '', additionalClosers: [], additionalSetters: [] }));
    setErrors((prev) => ({ ...prev, installer: validateField('installer', value), financer: '', productType: '', solarTechFamily: '', solarTechProductId: '', pcFamily: '', installerProductId: '', prepaidSubType: '' }));
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
    const financerCleared = !effectiveFinancer && !!form.financer;
    setErrors((prev) => ({ ...prev, solarTechFamily: validateField('solarTechFamily', value), solarTechProductId: '', financer: (touched.has('financer') || financerCleared) ? validateField('financer', effectiveFinancer) : '' }));
    setTouched((prev) => { const next = new Set(prev); next.add('solarTechFamily'); if (financerCleared) next.add('financer'); return next; });
  };

  const handlePcFamilyChange = (value: string) => {
    const rawMappedFinancer = pcConfig?.familyFinancerMap?.[value] ?? '';
    const mappedFinancer = rawMappedFinancer && activeFinancers.includes(rawMappedFinancer) ? rawMappedFinancer : '';
    // Loan and Cash deals must not inherit a financer from the family mapping
    const effectiveFinancer = (form.productType === 'Loan' || form.productType === 'Cash') ? '' : mappedFinancer;
    setForm((prev) => ({ ...prev, pcFamily: value, installerProductId: '', financer: effectiveFinancer, prepaidSubType: '' }));
    const financerCleared = !effectiveFinancer && !!form.financer;
    setErrors((prev) => ({ ...prev, pcFamily: validateField('pcFamily', value), installerProductId: '', financer: (touched.has('financer') || financerCleared) ? validateField('financer', effectiveFinancer) : '' }));
    setTouched((prev) => { const next = new Set(prev); next.add('pcFamily'); if (financerCleared) next.add('financer'); return next; });
  };

  // ── Derived values ─────────────────────────────────────────────────────────

  const currentRep = reps.find((r) => r.id === effectiveRepId);
  const closerId = effectiveRole === 'admin' ? form.repId : (currentRep?.repType === 'setter' ? '' : (effectiveRepId ?? ''));

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

  // When a blitz is selected, restrict the admin closer dropdown to approved blitz participants.
  const closerPickerReps = useMemo(() => {
    if (!form.blitzId) return reps.filter((r) => r.active && r.repType !== 'setter');
    const selectedBlitz = rawBlitzes.find((b) => b.id === form.blitzId);
    const approvedIds = new Set(
      (selectedBlitz?.participants ?? [])
        .filter((p: any) => p.joinStatus === 'approved')
        .map((p: any) => p.userId as string),
    );
    return reps.filter((r) => r.active && approvedIds.has(r.id) && r.repType !== 'setter');
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
    const pct = installerPayConfigs[p.installer]?.installPayPct ?? INSTALLER_PAY_CONFIGS[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
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
      try {
        const b = getSolarTechBaseline(form.solarTechProductId, kW, solarTechProducts);
        return { closerPerW: b.closerPerW, setterBaselinePerW: b.setterPerW, kiloPerW: b.kiloPerW, activeVersionId: null };
      } catch {
        return { closerPerW: 0, setterBaselinePerW: 0, kiloPerW: 0, activeVersionId: null };
      }
    } else if (isPcInstaller && hasPcProducts && form.installerProductId && kW > 0) {
      try {
        const soldDate = form.soldDate || new Date().toISOString().split('T')[0];
        const b = getProductCatalogBaselineVersioned(productCatalogProducts, form.installerProductId, kW, soldDate, productCatalogPricingVersions);
        return { closerPerW: b.closerPerW, setterBaselinePerW: b.setterPerW, kiloPerW: b.kiloPerW, activeVersionId: b.pcPricingVersionId };
      } catch {
        return { closerPerW: 0, setterBaselinePerW: 0, kiloPerW: 0, activeVersionId: null };
      }
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

  const kiloTotal = calculateCommission(soldPPW, kiloPerW, kW);

  const trainerM1 = 0;
  const trainerM2 = trainerTotal;

  // M2/M3 split based on installer pay config
  const installPayPct = installerPayConfigs[form.installer]?.installPayPct ?? INSTALLER_PAY_CONFIGS[form.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
  const hasM3 = installPayPct < 100;
  const { closerTotal, setterTotal, closerM1, closerM2, closerM3, setterM1, setterM2, setterM3 } = splitCloserSetterPay(
    soldPPW,
    closerPerW,
    !form.setterId ? 0 : setterBaselinePerW,
    trainerOverrideRate,
    kW,
    installPayPct,
  );

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
    const raw = form[field as keyof typeof form];
    const value = typeof raw === 'string' ? raw : '';
    return !validateField(field, value);
  };

  const s1Fields: string[] = [
    ...(effectiveRole === 'admin' ? ['repId'] : []),
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
    ...(getInstallerPrepaidOptions(form.installer).length > 0 && (
      form.solarTechFamily === 'Cash/HDM/PE' ||
      (isPcInstaller && !!pcConfig?.prepaidFamily && form.pcFamily === pcConfig.prepaidFamily) ||
      (!isPcInstaller && form.installer !== 'SolarTech' && (form.productType === 'Cash' || form.productType === 'Loan'))
    ) ? ['prepaidSubType'] : []),
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

  // Auto-advance removed — it "yanked" users forward before they could add
  // optional fields. Step progression now requires an explicit Next click.

  // ── Step navigation handlers ───────────────────────────────────────────────

  const handleNext = () => {
    // Validate the fields on the current step before advancing. This prevents
    // the user from skipping ahead and discovering validation errors on hidden
    // steps only after hitting Submit.
    const stepFields = currentStep === 0 ? s1Fields : currentStep === 1 ? s2Fields : s3Fields;
    const stepErrors: Record<string, string> = {};
    let hasStepErrors = false;
    for (const field of stepFields) {
      const raw = form[field as keyof typeof form];
      const value = typeof raw === 'string' ? raw : '';
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
    if (hasStepErrors) {
      // Focus the first invalid field so the user's attention is drawn to it
      const firstErrorField = stepFields.find((f) => stepErrors[f]);
      if (firstErrorField === 'customerName') {
        customerNameInputRef.current?.focus();
      } else if (firstErrorField === 'soldDate') {
        soldDateInputRef.current?.focus();
      }
      toast('Please fill in the required fields before continuing.', 'error');
      return;
    }

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
      ...(effectiveRole === 'admin' ? ['repId'] : []),
      ...(form.installer === 'SolarTech' ? ['solarTechFamily'] : []),
      ...(form.installer === 'SolarTech' && hasSolarTechProducts ? ['solarTechProductId'] : []),
      ...(isPcInstaller && form.installer !== 'SolarTech' ? ['pcFamily'] : []),
      ...(isPcInstaller && form.installer !== 'SolarTech' && hasPcProducts ? ['installerProductId'] : []),
      ...(getInstallerPrepaidOptions(form.installer).length > 0 && (
        form.solarTechFamily === 'Cash/HDM/PE' ||
        (isPcInstaller && !!pcConfig?.prepaidFamily && form.pcFamily === pcConfig.prepaidFamily) ||
        (!isPcInstaller && form.installer !== 'SolarTech' && (form.productType === 'Cash' || form.productType === 'Loan'))
      ) ? ['prepaidSubType'] : []),
      ...(form.leadSource === 'blitz' ? ['blitzId'] : []),
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
    // Mark all validated fields as touched so inline errors render
    setTouched((prev) => {
      const next = new Set(prev);
      fieldsToValidate.forEach((f) => next.add(f));
      return next;
    });
    if (hasErrors) {
      submittingRef.current = false;
      // Navigate to the first step that contains an invalid field so the
      // error messages are visible (they live in step-specific JSX).
      const firstErrorField = fieldsToValidate.find((f) => newErrors[f]);
      if (firstErrorField) {
        const targetStep = s1Fields.includes(firstErrorField) ? 0
          : s2Fields.includes(firstErrorField) ? 1
          : 2;
        setSlideDirection('backward');
        setCurrentStep(targetStep);
        // Focus the field after the step transition renders
        setTimeout(() => {
          if (firstErrorField === 'customerName') customerNameInputRef.current?.focus();
          else if (firstErrorField === 'soldDate') soldDateInputRef.current?.focus();
        }, 50);
      }
      return;
    }

    // Guard: setter-type reps cannot be the closer on a deal.
    if (!closerId) {
      toast('Setter accounts cannot submit deals directly. Please contact an admin.', 'error');
      submittingRef.current = false;
      return;
    }

    // Guard: if a blitz is selected, both the closer and setter (if chosen) must
    // be approved participants of that blitz. The UI clears setterId on blitz
    // change, but this prevents stale IDs (e.g. approval revoked after selection)
    // from reaching the database.
    if (form.blitzId) {
      const selectedBlitz = rawBlitzes.find((b) => b.id === form.blitzId);
      const approvedIds = new Set(
        (selectedBlitz?.participants ?? [])
          .filter((p: any) => p.joinStatus === 'approved')
          .map((p: any) => p.userId as string),
      );
      if (form.repId && !approvedIds.has(form.repId)) {
        setSlideDirection('backward');
        setCurrentStep(0);
        toast('Selected closer is not an approved participant of this blitz.', 'error');
        submittingRef.current = false;
        return;
      }
      if (form.setterId && !approvedIds.has(form.setterId)) {
        toast('Selected setter is not an approved participant of this blitz.', 'error');
        submittingRef.current = false;
        return;
      }
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

    try {
    const rep = reps.find((r) => r.id === closerId);
    const setter = form.setterId ? reps.find((r) => r.id === form.setterId) : null;
    const projectId = genId('proj');

    // ── Tag-team serialization ──────────────────────────────────────────
    // Drop incomplete rows (no user picked), then parse each amount string
    // to a number. Primary's m1/m2/m3 get reduced by the sum of co-party
    // cuts so the deal's total closer/setter commission stays consistent
    // with what the pricing calc returned — no double-counting.
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
    `w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-green)]/50 focus-visible:border-[var(--accent-green)] transition-all duration-200 placeholder-slate-500${errors[field] ? ' ring-2 ring-red-500' : ''}`;

  const inputFieldStyle = (field: string): React.CSSProperties => ({
    background: 'var(--surface-card)',
    border: `1px solid ${errors[field] ? 'var(--accent-red)' : 'var(--border-subtle)'}`,
    color: 'var(--text-primary)',
    fontFamily: "'DM Sans', sans-serif",
  });

  const selectCls = (field: string) =>
    `w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-green)]/50 focus-visible:border-[var(--accent-green)] transition-all duration-200${errors[field] ? ' ring-2 ring-red-500' : ''}`;

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
  const _isMyDeal = (p: { repId?: string | null; setterId?: string | null; additionalClosers?: { userId: string }[]; additionalSetters?: { userId: string }[] }) =>
    p.repId === effectiveRepId || p.setterId === effectiveRepId ||
    p.additionalClosers?.some((c) => c.userId === effectiveRepId) ||
    p.additionalSetters?.some((s) => s.userId === effectiveRepId);
  const monthCount = effectiveRepId == null ? 0 : projects.filter((p) => p.soldDate?.startsWith(_monthPrefix) && _isMyDeal(p)).length;
  const todayCount = effectiveRepId == null ? 0 : projects.filter((p) => p.soldDate?.startsWith(_today) && _isMyDeal(p)).length;

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
              {effectiveRole === 'admin' && (
                <div className="transition-all duration-200">
                  <label htmlFor="field-repId" className={labelCls} style={labelStyle}>
                    <span className="inline-flex items-center gap-1">Closer (Rep) {fieldCheck('repId')}</span>
                  </label>
                  <select id="field-repId" value={form.repId} onChange={(e) => { update('repId', e.target.value); update('setterId', ''); }}
                    onBlur={() => handleBlur('repId')} aria-invalid={!!errors.repId} aria-describedby={errors.repId ? 'repId-error' : undefined} className={selectCls('repId')} style={inputFieldStyle('repId')}>
                    <option value="">— Select closer —</option>
                    {closerPickerReps.filter((r) => r.id !== form.setterId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
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

              {/* ── Tag-team: co-closers + co-setters ──
                  Admin-only. Default behavior on first-add: evenly split
                  the calculated closer/setter commission across [primary
                  + the new row] via evenSplit(). Admin can then override
                  any amount. On submit, the primary's m1/m2/m3 get
                  reduced by the sum of each co-party's cut (so the deal
                  total stays consistent with what the pricing calc
                  returned). */}
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
                      // Split the computed closer commission evenly between
                      // primary + one new co-closer.
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
                  aria-describedby={errors.customerName ? 'customerName-error' : undefined}
                  className={inputCls('customerName')} style={inputFieldStyle('customerName')} />
                <FieldError errors={errors} field="customerName" />
              </div>
              <div className="transition-all duration-200">
                <label htmlFor="field-soldDate" className={labelCls} style={labelStyle}>
                  <span className="inline-flex items-center gap-1">Sold Date {fieldCheck('soldDate')}</span>
                </label>
                <input id="field-soldDate" ref={soldDateInputRef} type="date" value={form.soldDate}
                  onChange={(e) => update('soldDate', e.target.value)} onBlur={() => handleBlur('soldDate')}
                  aria-invalid={!!errors.soldDate} aria-describedby={errors.soldDate ? 'soldDate-error' : undefined}
                  className={inputCls('soldDate')} style={inputFieldStyle('soldDate')} />
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
                label="Installer"
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
                          additionalClosers: [], additionalSetters: [],
                        }));
                        isDirty.current = true;
                        setErrors((prev) => ({ ...prev, productType: '', financer: isCash ? '' : prev.financer }));
                        setTouched((prev) => { const next = new Set(prev); next.add('productType'); return next; });
                      }}
                      className={`py-2.5 rounded-xl text-sm font-medium border transition-all ${
                        form.productType === pt
                          ? 'bg-[var(--accent-green)] border-[var(--accent-green)] text-black shadow-[0_0_10px_rgba(37,99,235,0.3)]'
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
                      <FieldError errors={errors} field="prepaidSubType" />
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
                        options={activeFinancers.filter((f) => f !== 'Cash').map((f) => ({ value: f, label: f }))}
                        placeholder="— Select financer —"
                        label="Financer"
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
                        label="Equipment Package"
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

                  {/* Prepaid sub-type — shown when installer has prepaid options AND prepaid family is selected */}
                  {getInstallerPrepaidOptions(form.installer).length > 0 && (
                    pcConfig.prepaidFamily && form.pcFamily === pcConfig.prepaidFamily
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
                      <FieldError errors={errors} field="prepaidSubType" />
                    </div>
                  )}

                  {/* Financer — independent dropdown for PC installer (hidden for Cash) */}
                  {form.productType !== 'Cash' && (
                    <div className="transition-all duration-200">
                      <label className={labelCls} style={labelStyle}>
                        <span className="inline-flex items-center gap-1">Financer {fieldCheck('financer')}</span>
                      </label>
                      {(() => {
                        const mappedFinancer = pcConfig?.familyFinancerMap?.[form.pcFamily];
                        const hasFamilyMap = !!mappedFinancer && form.productType !== 'Loan';
                        const mappedIsActive = hasFamilyMap && activeFinancers.includes(mappedFinancer);
                        const mappedIsArchived = hasFamilyMap && !mappedIsActive;
                        const financerOptions = (
                          mappedIsActive ? activeFinancers.filter((f) => f === mappedFinancer) :
                          activeFinancers
                        ).filter((f) => f !== 'Cash').map((f) => ({ value: f, label: f }));
                        return (
                          <>
                            <SearchableSelect
                              value={form.financer}
                              onChange={(val) => handleFinancerChange(val)}
                              options={financerOptions}
                              placeholder="— Select financer —"
                              label="Financer"
                              error={!!errors.financer}
                            />
                            {mappedIsArchived && (
                              <p className="mt-1 text-xs text-yellow-400">
                                The designated financer for this family ("{mappedFinancer}") has been archived — select an alternative below.
                              </p>
                            )}
                          </>
                        );
                      })()}
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
                        label="Equipment Package"
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
                        options={activeFinancers.filter((f) => f !== 'Cash').map((f) => ({ value: f, label: f }))}
                        placeholder="— Select financer —"
                        label="Financer"
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
                      <FieldError errors={errors} field="prepaidSubType" />
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
                effectiveRole={effectiveRole}
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
                {effectiveRole === 'admin' && (
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
                          if (!touched.has('soldDate')) {
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
                      if (blitzId) { update('setterId', ''); }
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
              style={{ background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))', borderRadius: 10, padding: '9px 20px', color: '#050d18', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer' }}
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
              style={{ background: 'linear-gradient(135deg, var(--accent-green), var(--accent-cyan))', borderRadius: 10, padding: '9px 20px', color: '#050d18', fontSize: 13, fontWeight: 700, border: 'none', cursor: 'pointer' }}
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
