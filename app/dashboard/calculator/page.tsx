'use client';

import { useState, useEffect, useRef, Suspense, type CSSProperties } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApp } from '../../../lib/context';
import { useIsHydrated, useMediaQuery } from '../../../lib/hooks';
import MobileCalculator from '../mobile/MobileCalculator';
import { getSolarTechBaseline, calculateCommission, splitCloserSetterPay, getTrainerOverrideRate, SOLARTECH_FAMILIES, SOLARTECH_FAMILY_FINANCER, getInstallerRatesForDeal, getProductCatalogBaselineVersioned, DEFAULT_INSTALL_PAY_PCT, INSTALLER_PAY_CONFIGS } from '../../../lib/data';
import { Calculator, Zap, RotateCcw, ClipboardCopy, HelpCircle, Share2, ChevronDown, ChevronUp, Clock, Trash2, Link2 } from 'lucide-react';
import { Breadcrumb } from '../components/Breadcrumb';
import { RepSelector } from '../components/RepSelector';
import { SearchableSelect } from '../components/SearchableSelect';
import { useToast } from '../../../lib/toast';

// ─── Calc History ──────────────────────────────────────────────────────────────
const CALC_HISTORY_KEY = 'kilo-calc-history';
const MAX_HISTORY = 5;

interface CalcHistoryEntry {
  installer: string;
  solarTechFamily?: string;
  solarTechProductId?: string;
  pcFamily?: string;
  pcProductId?: string;
  kW: number;
  ppw: number;
  hasSetter: boolean;
  selectedSetterId?: string;
  closerTotal: number;
  setterTotal: number;
  trainerTotal: number;
  timestamp: number;
}

function loadCalcHistory(): CalcHistoryEntry[] {
  try {
    const raw = localStorage.getItem(CALC_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_HISTORY) : [];
  } catch { return []; }
}

function saveCalcHistory(entries: CalcHistoryEntry[]) {
  try {
    localStorage.setItem(CALC_HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  } catch { /* quota exceeded — silently ignore */ }
}

// ─── Count-Up Hook ─────────────────────────────────────────────────────────────
function useCountUp(target: number, duration = 600): number {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    let startTime: number | null = null;

    const step = (ts: number) => {
      if (startTime === null) startTime = ts;
      const elapsed = ts - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // cubic ease-out
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(target * eased));
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setDisplay(target);
        rafRef.current = null;
      }
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [target, duration]);

  return display;
}

// ─── Field Tooltip ─────────────────────────────────────────────────────────────
/**
 * Reusable help-text tooltip.
 * - Desktop: shows on hover via CSS group-hover (no JS required).
 * - Mobile:  shows on tap; click-outside dismisses it.
 * Positioning is pure CSS (absolute + transform). No external libraries.
 */
function FieldTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  // Click-outside dismiss for mobile tap pattern
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('touchstart', dismiss);
    return () => {
      document.removeEventListener('mousedown', dismiss);
      document.removeEventListener('touchstart', dismiss);
    };
  }, [open]);

  return (
    <span
      ref={ref}
      // `group` enables the CSS-only hover path; inline-flex keeps it on the same line as the label text
      className="relative inline-flex items-center ml-1.5 group"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      // stopPropagation prevents toggling a parent label's control (e.g. the setter switch)
      onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
    >
      <HelpCircle className="w-3.5 h-3.5 text-[var(--text-muted)] group-hover:text-[var(--text-secondary)] cursor-pointer transition-colors flex-shrink-0" />
      {/* Tooltip bubble — hidden by default, revealed via group-hover (CSS) or open state (mobile tap) */}
      <span
        role="tooltip"
        className={[
          'pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2',
          'w-56 bg-[var(--border)] border border-[var(--border)] text-[var(--text-secondary)]',
          'text-xs font-normal normal-case tracking-normal leading-relaxed',
          'rounded-lg px-3 py-2 shadow-xl z-50 transition-opacity duration-150',
          open ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        ].join(' ')}
      >
        {text}
        {/* Caret arrow pointing down toward the icon */}
        <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-slate-700" />
      </span>
    </span>
  );
}

// ─── Commission Bar ────────────────────────────────────────────────────────────
function CommissionBar({
  closer,
  setter,
  trainer,
  kilo,
  showKilo,
}: {
  closer: number;
  setter: number;
  trainer: number;
  kilo: number;
  showKilo: boolean;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // One rAF so the browser paints width:0% first, then transitions to real widths
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const total = closer + setter + trainer + (showKilo ? kilo : 0);
  if (total <= 0) return null;

  const pct = (v: number) => `${(v / total) * 100}%`;

  const segments = [
    { key: 'closer',  value: closer,  colorClass: 'bg-[var(--accent-green)]',    label: 'Closer'   },
    { key: 'setter',  value: setter,  colorClass: 'bg-[var(--accent-cyan)]', label: 'Setter'   },
    { key: 'trainer', value: trainer, colorClass: 'bg-amber-500',   label: 'Trainer'  },
    ...(showKilo ? [{ key: 'kilo', value: kilo, colorClass: 'bg-[var(--text-muted)]', label: 'Kilo Rev' }] : []),
  ].filter((s) => s.value > 0);

  return (
    <div className="mt-4 space-y-2">
      <div className="h-3 rounded-full bg-[var(--surface-card)] overflow-hidden flex">
        {segments.map((seg) => (
          <div
            key={seg.key}
            className={`${seg.colorClass} transition-all duration-700 ease-out`}
            style={{ width: mounted ? pct(seg.value) : '0%' }}
          />
        ))}
      </div>
      <div className="flex items-center gap-4 flex-wrap">
        {segments.map((seg) => (
          <div key={seg.key} className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${seg.colorClass}`} />
            <span className="text-[var(--text-muted)] text-xs">{seg.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CalculatorPageWrapper() {
  return <Suspense><CalculatorPage /></Suspense>;
}

function CalculatorPage() {
  const searchParams = useSearchParams();
  const isHydrated = useIsHydrated();
  const { currentRepId, currentRole, effectiveRole, trainerAssignments, projects, activeInstallers, reps, installerPricingVersions, productCatalogInstallerConfigs, productCatalogProducts, installerPayConfigs, productCatalogPricingVersions, solarTechProducts } = useApp();
  useEffect(() => { document.title = 'Calculator | Kilo Energy'; }, []);
  const [installer, setInstaller] = useState('');
  const [solarTechFamily, setSolarTechFamily] = useState('');
  const [solarTechProductId, setSolarTechProductId] = useState('');
  const [pcProductId, setPcProductId] = useState('');
  const [pcSelectedFamily, setPcSelectedFamily] = useState('');
  const [kWSize, setKWSize] = useState('');
  const [netPPW, setNetPPW] = useState('');
  const [hasSetter, setHasSetter] = useState(false);
  const [selectedSetterId, setSelectedSetterId] = useState('');
  const [targetEarning, setTargetEarning] = useState('');
  const [quickFillValue, setQuickFillValue] = useState('');
  const [quickFillSoldDate, setQuickFillSoldDate] = useState('');
  const [quickFillRepId, setQuickFillRepId] = useState<string | null>(null);

  const { toast } = useToast();

  // ── Recent Calc History (localStorage) ────────────────────────────────────
  const [calcHistory, setCalcHistory] = useState<CalcHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const lastSavedHash = useRef('');

  // Load history once on mount
  useEffect(() => { setCalcHistory(loadCalcHistory()); }, []);

  // Pre-fill from URL search params (for shared URLs)
  useEffect(() => {
    const p = searchParams;
    if (p.get('installer')) setInstaller(p.get('installer')!);
    if (p.get('kW')) setKWSize(p.get('kW')!);
    if (p.get('ppw')) setNetPPW(p.get('ppw')!);
    if (p.get('stFamily')) setSolarTechFamily(p.get('stFamily')!);
    if (p.get('stProduct')) setSolarTechProductId(p.get('stProduct')!);
    if (p.get('pcFamily')) setPcSelectedFamily(p.get('pcFamily')!);
    if (p.get('pcProduct')) setPcProductId(p.get('pcProduct')!);
    if (p.get('setter') === '1') setHasSetter(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Refs for quick-fill cascade highlight ─────────────────────────────────
  const installerRef  = useRef<HTMLDivElement>(null);
  const stFamilyRef   = useRef<HTMLDivElement>(null);
  const stProductRef  = useRef<HTMLDivElement>(null);
  const pcFamilyRef   = useRef<HTMLDivElement>(null);
  const pcProductRef  = useRef<HTMLDivElement>(null);
  const kWSizeRef     = useRef<HTMLInputElement>(null);
  const netPPWRef     = useRef<HTMLInputElement>(null);

  /** Briefly flashes a blue ring on a form field after `delay` ms. */
  const flashField = (ref: { current: HTMLElement | null }, delay: number) => {
    setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.classList.add('field-flash');
      setTimeout(() => el.classList.remove('field-flash'), 350);
    }, delay);
  };

  // ── Recent deals for Quick Fill ──────────────────────────────────────────────
  const recentDeals = (() => {
    const filtered = effectiveRole === 'admin'
      ? projects
      : projects.filter((p) => p.repId === currentRepId || p.setterId === currentRepId);
    return [...filtered]
      .sort((a, b) => (b.soldDate ?? '').localeCompare(a.soldDate ?? ''))
      .slice(0, 10);
  })();

  const handleQuickFill = (projectId: string) => {
    setQuickFillValue(projectId);
    if (!projectId) { setQuickFillSoldDate(''); setQuickFillRepId(null); return; }
    const proj = recentDeals.find((p) => p.id === projectId);
    if (!proj) return;
    setQuickFillSoldDate(proj.soldDate);
    setQuickFillRepId(proj.repId ?? null);
    setInstaller(activeInstallers.includes(proj.installer) ? proj.installer : '');
    setKWSize(String(proj.kWSize));
    setNetPPW(String(proj.netPPW));

    const isST = proj.installer === 'SolarTech' && !!proj.solarTechProductId;
    const isPC = !isST && !!proj.installerProductId;

    if (isST) {
      const product = solarTechProducts.find((p) => p.id === proj.solarTechProductId);
      if (product) {
        setSolarTechFamily(product.family);
        setSolarTechProductId(proj.solarTechProductId!);
      }
      setPcProductId('');
      setPcSelectedFamily('');
    } else if (isPC) {
      const product = productCatalogProducts.find((p) => p.id === proj.installerProductId);
      if (product) {
        setPcSelectedFamily(product.family);
        setPcProductId(proj.installerProductId!);
      }
      setSolarTechFamily('');
      setSolarTechProductId('');
    } else {
      setSolarTechFamily('');
      setSolarTechProductId('');
      setPcProductId('');
      setPcSelectedFamily('');
    }

    setHasSetter(false);
    setSelectedSetterId('');

    // Cascade highlight — stagger a blue ring flash across each filled field
    flashField(installerRef, 0);
    if (isST) {
      flashField(stFamilyRef,  80);
      flashField(stProductRef, 160);
      flashField(kWSizeRef,    240);
      flashField(netPPWRef,    320);
    } else if (isPC) {
      flashField(pcFamilyRef,  80);
      flashField(pcProductRef, 160);
      flashField(kWSizeRef,    240);
      flashField(netPPWRef,    320);
    } else {
      flashField(kWSizeRef,  80);
      flashField(netPPWRef, 160);
    }
  };

  const handleReset = () => {
    // Snapshot current values so the Undo action can restore them
    const snapshot = {
      quickFillValue,
      quickFillSoldDate,
      quickFillRepId,
      installer,
      solarTechFamily,
      solarTechProductId,
      pcProductId,
      pcSelectedFamily,
      kWSize,
      netPPW,
      hasSetter,
      selectedSetterId,
      targetEarning,
    };

    setQuickFillValue('');
    setQuickFillSoldDate('');
    setQuickFillRepId(null);
    setInstaller('');
    setSolarTechFamily('');
    setSolarTechProductId('');
    setPcProductId('');
    setPcSelectedFamily('');
    setKWSize('');
    setNetPPW('');
    setHasSetter(false);
    setSelectedSetterId('');
    setTargetEarning('');

    toast('Form cleared', 'info', {
      label: 'Undo',
      onClick: () => {
        setQuickFillValue(snapshot.quickFillValue);
        setQuickFillSoldDate(snapshot.quickFillSoldDate);
        setQuickFillRepId(snapshot.quickFillRepId);
        setInstaller(snapshot.installer);
        setSolarTechFamily(snapshot.solarTechFamily);
        setSolarTechProductId(snapshot.solarTechProductId);
        setPcProductId(snapshot.pcProductId);
        setPcSelectedFamily(snapshot.pcSelectedFamily);
        setKWSize(snapshot.kWSize);
        setNetPPW(snapshot.netPPW);
        setHasSetter(snapshot.hasSetter);
        setSelectedSetterId(snapshot.selectedSetterId);
        setTargetEarning(snapshot.targetEarning);
      },
    });
  };

  const kW = parseFloat(kWSize) || 0;
  const soldPPW = parseFloat(netPPW) || 0;

  const isSolarTech = installer === 'SolarTech';
  const pcConfig = productCatalogInstallerConfigs[installer] ?? null;
  const isPcInstaller = pcConfig !== null;

  // Products for the selected SolarTech family
  const solarTechFamilyProducts = solarTechFamily
    ? solarTechProducts.filter((p) => p.family === solarTechFamily)
    : [];
  const hasSolarTechProducts = solarTechFamilyProducts.length > 0;

  // Products for selected PC installer family
  const pcFamilyProducts = isPcInstaller && pcSelectedFamily
    ? productCatalogProducts.filter((p) => p.installer === installer && p.family === pcSelectedFamily)
    : [];

  const hasInput = installer && kW > 0 && (
    isSolarTech ? (solarTechFamily && solarTechProductId) :
    isPcInstaller ? (pcSelectedFamily && pcProductId) :
    true
  );

  const { closerPerW, setterBaselinePerW, kiloPerW } = (() => {
    if (!hasInput) return { closerPerW: 0, setterBaselinePerW: 0, kiloPerW: 0 };
    if (isSolarTech) {
      const b = getSolarTechBaseline(solarTechProductId, kW, solarTechProducts);
      return { closerPerW: b.closerPerW, setterBaselinePerW: b.setterPerW, kiloPerW: b.kiloPerW };
    }
    if (isPcInstaller) {
      const pricingDate = quickFillSoldDate || new Date().toISOString().split('T')[0];
      const b = getProductCatalogBaselineVersioned(productCatalogProducts, pcProductId, kW, pricingDate, productCatalogPricingVersions);
      return { closerPerW: b.closerPerW, setterBaselinePerW: b.setterPerW, kiloPerW: b.kiloPerW };
    }
    const pricingDate = quickFillSoldDate || new Date().toISOString().split('T')[0];
    const r = getInstallerRatesForDeal(installer, pricingDate, kW, installerPricingVersions);
    return { closerPerW: r.closerPerW, kiloPerW: r.kiloPerW, setterBaselinePerW: r.setterPerW };
  })();

  const kiloTotal = soldPPW > 0 ? calculateCommission(closerPerW, kiloPerW, kW) : 0;

  // Trainer override — uses the selected setter's trainer assignment
  const effectiveSetterId = hasSetter && selectedSetterId ? selectedSetterId : null;
  const setterAssignment = effectiveSetterId
    ? trainerAssignments.find((a) => a.traineeId === effectiveSetterId)
    : null;
  const setterDealCount = effectiveSetterId
    ? projects.filter((p) => {
        const pct = installerPayConfigs[p.installer]?.installPayPct ?? INSTALLER_PAY_CONFIGS[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
        const fullyPaid = pct < 100 ? p.m3Paid === true : p.m2Paid === true;
        return (p.setterId === effectiveSetterId || p.repId === effectiveSetterId) && fullyPaid;
      }).length
    : 0;
  const trainerRate = setterAssignment ? getTrainerOverrideRate(setterAssignment, setterDealCount) : 0;
  const trainerRep = setterAssignment ? reps.find((r) => r.id === setterAssignment.trainerId) : null;
  const selectedSetterRep = effectiveSetterId ? reps.find((r) => r.id === effectiveSetterId) : null;
  const trainerTotal = hasSetter && trainerRate > 0 && kW > 0
    ? Math.round(trainerRate * kW * 1000 * 100) / 100
    : 0;

  // Closer trainer assignment — use the Quick Fill rep when an admin models another rep's deal
  const effectiveCloserId = quickFillRepId ?? currentRepId;
  const closerAssignment = effectiveCloserId
    ? trainerAssignments.find((a) => a.traineeId === effectiveCloserId)
    : null;
  const closerDealCount = effectiveCloserId
    ? projects.filter((p) => {
        const pct = installerPayConfigs[p.installer]?.installPayPct ?? INSTALLER_PAY_CONFIGS[p.installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
        const fullyPaid = pct < 100 ? p.m3Paid === true : p.m2Paid === true;
        return (p.repId === effectiveCloserId || p.setterId === effectiveCloserId) && fullyPaid;
      }).length
    : 0;
  const closerTrainerRate = closerAssignment ? getTrainerOverrideRate(closerAssignment, closerDealCount) : 0;
  const closerTrainerRep = closerAssignment ? reps.find((r) => r.id === closerAssignment.trainerId) : null;
  const closerTrainerTotal = closerTrainerRate > 0 && kW > 0
    ? Math.round(closerTrainerRate * kW * 1000 * 100) / 100
    : 0;

  const isSelfGen = !hasSetter || !selectedSetterId || setterBaselinePerW === 0;
  const installPayPct = installerPayConfigs[installer]?.installPayPct ?? INSTALLER_PAY_CONFIGS[installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT;
  const hasM3Split = installPayPct < 100;
  const { closerTotal, setterTotal, closerM1, closerM2, closerM3, setterM1, setterM2, setterM3 } =
    splitCloserSetterPay(soldPPW, closerPerW, isSelfGen ? 0 : setterBaselinePerW, trainerRate, kW, installPayPct);

  /** Copies a formatted deal summary to the clipboard with a toast confirmation. */
  const handleCopyResult = () => {
    const parts = [
      `Deal: ${kW.toFixed(1)} kW @ $${soldPPW.toFixed(2)}/W`,
      `— Closer: $${closerTotal.toLocaleString()} (M1: $${closerM1.toLocaleString()}, M2: $${closerM2.toLocaleString()}${hasM3Split ? `, M3: $${closerM3.toLocaleString()}` : ''})`,
    ];
    if (hasSetter && setterTotal > 0) {
      parts.push(`· Setter: $${setterTotal.toLocaleString()} (M1: $${setterM1.toLocaleString()}, M2: $${setterM2.toLocaleString()}${hasM3Split ? `, M3: $${setterM3.toLocaleString()}` : ''})`);
    }
    navigator.clipboard.writeText(parts.join(' ')).then(
      () => toast('Summary copied to clipboard', 'success'),
      () => toast('Could not access clipboard', 'error'),
    );
  };

  /** Copies a comprehensive share-ready summary to the clipboard. */
  const handleShareResult = () => {
    const lines = [
      `Commission Calc — ${installer}`,
      `${kW.toFixed(1)} kW @ $${soldPPW.toFixed(2)}/W`,
      `Closer: $${closerTotal.toLocaleString()} (M1: $${closerM1.toLocaleString()} / M2: $${closerM2.toLocaleString()}${hasM3Split ? ` / M3: $${closerM3.toLocaleString()}` : ''})`,
    ];
    if (hasSetter && setterTotal > 0) {
      lines.push(`Setter: $${setterTotal.toLocaleString()}${hasM3Split ? ` (M1: $${setterM1.toLocaleString()} / M2: $${setterM2.toLocaleString()} / M3: $${setterM3.toLocaleString()})` : ''}`);
    }
    lines.push(`Baseline: $${closerPerW.toFixed(2)}/W | Break-even: $${breakEvenPPW.toFixed(2)}/W`);
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => toast('Share summary copied to clipboard', 'success'),
      () => toast('Could not access clipboard', 'error'),
    );
  };

  /** Copies a shareable URL with calculator inputs encoded as search params. */
  const handleShareURL = () => {
    const params = new URLSearchParams();
    if (installer) params.set('installer', installer);
    if (kWSize) params.set('kW', kWSize);
    if (netPPW) params.set('ppw', netPPW);
    if (solarTechFamily) params.set('stFamily', solarTechFamily);
    if (solarTechProductId) params.set('stProduct', solarTechProductId);
    if (pcSelectedFamily) params.set('pcFamily', pcSelectedFamily);
    if (pcProductId) params.set('pcProduct', pcProductId);
    if (hasSetter) params.set('setter', '1');
    const url = `${window.location.origin}/dashboard/calculator?${params.toString()}`;
    navigator.clipboard.writeText(url).then(
      () => toast('Link copied!', 'success'),
      () => toast('Could not access clipboard', 'error'),
    );
  };

  /** Loads a history entry back into the form. */
  const handleLoadHistory = (entry: CalcHistoryEntry) => {
    setInstaller(entry.installer);
    setKWSize(String(entry.kW));
    setNetPPW(String(entry.ppw));
    setHasSetter(entry.hasSetter);
    setSelectedSetterId(entry.selectedSetterId ?? '');
    if (entry.solarTechFamily) {
      setSolarTechFamily(entry.solarTechFamily);
      setSolarTechProductId(entry.solarTechProductId ?? '');
      setPcSelectedFamily('');
      setPcProductId('');
    } else if (entry.pcFamily) {
      setPcSelectedFamily(entry.pcFamily);
      setPcProductId(entry.pcProductId ?? '');
      setSolarTechFamily('');
      setSolarTechProductId('');
    } else {
      setSolarTechFamily('');
      setSolarTechProductId('');
      setPcSelectedFamily('');
      setPcProductId('');
    }
    setHistoryOpen(false);
    toast('Loaded from history', 'info');
  };

  const handleClearHistory = () => {
    setCalcHistory([]);
    saveCalcHistory([]);
    toast('History cleared', 'info');
  };

  // Break-even PPW (minimum PPW to earn anything as closer)
  const breakEvenPPW = closerPerW;
  // PPW needed to earn a target amount
  const targetAmount = parseFloat(targetEarning) || 0;
  const requiredPPW = (() => {
    if (!hasInput || kW <= 0) return 0;
    if (!isSelfGen) {
      // With setter: closer earns the differential band + half of everything above splitPoint.
      // Reverse-solve: if target fits within the differential band, use simple formula;
      // otherwise solve for the PPW where half-of-above-split makes up the remainder.
      const closerDiff = (setterBaselinePerW - closerPerW) * kW * 1000;
      if (targetAmount <= closerDiff) {
        return targetAmount / (kW * 1000) + closerPerW;
      }
      const splitPoint = setterBaselinePerW + trainerRate;
      return ((targetAmount - closerDiff) * 2) / (kW * 1000) + splitPoint;
    }
    return targetAmount / (kW * 1000) + closerPerW;
  })();

  // Hash of all inputs — forces React to remount the results container on each
  // new calculation, replaying the slide-in-scale stagger entrance animation.
  const resultHash = `${installer}|${solarTechProductId}|${pcProductId}|${kWSize}|${netPPW}|${hasSetter ? '1' : '0'}|${selectedSetterId}|${quickFillSoldDate}`;

  // Save to history when a full calculation is displayed
  useEffect(() => {
    if (!hasInput || soldPPW <= 0 || closerTotal <= 0) return;
    const hash = resultHash;
    if (hash === lastSavedHash.current) return;
    lastSavedHash.current = hash;

    const entry: CalcHistoryEntry = {
      installer,
      ...(isSolarTech && solarTechFamily ? { solarTechFamily, solarTechProductId } : {}),
      ...(isPcInstaller && pcSelectedFamily ? { pcFamily: pcSelectedFamily, pcProductId } : {}),
      kW,
      ppw: soldPPW,
      hasSetter,
      selectedSetterId: selectedSetterId || undefined,
      closerTotal,
      setterTotal,
      trainerTotal,
      timestamp: Date.now(),
    };

    setCalcHistory((prev) => {
      const next = [entry, ...prev.filter((e) =>
        !(e.installer === entry.installer && e.kW === entry.kW && e.ppw === entry.ppw &&
          e.solarTechProductId === entry.solarTechProductId && e.pcProductId === entry.pcProductId)
      )].slice(0, MAX_HISTORY);
      saveCalcHistory(next);
      return next;
    });
  }, [resultHash, hasInput, soldPPW, closerTotal]);


  const inputCls = 'w-full rounded-xl px-4 py-2.5 text-sm focus:outline-none transition-all duration-200 placeholder-slate-500';
  const inputStyle: CSSProperties = { background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-primary)', fontFamily: "'DM Sans', sans-serif" };
  const inputFocusRing = 'focus:ring-2 focus:ring-[var(--accent-green)]/50 focus:border-[var(--accent-green)]';
  const labelCls = 'block text-xs font-medium mb-1.5 uppercase tracking-wider';
  const labelStyle: CSSProperties = { color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" };

  // Animated dollar counters — always called (hook rules), values are 0 when not shown
  const animatedCloserTotal  = useCountUp(closerTotal);
  const animatedSetterTotal  = useCountUp(setterTotal);
  const animatedTrainerTotal        = useCountUp(trainerTotal);
  const animatedCloserTrainerTotal  = useCountUp(closerTrainerTotal);
  const animatedKiloTotal           = useCountUp(kiloTotal);

  const isMobile = useMediaQuery('(max-width: 767px)');
  if (effectiveRole === 'project_manager') {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <p className="text-[var(--text-muted)] text-sm">You don&apos;t have permission to view this page.</p>
      </div>
    );
  }

  if (isMobile) return <MobileCalculator />;

  if (!isHydrated) return <CalculatorSkeleton />;

  // Compute hasData for the right panel
  const hasData = hasInput && soldPPW > 0;
  const systemValue = kW * soldPPW * 1000;

  // Bar segment data for the stacked breakdown bar
  const breakdownSegments = [
    { key: 'closer', label: 'Closer', value: closerTotal, color: 'var(--accent-green)' },
    ...(hasSetter && setterTotal > 0 ? [{ key: 'setter', label: 'Setter', value: setterTotal, color: 'var(--accent-cyan)' }] : []),
    ...(trainerTotal > 0 ? [{ key: 'trainer', label: 'Trainer Override', value: trainerTotal, color: '#b47dff' }] : []),
    ...(closerTrainerTotal > 0 ? [{ key: 'closerTrainer', label: 'Closer Trainer Override', value: closerTrainerTotal, color: '#b47dff' }] : []),
    ...(currentRole === 'admin' && kiloTotal > 0 ? [{ key: 'kilo', label: 'Kilo Margin', value: kiloTotal, color: 'var(--accent-amber)' }] : []),
  ].filter(s => s.value > 0);
  const breakdownTotal = breakdownSegments.reduce((s, seg) => s + seg.value, 0);

  return (
    <div className="p-4 md:p-8 animate-fade-in-up" style={{ maxWidth: 1200 }}>
      <Breadcrumb items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Calculator' }]} />
      <div className="mb-8">
        <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
            <Calculator className="w-5 h-5 text-[var(--accent-green)]" />
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight" style={{ fontFamily: "'DM Serif Display', serif", color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Commission Calculator</h1>
        </div>
        <p className="text-sm font-medium ml-12 tracking-wide" style={{ color: 'var(--text-muted)' }}>Run numbers before you close — know your earning before you pitch.</p>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
        {/* Left: form — 420px */}
        <div style={{ flex: '0 0 420px' }}>
          {/* Quick Fill card */}
          {recentDeals.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 16, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <Zap className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent-cyan)' }} />
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--accent-cyan)', fontFamily: "'DM Sans', sans-serif" }}>Quick Fill</span>
              </div>
              <div className="flex items-center gap-2">
                <SearchableSelect
                  value={quickFillValue}
                  onChange={handleQuickFill}
                  options={recentDeals.map((proj) => ({
                    value: proj.id,
                    label: `${proj.customerName} · ${proj.kWSize.toFixed(1)} kW · $${proj.netPPW.toFixed(2)} PPW`,
                  }))}
                  placeholder="-- Quick fill from recent deal --"
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={handleReset}
                  title="Clear all fields"
                  className="flex-shrink-0 p-2 rounded-lg hover:text-white transition-colors"
                  style={{ background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Main form card */}
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, marginBottom: 12 }} className="space-y-5 overflow-visible relative z-20">
            <div>
              <label htmlFor="calc-installer" className={labelCls} style={labelStyle}>
                Installer
                <FieldTooltip text="The installation company handling this project. Rates vary by installer." />
              </label>
              <div ref={installerRef}>
                <SearchableSelect
                  id="calc-installer"
                  value={installer}
                  onChange={(val) => {
                    setInstaller(val);
                    setSolarTechFamily('');
                    setSolarTechProductId('');
                    setPcProductId('');
                    setPcSelectedFamily('');
                  }}
                  options={activeInstallers.map((i) => ({ value: i, label: i }))}
                  placeholder="-- Select installer --"
                />
              </div>
            </div>

            {isSolarTech && (
              <div className="space-y-4">
                <div>
                  <label className={labelCls} style={labelStyle}>Financing Family</label>
                  <div ref={stFamilyRef}>
                    <SearchableSelect
                      value={solarTechFamily}
                      onChange={(val) => { setSolarTechFamily(val); setSolarTechProductId(''); }}
                      options={SOLARTECH_FAMILIES.map((f) => ({
                        value: f,
                        label: `${f} (${SOLARTECH_FAMILY_FINANCER[f]})`,
                      }))}
                      placeholder="-- Select family --"
                    />
                  </div>
                </div>
                {solarTechFamily && hasSolarTechProducts && (
                  <div>
                    <label className={labelCls} style={labelStyle}>Equipment Package</label>
                    <div ref={stProductRef}>
                      <SearchableSelect
                        value={solarTechProductId}
                        onChange={setSolarTechProductId}
                        options={solarTechFamilyProducts.map((p) => ({
                          value: p.id,
                          label: p.name,
                        }))}
                        placeholder="-- Select package --"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {isPcInstaller && pcConfig && (
              <div className="space-y-4">
                <div>
                  <label className={labelCls} style={labelStyle}>Financing Family</label>
                  <div ref={pcFamilyRef}>
                    <SearchableSelect
                      value={pcSelectedFamily}
                      onChange={(val) => { setPcSelectedFamily(val); setPcProductId(''); }}
                      options={pcConfig.families.map((f) => ({ value: f, label: f }))}
                      placeholder="-- Select family --"
                    />
                  </div>
                </div>
                {pcSelectedFamily && pcFamilyProducts.length > 0 && (
                  <div>
                    <label className={labelCls} style={labelStyle}>Equipment Package</label>
                    <div ref={pcProductRef}>
                      <SearchableSelect
                        value={pcProductId}
                        onChange={setPcProductId}
                        options={pcFamilyProducts.map((p) => ({
                          value: p.id,
                          label: p.name,
                        }))}
                        placeholder="-- Select package --"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="calc-system-size" className={labelCls} style={labelStyle}>
                  System Size (kW)
                  <FieldTooltip text="Total system size in kilowatts. Larger systems = higher commission." />
                </label>
                <input
                  id="calc-system-size"
                  ref={kWSizeRef}
                  type="number" step="0.1" min="0" placeholder="e.g. 8.4"
                  value={kWSize} onChange={(e) => setKWSize(e.target.value)}
                  className={`${inputCls} ${inputFocusRing}`} style={inputStyle}
                />
              </div>
              <div>
                <label className={labelCls} style={labelStyle}>
                  Sold PPW ($/W)
                  <FieldTooltip text="Price Per Watt -- the rate you sold the system at. Must be above baseline to earn commission." />
                </label>
                <input
                  ref={netPPWRef}
                  type="number" step="0.01" min="0" placeholder="e.g. 3.45"
                  value={netPPW} onChange={(e) => setNetPPW(e.target.value)}
                  className={`${inputCls} ${inputFocusRing}`} style={inputStyle}
                />
              </div>
            </div>

            <div className="space-y-3 overflow-visible relative z-10">
              <label className="flex items-center gap-3 cursor-pointer select-none">
                <div
                  onClick={() => { setHasSetter((v) => { if (v) setSelectedSetterId(''); return !v; }); }}
                  className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${hasSetter ? 'bg-[var(--accent-green)]' : 'bg-[var(--border)]'}`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${hasSetter ? 'translate-x-5' : 'translate-x-0.5'}`} />
                </div>
                <span className="text-[var(--text-secondary)] text-sm">Include setter</span>
              </label>

              {hasSetter && (
                <div>
                  <label className={labelCls} style={labelStyle}>
                    Setter
                    <FieldTooltip text="Select a setter to factor in their trainer assignment and baseline split." />
                  </label>
                  <RepSelector
                    value={selectedSetterId}
                    onChange={setSelectedSetterId}
                    reps={reps}
                    placeholder="-- Select setter --"
                    clearLabel="No setter"
                    filterFn={(r) => r.active && (r.repType === 'setter' || r.repType === 'both') && (r.id !== effectiveCloserId || reps.find((rep) => rep.id === currentRepId)?.repType === 'setter')}
                    renderExtra={(r) => {
                      const ta = trainerAssignments.find((a) => a.traineeId === r.id);
                      const trainerName = ta ? reps.find((tr) => tr.id === ta.trainerId)?.name : null;
                      return trainerName ? (
                        <span className="text-amber-400 text-[10px] font-medium flex-shrink-0">* {trainerName}</span>
                      ) : null;
                    }}
                  />
                </div>
              )}
            </div>

            {/* Target earnings tool */}
            {hasInput && (
              <>
                <div style={{ height: 1, background: 'linear-gradient(to right, transparent, var(--border-subtle), transparent)' }} />
                <div>
                  <p className="text-xs uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif" }}>PPW Needed for Target Earning</p>
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <input
                        type="number"
                        placeholder="Target $ (e.g. 2000)"
                        value={targetEarning}
                        onChange={(e) => setTargetEarning(e.target.value)}
                        className={`${inputCls} ${inputFocusRing}`} style={inputStyle}
                      />
                    </div>
                    <div className="text-right min-w-[100px]">
                      {targetEarning.trim() !== '' && closerPerW === 0 ? (
                        <p style={{ color: 'var(--accent-amber)', fontSize: 12 }}>Baseline unknown</p>
                      ) : targetEarning.trim() !== '' && requiredPPW > 0 ? (
                        <>
                          <p style={{ color: 'var(--accent-blue)', fontWeight: 700, fontSize: 20, fontFamily: "'DM Serif Display', serif" }}>${requiredPPW.toFixed(2)}<span style={{ color: 'var(--text-dim)', fontSize: 12, fontWeight: 400 }}>/W</span></p>
                          <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>required PPW</p>
                        </>
                      ) : (
                        <p style={{ color: 'var(--text-dim)', fontSize: 14 }}>--</p>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Recent Calcs card */}
          {calcHistory.length > 0 && (
            <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16 }}>
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5" style={{ color: 'var(--text-dim)' }} />
                  <span style={{ color: 'var(--text-dim)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>Recent Calcs</span>
                  <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>({calcHistory.length})</span>
                </div>
                {historyOpen ? (
                  <ChevronUp className="w-4 h-4" style={{ color: 'var(--text-dim)' }} />
                ) : (
                  <ChevronDown className="w-4 h-4" style={{ color: 'var(--text-dim)' }} />
                )}
              </button>
              {historyOpen && (
                <div className="px-4 pb-3 space-y-2">
                  {calcHistory.map((entry, i) => (
                    <div
                      key={`${entry.timestamp}-${i}`}
                      className="flex items-center justify-between gap-3 rounded-lg px-3 py-2"
                      style={{ background: 'var(--surface-card)', border: '1px solid var(--border)' }}
                    >
                      <div className="min-w-0 flex-1">
                        <p style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 500 }} className="truncate">
                          {entry.installer} -- {entry.kW.toFixed(1)} kW @ ${entry.ppw.toFixed(2)}/W
                        </p>
                        <p style={{ color: 'var(--text-dim)', fontSize: 12 }}>
                          Closer: ${entry.closerTotal.toLocaleString()}
                          {entry.hasSetter && entry.setterTotal > 0 ? ` · Setter: $${entry.setterTotal.toLocaleString()}` : ''}
                          {entry.trainerTotal > 0 ? ` · Trainer: $${entry.trainerTotal.toLocaleString()}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLoadHistory(entry)}
                        className="flex-shrink-0 text-xs font-medium rounded-md px-2.5 py-1 transition-colors"
                        style={{ color: 'var(--accent-blue)', background: 'rgba(77,159,255,0.1)' }}
                      >
                        Load
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    className="flex items-center gap-1.5 text-xs transition-colors mt-1"
                    style={{ color: 'var(--text-dim)' }}
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear History
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: live breakdown — flex:1, sticky */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, position: 'sticky', top: 16 }}>
            <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif", fontWeight: 700, marginBottom: 20 }}>Live Breakdown</p>

            {hasData ? (
              <div key={resultHash}>
                {/* System Value */}
                <p style={{ fontSize: 32, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif", letterSpacing: '-0.03em', marginBottom: 4 }}>
                  ${Math.round(systemValue).toLocaleString()}
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: "'DM Sans', sans-serif", marginBottom: 20 }}>
                  {kW.toFixed(1)} kW x ${soldPPW.toFixed(2)} PPW x 1,000
                </p>

                {/* Below-baseline warning */}
                {soldPPW <= closerPerW && (
                  <div style={{ background: 'rgba(255,82,82,0.08)', border: '1px solid rgba(255,82,82,0.25)', borderLeft: '3px solid var(--accent-red)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--accent-red)' }}>
                    PPW is at or below baseline -- no commission earned at this price.
                  </div>
                )}

                {/* Tier gap warning — baselines couldn't be resolved for this kW size */}
                {closerPerW === 0 && soldPPW > 0 && (
                  <div style={{ background: 'rgba(255,176,32,0.08)', border: '1px solid rgba(255,176,32,0.3)', borderLeft: '3px solid var(--accent-amber)', borderRadius: 10, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: 'var(--accent-amber)' }}>
                    No pricing tier found for {kW.toFixed(1)} kW — baselines could not be resolved. Results below are unreliable. Select a product or check that a tier covers this system size.
                  </div>
                )}

                {/* Stacked bar */}
                {breakdownTotal > 0 && (
                  <div style={{ display: 'flex', height: 8, borderRadius: 99, overflow: 'hidden', marginBottom: 20 }}>
                    {breakdownSegments.map((seg) => (
                      <div key={seg.key} style={{ width: `${(seg.value / breakdownTotal) * 100}%`, background: seg.color, transition: 'width 0.5s ease-out' }} />
                    ))}
                  </div>
                )}

                {/* Baseline rates row */}
                <div style={{ display: 'flex', gap: 16, marginBottom: 20, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}>${closerPerW.toFixed(2)}<span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>/W</span></p>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Closer Baseline</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}>${setterBaselinePerW.toFixed(2)}<span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>/W</span></p>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Setter Baseline</p>
                  </div>
                  <div>
                    <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}>${breakEvenPPW.toFixed(2)}<span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 400 }}>/W</span></p>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Break-Even</p>
                  </div>
                </div>

                {/* Line items */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                  {/* Closer */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-green)', flexShrink: 0 }} />
                      <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif" }}>Closer Pay</span>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}>${animatedCloserTotal.toLocaleString()}</span>
                      {breakdownTotal > 0 && <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 6 }}>{Math.round((closerTotal / breakdownTotal) * 100)}%</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 5, marginLeft: 16, marginTop: 4 }}>
                    <div style={{ flex: 1, background: 'var(--surface-card)', border: '1px solid var(--border)', borderLeft: '2px solid var(--accent-green)', borderRadius: 7, padding: '5px 8px' }}>
                      <p style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>M1 · Acceptance</p>
                      <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}>${closerM1.toLocaleString()}</p>
                    </div>
                    <div style={{ flex: 1, background: 'var(--surface-card)', border: '1px solid var(--border)', borderLeft: '2px solid var(--accent-green)', borderRadius: 7, padding: '5px 8px' }}>
                      <p style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>M2 · Installed</p>
                      <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}>${closerM2.toLocaleString()}</p>
                    </div>
                    {hasM3Split && (
                      <div style={{ flex: 1, background: 'var(--surface-card)', border: '1px solid var(--border)', borderLeft: '2px solid var(--text-muted)', borderRadius: 7, padding: '5px 8px' }}>
                        <p style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>M3 · PTO</p>
                        <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}>${closerM3.toLocaleString()}</p>
                      </div>
                    )}
                  </div>

                  {/* Setter */}
                  {hasSetter && setterTotal > 0 && (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-cyan)', flexShrink: 0 }} />
                          <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif" }}>Setter Pay{selectedSetterRep ? ` -- ${selectedSetterRep.name}` : ''}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}>${animatedSetterTotal.toLocaleString()}</span>
                          {breakdownTotal > 0 && <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 6 }}>{Math.round((setterTotal / breakdownTotal) * 100)}%</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 5, marginLeft: 16, marginTop: 4 }}>
                        <div style={{ flex: 1, background: 'var(--surface-card)', border: '1px solid var(--border)', borderLeft: '2px solid var(--accent-cyan)', borderRadius: 7, padding: '5px 8px' }}>
                          <p style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>M1 · Acceptance</p>
                          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}>${setterM1.toLocaleString()}</p>
                        </div>
                        <div style={{ flex: 1, background: 'var(--surface-card)', border: '1px solid var(--border)', borderLeft: '2px solid var(--accent-cyan)', borderRadius: 7, padding: '5px 8px' }}>
                          <p style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>M2 · Installed</p>
                          <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}>${setterM2.toLocaleString()}</p>
                        </div>
                        {hasM3Split && (
                          <div style={{ flex: 1, background: 'var(--surface-card)', border: '1px solid var(--border)', borderLeft: '2px solid var(--text-muted)', borderRadius: 7, padding: '5px 8px' }}>
                            <p style={{ fontSize: 10, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>M3 · PTO</p>
                            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}>${setterM3.toLocaleString()}</p>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Setter Trainer */}
                  {trainerRep && trainerTotal > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#b47dff', flexShrink: 0 }} />
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif" }}>Trainer: {trainerRep.name}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}>${animatedTrainerTotal.toLocaleString()}</span>
                        {breakdownTotal > 0 && <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 6 }}>{Math.round((trainerTotal / breakdownTotal) * 100)}%</span>}
                      </div>
                    </div>
                  )}

                  {/* Closer Trainer */}
                  {closerTrainerRep && closerTrainerTotal > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#b47dff', flexShrink: 0 }} />
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif" }}>Trainer: {closerTrainerRep.name}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}>${animatedCloserTrainerTotal.toLocaleString()}</span>
                        {breakdownTotal > 0 && <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 6 }}>{Math.round((closerTrainerTotal / breakdownTotal) * 100)}%</span>}
                      </div>
                    </div>
                  )}

                  {/* Kilo Margin (admin) */}
                  {currentRole === 'admin' && kiloTotal > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-amber)', flexShrink: 0 }} />
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: "'DM Sans', sans-serif" }}>Kilo Margin</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', fontFamily: "'DM Serif Display', serif" }}>${animatedKiloTotal.toLocaleString()}</span>
                        {breakdownTotal > 0 && <span style={{ fontSize: 10, color: 'var(--text-dim)', marginLeft: 6 }}>{Math.round((kiloTotal / breakdownTotal) * 100)}%</span>}
                      </div>
                    </div>
                  )}
                </div>

                {/* Your Commission highlight */}
                <div style={{
                  background: 'linear-gradient(135deg, #00160d, #001c10)',
                  border: '1px solid #00e07a35',
                  borderRadius: 14,
                  padding: '18px 20px',
                  position: 'relative',
                  overflow: 'hidden',
                }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: 'linear-gradient(90deg, var(--accent-green), transparent 70%)' }} />
                  <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'var(--text-muted)', fontFamily: "'DM Sans', sans-serif", fontWeight: 700, marginBottom: 8 }}>Your Commission</p>
                  <p style={{ fontSize: 44, fontWeight: 700, color: 'var(--accent-green)', fontFamily: "'DM Serif Display', serif", letterSpacing: '-0.03em', textShadow: '0 0 20px #00e07a50', lineHeight: 1 }}>
                    ${(reps.find((r) => r.id === effectiveCloserId)?.repType === 'setter' ? animatedSetterTotal : animatedCloserTotal).toLocaleString()}
                  </p>
                </div>

                {/* Share actions */}
                <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                  <button type="button" onClick={handleCopyResult} title="Copy deal summary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', transition: 'color 0.2s' }}>
                    <ClipboardCopy className="w-3.5 h-3.5" /> Copy
                  </button>
                  <button type="button" onClick={handleShareResult} title="Copy share summary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', transition: 'color 0.2s' }}>
                    <Share2 className="w-3.5 h-3.5" /> Share
                  </button>
                  <button type="button" onClick={handleShareURL} title="Copy shareable URL" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 8, background: 'var(--surface-card)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: 12, cursor: 'pointer', transition: 'color 0.2s' }}>
                    <Link2 className="w-3.5 h-3.5" /> Link
                  </button>
                </div>
              </div>
            ) : hasInput && soldPPW <= 0 ? (
              /* Has inputs but no PPW */
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', gap: 12, textAlign: 'center' }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--surface-card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Zap className="w-6 h-6 animate-pulse" style={{ color: 'var(--text-dim)' }} />
                </div>
                <p style={{ color: 'var(--text-muted)', fontSize: 14, fontFamily: "'DM Sans', sans-serif" }}>Enter a sold PPW to see your commission breakdown</p>
              </div>
            ) : (
              /* Empty state */
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 0', gap: 12, textAlign: 'center' }}>
                <div style={{ width: 48, height: 48, borderRadius: '50%', background: 'var(--surface-card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Calculator className="w-6 h-6" style={{ color: 'var(--text-dim)' }} />
                </div>
                <div>
                  <p style={{ color: 'var(--text-secondary)', fontSize: 14, fontWeight: 600, fontFamily: "'DM Sans', sans-serif" }}>Enter system size and PPW</p>
                  <p style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: "'DM Sans', sans-serif", marginTop: 4 }}>Your live commission breakdown will appear here</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CalculatorSkeleton() {
  return (
    <div className="p-4 md:p-8 max-w-2xl">
      {/* Page header shimmer */}
      <div className="mb-8">
        <div className="h-[3px] w-12 rounded-full bg-[var(--border)] animate-skeleton mb-3" />
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-9 w-9 bg-[var(--surface-card)] rounded-lg animate-skeleton"
            style={{ animationDelay: '50ms' }}
          />
          <div
            className="h-8 w-56 bg-[var(--surface-card)] rounded animate-skeleton"
            style={{ animationDelay: '100ms' }}
          />
        </div>
        <div
          className="h-3 w-72 bg-[var(--surface-card)]/70 rounded animate-skeleton ml-12 mt-1"
          style={{ animationDelay: '150ms' }}
        />
      </div>

      {/* Form section — 4 input field placeholders (label + input bar) */}
      <div className="card-surface rounded-2xl p-6 space-y-5 mb-6 overflow-visible">
        {[
          { labelW: 'w-16', delay: 0 },
          { labelW: 'w-24', delay: 75 },
          { labelW: 'w-20', delay: 150 },
          { labelW: 'w-20', delay: 225 },
        ].map(({ labelW, delay }, i) => (
          <div key={i}>
            <div
              className={`h-3 ${labelW} bg-[var(--border)]/70 rounded animate-skeleton mb-2`}
              style={{ animationDelay: `${delay}ms` }}
            />
            <div
              className="h-10 w-full bg-[var(--surface-card)] rounded-xl animate-skeleton"
              style={{ animationDelay: `${delay + 30}ms` }}
            />
          </div>
        ))}
      </div>

      {/* Results panel — 3 stat-card-sized shimmer blocks */}
      <div className="space-y-4">
        {[
          { delay: 0,   bodyH: 'h-16' },
          { delay: 75,  bodyH: 'h-24' },
          { delay: 150, bodyH: 'h-16' },
        ].map(({ delay, bodyH }, i) => (
          <div
            key={i}
            className="card-surface rounded-2xl p-5"
          >
            {/* Card label row */}
            <div
              className="h-3 w-28 bg-[var(--border)]/50 rounded animate-skeleton mb-4"
              style={{ animationDelay: `${delay}ms` }}
            />
            {/* Card body shimmer */}
            <div
              className={`${bodyH} w-full bg-[var(--surface-card)]/70 rounded-xl animate-skeleton`}
              style={{ animationDelay: `${delay + 50}ms` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
