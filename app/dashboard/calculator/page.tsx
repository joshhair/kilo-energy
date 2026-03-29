'use client';

import { useState, useEffect, useRef, type CSSProperties } from 'react';
import { useApp } from '../../../lib/context';
import { useIsHydrated } from '../../../lib/hooks';
import { getSolarTechBaseline, calculateCommission, getTrainerOverrideRate, SOLARTECH_FAMILIES, SOLARTECH_FAMILY_FINANCER, SOLARTECH_PRODUCTS, getInstallerRatesForDeal, getProductCatalogBaseline, INSTALLER_PAY_CONFIGS, DEFAULT_INSTALL_PAY_PCT } from '../../../lib/data';
import { Calculator, Zap, RotateCcw, ClipboardCopy, HelpCircle, Share2, ChevronDown, ChevronUp, Clock, Trash2 } from 'lucide-react';
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
      <HelpCircle className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 cursor-pointer transition-colors flex-shrink-0" />
      {/* Tooltip bubble — hidden by default, revealed via group-hover (CSS) or open state (mobile tap) */}
      <span
        role="tooltip"
        className={[
          'pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2',
          'w-56 bg-slate-700 border border-slate-600 text-slate-200',
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
    { key: 'closer',  value: closer,  colorClass: 'bg-blue-500',    label: 'Closer'   },
    { key: 'setter',  value: setter,  colorClass: 'bg-emerald-500', label: 'Setter'   },
    { key: 'trainer', value: trainer, colorClass: 'bg-amber-500',   label: 'Trainer'  },
    ...(showKilo ? [{ key: 'kilo', value: kilo, colorClass: 'bg-slate-500', label: 'Kilo Rev' }] : []),
  ].filter((s) => s.value > 0);

  return (
    <div className="mt-4 space-y-2">
      <div className="h-3 rounded-full bg-slate-800 overflow-hidden flex">
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
            <span className="text-slate-500 text-xs">{seg.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function CalculatorPage() {
  const isHydrated = useIsHydrated();
  const { currentRepId, currentRole, trainerAssignments, projects, activeInstallers, reps, installerPricingVersions, productCatalogInstallerConfigs, productCatalogProducts } = useApp();
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

  const { toast } = useToast();

  // ── Recent Calc History (localStorage) ────────────────────────────────────
  const [calcHistory, setCalcHistory] = useState<CalcHistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const lastSavedHash = useRef('');

  // Load history once on mount
  useEffect(() => { setCalcHistory(loadCalcHistory()); }, []);

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
    const filtered = currentRole === 'admin'
      ? projects
      : projects.filter((p) => p.repId === currentRepId || p.setterId === currentRepId);
    return [...filtered]
      .sort((a, b) => b.soldDate.localeCompare(a.soldDate))
      .slice(0, 10);
  })();

  const handleQuickFill = (projectId: string) => {
    setQuickFillValue(projectId);
    if (!projectId) return;
    const proj = recentDeals.find((p) => p.id === projectId);
    if (!proj) return;
    setInstaller(proj.installer);
    setKWSize(String(proj.kWSize));
    setNetPPW(String(proj.netPPW));

    const isST = proj.installer === 'SolarTech' && !!proj.solarTechProductId;
    const isPC = !isST && !!proj.installerProductId;

    if (isST) {
      const product = SOLARTECH_PRODUCTS.find((p) => p.id === proj.solarTechProductId);
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
    ? SOLARTECH_PRODUCTS.filter((p) => p.family === solarTechFamily)
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
      const b = getSolarTechBaseline(solarTechProductId, kW);
      return { closerPerW: b.closerPerW, setterBaselinePerW: b.setterPerW, kiloPerW: b.kiloPerW };
    }
    if (isPcInstaller) {
      const b = getProductCatalogBaseline(productCatalogProducts, pcProductId, kW);
      return { closerPerW: b.closerPerW, setterBaselinePerW: b.setterPerW, kiloPerW: b.kiloPerW };
    }
    const today = new Date().toISOString().split('T')[0];
    const r = getInstallerRatesForDeal(installer, today, kW, installerPricingVersions);
    return { closerPerW: r.closerPerW, kiloPerW: r.kiloPerW, setterBaselinePerW: r.setterPerW };
  })();

  const kiloTotal = soldPPW > 0 ? calculateCommission(closerPerW, kiloPerW, kW) : 0;

  // Trainer override — uses the selected setter's trainer assignment
  const effectiveSetterId = hasSetter && selectedSetterId ? selectedSetterId : null;
  const setterAssignment = effectiveSetterId
    ? trainerAssignments.find((a) => a.traineeId === effectiveSetterId)
    : null;
  const setterDealCount = effectiveSetterId
    ? projects.filter((p) => p.repId === effectiveSetterId || p.setterId === effectiveSetterId).length
    : 0;
  const trainerRate = setterAssignment ? getTrainerOverrideRate(setterAssignment, setterDealCount) : 0;
  const trainerRep = setterAssignment ? reps.find((r) => r.id === setterAssignment.trainerId) : null;
  const selectedSetterRep = effectiveSetterId ? reps.find((r) => r.id === effectiveSetterId) : null;
  const trainerTotal = hasSetter && trainerRate > 0 && kW > 0
    ? Math.round(trainerRate * kW * 1000 * 100) / 100
    : 0;

  // Correct split: closer + setter share 50/50 from above (setterBaseline + trainerOverride).
  // No setter: closer keeps everything above their own baseline.
  const { closerTotal, setterTotal } = (() => {
    if (!hasSetter || setterBaselinePerW === 0 || soldPPW <= 0) {
      return { closerTotal: soldPPW > 0 ? calculateCommission(soldPPW, closerPerW, kW) : 0, setterTotal: 0 };
    }
    // Closer always keeps the $0.10/W spread between their redline and the setter redline
    const closerDifferential = Math.round((setterBaselinePerW - closerPerW) * kW * 1000 * 100) / 100;
    // Remaining pool above setter baseline (adjusted up by trainer override if any)
    const splitPoint = setterBaselinePerW + trainerRate;
    const aboveSplit = calculateCommission(soldPPW, splitPoint, kW);
    const half = Math.round(aboveSplit / 2);
    return { closerTotal: closerDifferential + half, setterTotal: aboveSplit - half };
  })();

  const m1Flat = kW >= 5 ? 1000 : 500;
  const isSelfGen = !hasSetter || setterBaselinePerW === 0;
  const installPayPct = (INSTALLER_PAY_CONFIGS[installer]?.installPayPct ?? DEFAULT_INSTALL_PAY_PCT);
  const hasM3Split = installPayPct < 100;
  const closerM1 = isSelfGen ? m1Flat : 0;
  const closerM2Raw = closerTotal - closerM1;
  const closerM2 = hasM3Split ? Math.round(closerM2Raw * (installPayPct / 100)) : closerM2Raw;
  const closerM3 = hasM3Split ? closerM2Raw - closerM2 : 0;
  const setterM1 = isSelfGen ? 0 : m1Flat;
  const setterM2Raw = Math.max(0, setterTotal - setterM1);
  const setterM2 = hasM3Split ? Math.round(setterM2Raw * (installPayPct / 100)) : setterM2Raw;
  const setterM3 = hasM3Split ? setterM2Raw - setterM2 : 0;

  /** Copies a formatted deal summary to the clipboard with a toast confirmation. */
  const handleCopyResult = () => {
    const parts = [
      `Deal: ${kW.toFixed(1)} kW @ $${soldPPW.toFixed(2)}/W`,
      `— Closer: $${closerTotal.toLocaleString()} (M1: $${closerM1.toLocaleString()}, M2: $${closerM2.toLocaleString()})`,
    ];
    if (hasSetter && setterTotal > 0) {
      parts.push(`· Setter: $${setterTotal.toLocaleString()} (M1: $${setterM1.toLocaleString()}, M2: $${setterM2.toLocaleString()})`);
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
      `Closer: $${closerTotal.toLocaleString()} (M1: $${closerM1.toLocaleString()} / M2: $${closerM2.toLocaleString()})`,
    ];
    if (hasSetter && setterTotal > 0) {
      lines.push(`Setter: $${setterTotal.toLocaleString()}`);
    }
    lines.push(`Baseline: $${closerPerW.toFixed(2)}/W | Break-even: $${breakEvenPPW.toFixed(2)}/W`);
    navigator.clipboard.writeText(lines.join('\n')).then(
      () => toast('Share summary copied to clipboard', 'success'),
      () => toast('Could not access clipboard', 'error'),
    );
  };

  /** Loads a history entry back into the form. */
  const handleLoadHistory = (entry: CalcHistoryEntry) => {
    setInstaller(entry.installer);
    setKWSize(String(entry.kW));
    setNetPPW(String(entry.ppw));
    setHasSetter(entry.hasSetter);
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
  const requiredPPW = hasInput && kW > 0
    ? (targetAmount / (kW * 1000)) + closerPerW
    : 0;

  // Hash of all inputs — forces React to remount the results container on each
  // new calculation, replaying the slide-in-scale stagger entrance animation.
  const resultHash = `${installer}|${solarTechProductId}|${pcProductId}|${kWSize}|${netPPW}|${hasSetter ? '1' : '0'}|${selectedSetterId}`;

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
      closerTotal,
      setterTotal,
      trainerTotal,
      timestamp: Date.now(),
    };

    setCalcHistory((prev) => {
      const next = [entry, ...prev.filter((e) =>
        !(e.installer === entry.installer && e.kW === entry.kW && e.ppw === entry.ppw)
      )].slice(0, MAX_HISTORY);
      saveCalcHistory(next);
      return next;
    });
  }, [resultHash, hasInput, soldPPW, closerTotal]);


  const inputCls = 'w-full bg-slate-800 border border-slate-700 text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none transition-all duration-200 input-focus-glow placeholder-slate-500';
  const labelCls = 'block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider';

  // Animated dollar counters — always called (hook rules), values are 0 when not shown
  const animatedCloserTotal  = useCountUp(closerTotal);
  const animatedSetterTotal  = useCountUp(setterTotal);
  const animatedTrainerTotal = useCountUp(trainerTotal);
  const animatedKiloTotal    = useCountUp(kiloTotal);
  const animatedGrandTotal   = useCountUp(closerTotal + setterTotal + trainerTotal);

  if (!isHydrated) return <CalculatorSkeleton />;

  return (
    <div className="p-4 md:p-8 max-w-2xl animate-fade-in-up">
      <div className="mb-8">
        <div className="h-[3px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3" />
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-lg" style={{ backgroundColor: 'rgba(37,99,235,0.15)' }}>
            <Calculator className="w-5 h-5 text-blue-400" />
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-gradient-brand tracking-tight">Commission Calculator</h1>
        </div>
        <p className="text-slate-400 text-sm font-medium ml-12 tracking-wide">Run numbers before you close — know your earning before you pitch.</p>
      </div>

      <div className="card-surface rounded-2xl p-6 space-y-5 mb-6 overflow-visible relative z-20">
        {/* ── Quick Fill ──────────────────────────────────────────────────── */}
        {recentDeals.length > 0 && (
          <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Zap className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
              <span className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Quick Fill</span>
            </div>
            <div className="flex items-center gap-2">
              <SearchableSelect
                value={quickFillValue}
                onChange={handleQuickFill}
                options={recentDeals.map((proj) => ({
                  value: proj.id,
                  label: `${proj.customerName} · ${proj.kWSize.toFixed(1)} kW · $${proj.netPPW.toFixed(2)} PPW`,
                }))}
                placeholder="— Quick fill from recent deal —"
                className="flex-1"
              />
              <button
                type="button"
                onClick={handleReset}
                title="Clear all fields"
                className="flex-shrink-0 p-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-400 hover:text-white hover:border-slate-500 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        <div>
          <label className={labelCls}>
            Installer
            <FieldTooltip text="The installation company handling this project. Rates vary by installer." />
          </label>
          <div ref={installerRef}>
            <SearchableSelect
              value={installer}
              onChange={(val) => {
                setInstaller(val);
                setSolarTechFamily('');
                setSolarTechProductId('');
                setPcProductId('');
                setPcSelectedFamily('');
              }}
              options={activeInstallers.map((i) => ({ value: i, label: i }))}
              placeholder="— Select installer —"
            />
          </div>
        </div>

        {isSolarTech && (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Financing Family</label>
              <div ref={stFamilyRef}>
                <SearchableSelect
                  value={solarTechFamily}
                  onChange={(val) => { setSolarTechFamily(val); setSolarTechProductId(''); }}
                  options={SOLARTECH_FAMILIES.map((f) => ({
                    value: f,
                    label: `${f} (${SOLARTECH_FAMILY_FINANCER[f]})`,
                  }))}
                  placeholder="— Select family —"
                />
              </div>
            </div>
            {solarTechFamily && hasSolarTechProducts && (
              <div>
                <label className={labelCls}>Equipment Package</label>
                <div ref={stProductRef}>
                  <SearchableSelect
                    value={solarTechProductId}
                    onChange={setSolarTechProductId}
                    options={solarTechFamilyProducts.map((p) => ({
                      value: p.id,
                      label: p.name,
                    }))}
                    placeholder="— Select package —"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {isPcInstaller && pcConfig && (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Financing Family</label>
              <div ref={pcFamilyRef}>
                <SearchableSelect
                  value={pcSelectedFamily}
                  onChange={(val) => { setPcSelectedFamily(val); setPcProductId(''); }}
                  options={pcConfig.families.map((f) => ({ value: f, label: f }))}
                  placeholder="— Select family —"
                />
              </div>
            </div>
            {pcSelectedFamily && pcFamilyProducts.length > 0 && (
              <div>
                <label className={labelCls}>Equipment Package</label>
                <div ref={pcProductRef}>
                  <SearchableSelect
                    value={pcProductId}
                    onChange={setPcProductId}
                    options={pcFamilyProducts.map((p) => ({
                      value: p.id,
                      label: p.name,
                    }))}
                    placeholder="— Select package —"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>
              System Size (kW)
              <FieldTooltip text="Total system size in kilowatts. Larger systems = higher commission." />
            </label>
            <input
              ref={kWSizeRef}
              type="number" step="0.1" min="0" placeholder="e.g. 8.4"
              value={kWSize} onChange={(e) => setKWSize(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>
              Sold PPW ($/W)
              <FieldTooltip text="Price Per Watt — the rate you sold the system at. Must be above baseline to earn commission." />
            </label>
            <input
              ref={netPPWRef}
              type="number" step="0.01" min="0" placeholder="e.g. 3.45"
              value={netPPW} onChange={(e) => setNetPPW(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        <div className="space-y-3 overflow-visible relative z-10">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <div
              onClick={() => { setHasSetter((v) => { if (v) setSelectedSetterId(''); return !v; }); }}
              className={`w-10 h-5 rounded-full transition-colors relative flex-shrink-0 ${hasSetter ? 'bg-blue-600' : 'bg-slate-700'}`}
            >
              <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${hasSetter ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </div>
            <span className="text-slate-300 text-sm">Include setter</span>
          </label>

          {hasSetter && (
            <div>
              <label className={labelCls}>
                Setter
                <FieldTooltip text="Select a setter to factor in their trainer assignment and baseline split." />
              </label>
              <RepSelector
                value={selectedSetterId}
                onChange={setSelectedSetterId}
                reps={reps}
                placeholder="— Select setter —"
                clearLabel="No setter"
                filterFn={(r) => r.repType === 'setter' || r.repType === 'both'}
                renderExtra={(r) => {
                  const ta = trainerAssignments.find((a) => a.traineeId === r.id);
                  const trainerName = ta ? reps.find((tr) => tr.id === ta.trainerId)?.name : null;
                  return trainerName ? (
                    <span className="text-amber-400 text-[10px] font-medium flex-shrink-0">★ {trainerName}</span>
                  ) : null;
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {hasInput && (
        <div key={resultHash} className="animate-slide-in-scale relative z-0">
          <div className='h-[2px] w-12 rounded-full bg-gradient-to-r from-blue-500 to-blue-400 mb-3' />
          <div className="space-y-4">

          {/* Baseline info */}
          <div className="card-surface rounded-xl p-4 animate-slide-in-scale" style={{ animationDelay: '0ms' }}>
            <p className="text-slate-500 text-xs uppercase tracking-wider mb-3">Baseline Rates</p>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-white font-bold text-lg">${closerPerW.toFixed(2)}<span className="text-slate-500 text-xs font-normal">/W</span></p>
                <p className="text-slate-400 text-xs">Closer Baseline</p>
              </div>
              <div>
                <p className="text-white font-bold text-lg">${setterBaselinePerW.toFixed(2)}<span className="text-slate-500 text-xs font-normal">/W</span></p>
                <p className="text-slate-400 text-xs">Setter Baseline</p>
              </div>
              <div>
                <p className="text-white font-bold text-lg">${breakEvenPPW.toFixed(2)}<span className="text-slate-500 text-xs font-normal">/W</span></p>
                <p className="text-slate-400 text-xs">Break-Even PPW</p>
              </div>
            </div>
          </div>

          <div className='h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent my-4' />

          {/* Commission breakdown — individual stat cards with staggered entrance */}
          {soldPPW > 0 ? (
            <div className="space-y-3">
              {soldPPW <= closerPerW && (
                <div className="bg-red-900/20 border border-red-500/30 border-l-2 border-l-red-500 rounded-lg px-3 py-2 text-red-400 text-xs">
                  PPW is at or below baseline — no commission earned at this price.
                </div>
              )}

              {/* Card 1 — Closer Pay (blue) */}
              <div
                className="card-surface card-surface-stat rounded-xl p-4 animate-slide-in-scale stagger-1"
                style={{ '--card-accent': 'rgba(59,130,246,0.15)' } as CSSProperties}
              >
                <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Closer Pay</p>
                <div className="flex justify-between items-end">
                  <div>
                    <p className="stat-value text-gradient-brand font-bold text-2xl">${animatedCloserTotal.toLocaleString()}</p>
                    <p className="text-slate-500 text-xs mt-1">M1: ${closerM1.toLocaleString()} · M2: ${closerM2.toLocaleString()}{hasM3Split ? ` · M3: $${closerM3.toLocaleString()}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 mb-1">
                    <button
                      type="button"
                      onClick={handleCopyResult}
                      title="Copy deal summary to clipboard"
                      className="text-slate-500 hover:text-blue-400 transition-colors"
                    >
                      <ClipboardCopy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={handleShareResult}
                      title="Copy full share summary to clipboard"
                      className="text-slate-500 hover:text-blue-400 transition-colors"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Card 2 — Setter Pay (violet) */}
              {hasSetter && (
                <div
                  className="card-surface card-surface-stat rounded-xl p-4 animate-slide-in-scale stagger-2"
                  style={{ '--card-accent': 'rgba(139,92,246,0.15)' } as CSSProperties}
                >
                  <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">
                    Setter Pay{selectedSetterRep ? ` — ${selectedSetterRep.name}` : ''}
                  </p>
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="stat-value text-violet-400 font-bold text-2xl">${animatedSetterTotal.toLocaleString()}</p>
                      <p className="text-slate-500 text-xs mt-1">M1: ${setterM1.toLocaleString()} · M2: ${setterM2.toLocaleString()}{hasM3Split ? ` · M3: $${setterM3.toLocaleString()}` : ''}</p>
                    </div>
                    {trainerRep && trainerTotal > 0 && (
                      <div className="text-right">
                        <p className="text-amber-400 font-semibold text-sm">${animatedTrainerTotal.toLocaleString()}</p>
                        <p className="text-slate-500 text-xs">Trainer: {trainerRep.name}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Card 3 — Kilo Margin (emerald, admin-only) */}
              {currentRole === 'admin' && (
                <div
                  className="card-surface card-surface-stat rounded-xl p-4 animate-slide-in-scale stagger-3"
                  style={{ '--card-accent': 'rgba(16,185,129,0.15)' } as CSSProperties}
                >
                  <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Kilo Margin</p>
                  <p className="stat-value text-emerald-400 font-bold text-2xl">${animatedKiloTotal.toLocaleString()}</p>
                </div>
              )}

              {/* Card 4 — Total Commission (yellow) */}
              <div
                className="card-surface card-surface-stat rounded-xl p-4 animate-slide-in-scale stagger-4"
                style={{ '--card-accent': 'rgba(234,179,8,0.15)' } as CSSProperties}
              >
                <p className="text-slate-500 text-xs uppercase tracking-wider mb-2">Total Commission</p>
                <p className="stat-value stat-value-glow stat-glow-blue text-yellow-400 font-bold text-2xl">${animatedGrandTotal.toLocaleString()}</p>
              </div>

              {/* Animated stacked bar chart — stagger-5 entrance; keyed so grow-on-mount re-triggers on every recalculation */}
              <div className="animate-slide-in-scale stagger-5">
                <CommissionBar
                  key={resultHash}
                  closer={closerTotal}
                  setter={setterTotal}
                  trainer={trainerTotal}
                  kilo={kiloTotal}
                  showKilo={currentRole === 'admin'}
                />
              </div>
            </div>
          ) : (
            <div className="card-surface border-dashed rounded-xl p-6 text-center text-slate-500 text-sm animate-slide-in-scale" style={{ animationDelay: '100ms' }}>
              <div className="w-12 h-12 rounded-full bg-slate-800/80 flex items-center justify-center mx-auto mb-3">
                <Zap className="w-6 h-6 text-slate-600 animate-pulse" />
              </div>
              Enter a sold PPW to see your commission breakdown
            </div>
          )}

          <div className='h-px bg-gradient-to-r from-transparent via-slate-700/40 to-transparent my-4' />

          {/* Target earnings tool */}
          <div className="card-surface rounded-xl p-4 animate-slide-in-scale" style={{ animationDelay: '200ms' }}>
            <p className="text-slate-500 text-xs uppercase tracking-wider mb-3">PPW Needed for Target Earning</p>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <input
                  type="number"
                  placeholder="Target $ (e.g. 2000)"
                  value={targetEarning}
                  onChange={(e) => setTargetEarning(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="text-right min-w-[100px]">
                {requiredPPW > 0 ? (
                  <>
                    <p className="text-blue-400 font-bold text-xl">${requiredPPW.toFixed(2)}<span className="text-slate-500 text-xs font-normal">/W</span></p>
                    <p className="text-slate-500 text-xs">required PPW</p>
                  </>
                ) : (
                  <p className="text-slate-600 text-sm">—</p>
                )}
              </div>
            </div>
          </div>

          {/* ── Recent Calcs (localStorage history) ─────────────────────── */}
          {calcHistory.length > 0 && (
            <div className="card-surface rounded-xl animate-slide-in-scale" style={{ animationDelay: '250ms' }}>
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                className="w-full flex items-center justify-between px-4 py-3 text-left"
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-3.5 h-3.5 text-slate-500" />
                  <span className="text-slate-500 text-xs uppercase tracking-wider font-medium">Recent Calcs</span>
                  <span className="text-slate-600 text-xs">({calcHistory.length})</span>
                </div>
                {historyOpen ? (
                  <ChevronUp className="w-4 h-4 text-slate-500" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-500" />
                )}
              </button>
              {historyOpen && (
                <div className="px-4 pb-3 space-y-2">
                  {calcHistory.map((entry, i) => (
                    <div
                      key={`${entry.timestamp}-${i}`}
                      className="flex items-center justify-between gap-3 bg-slate-800/50 rounded-lg px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-white text-sm font-medium truncate">
                          {entry.installer} — {entry.kW.toFixed(1)} kW @ ${entry.ppw.toFixed(2)}/W
                        </p>
                        <p className="text-slate-500 text-xs">
                          Closer: ${entry.closerTotal.toLocaleString()}
                          {entry.hasSetter && entry.setterTotal > 0 ? ` · Setter: $${entry.setterTotal.toLocaleString()}` : ''}
                          {entry.trainerTotal > 0 ? ` · Trainer: $${entry.trainerTotal.toLocaleString()}` : ''}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLoadHistory(entry)}
                        className="flex-shrink-0 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded-md px-2.5 py-1 transition-colors"
                      >
                        Load
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={handleClearHistory}
                    className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-red-400 transition-colors mt-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    Clear History
                  </button>
                </div>
              )}
            </div>
          )}

          </div>
        </div>
      )}

      {/* Recent Calcs — shown even when no active calc inputs */}
      {!hasInput && calcHistory.length > 0 && (
        <div className="card-surface rounded-xl mb-6 animate-fade-in">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-left"
          >
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-slate-500 text-xs uppercase tracking-wider font-medium">Recent Calcs</span>
              <span className="text-slate-600 text-xs">({calcHistory.length})</span>
            </div>
            {historyOpen ? (
              <ChevronUp className="w-4 h-4 text-slate-500" />
            ) : (
              <ChevronDown className="w-4 h-4 text-slate-500" />
            )}
          </button>
          {historyOpen && (
            <div className="px-4 pb-3 space-y-2">
              {calcHistory.map((entry, i) => (
                <div
                  key={`${entry.timestamp}-${i}`}
                  className="flex items-center justify-between gap-3 bg-slate-800/50 rounded-lg px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-white text-sm font-medium truncate">
                      {entry.installer} — {entry.kW.toFixed(1)} kW @ ${entry.ppw.toFixed(2)}/W
                    </p>
                    <p className="text-slate-500 text-xs">
                      Closer: ${entry.closerTotal.toLocaleString()}
                      {entry.hasSetter && entry.setterTotal > 0 ? ` · Setter: $${entry.setterTotal.toLocaleString()}` : ''}
                      {entry.trainerTotal > 0 ? ` · Trainer: $${entry.trainerTotal.toLocaleString()}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleLoadHistory(entry)}
                    className="flex-shrink-0 text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 rounded-md px-2.5 py-1 transition-colors"
                  >
                    Load
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={handleClearHistory}
                className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-red-400 transition-colors mt-1"
              >
                <Trash2 className="w-3 h-3" />
                Clear History
              </button>
            </div>
          )}
        </div>
      )}

      {!hasInput && (
        <div className="animate-fade-in flex justify-center py-4">
          <div className="w-72 border border-dashed border-slate-800 rounded-2xl px-6 py-10 flex flex-col items-center gap-4 text-center">
            {/* Illustration — solar panel with calculator overlay */}
            <svg width="96" height="96" viewBox="0 0 96 96" fill="none" aria-hidden="true" className="opacity-50">
              {/* Sun glow halo */}
              <circle cx="28" cy="22" r="10" fill="#1e3a5f" stroke="#eab308" strokeWidth="1.5" strokeOpacity="0.5"/>
              {/* Sun rays */}
              <line x1="28" y1="8"  x2="28" y2="13" stroke="#eab308" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.5"/>
              <line x1="28" y1="31" x2="28" y2="36" stroke="#eab308" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.5"/>
              <line x1="14" y1="22" x2="18" y2="22" stroke="#eab308" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.5"/>
              <line x1="38" y1="22" x2="42" y2="22" stroke="#eab308" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.5"/>
              <line x1="18" y1="12" x2="21" y2="15" stroke="#eab308" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.4"/>
              <line x1="35" y1="29" x2="38" y2="32" stroke="#eab308" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.4"/>
              <line x1="38" y1="12" x2="35" y2="15" stroke="#eab308" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.4"/>
              <line x1="18" y1="32" x2="21" y2="29" stroke="#eab308" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.4"/>
              {/* Solar panel frame */}
              <rect x="8" y="40" width="54" height="36" rx="3" fill="#0f172a" stroke="#334155" strokeWidth="1.5"/>
              {/* Panel cells — 3 columns × 3 rows */}
              <rect x="11" y="43" width="14" height="9"  rx="1.5" fill="#1e293b" stroke="#3b82f6" strokeWidth="1" strokeOpacity="0.55"/>
              <rect x="27" y="43" width="14" height="9"  rx="1.5" fill="#1e293b" stroke="#3b82f6" strokeWidth="1" strokeOpacity="0.55"/>
              <rect x="43" y="43" width="16" height="9"  rx="1.5" fill="#1e293b" stroke="#3b82f6" strokeWidth="1" strokeOpacity="0.55"/>
              <rect x="11" y="54" width="14" height="9"  rx="1.5" fill="#1e293b" stroke="#3b82f6" strokeWidth="1" strokeOpacity="0.45"/>
              <rect x="27" y="54" width="14" height="9"  rx="1.5" fill="#1e293b" stroke="#3b82f6" strokeWidth="1" strokeOpacity="0.45"/>
              <rect x="43" y="54" width="16" height="9"  rx="1.5" fill="#1e293b" stroke="#3b82f6" strokeWidth="1" strokeOpacity="0.45"/>
              <rect x="11" y="65" width="14" height="8"  rx="1.5" fill="#1e293b" stroke="#3b82f6" strokeWidth="1" strokeOpacity="0.35"/>
              <rect x="27" y="65" width="14" height="8"  rx="1.5" fill="#1e293b" stroke="#3b82f6" strokeWidth="1" strokeOpacity="0.35"/>
              <rect x="43" y="65" width="16" height="8"  rx="1.5" fill="#1e293b" stroke="#3b82f6" strokeWidth="1" strokeOpacity="0.35"/>
              {/* Panel mount pole + base */}
              <line x1="35" y1="76" x2="35" y2="86" stroke="#334155" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="24" y1="86" x2="46" y2="86" stroke="#334155" strokeWidth="2.5" strokeLinecap="round"/>
              {/* Calculator body — overlapping bottom-right */}
              <rect x="56" y="52" width="32" height="40" rx="4" fill="#1e293b" stroke="#475569" strokeWidth="1.5"/>
              {/* Calculator screen */}
              <rect x="59" y="56" width="26" height="11" rx="2" fill="#0f172a" stroke="#3b82f6" strokeWidth="1" strokeOpacity="0.5"/>
              <text x="83" y="64" textAnchor="end" fill="#60a5fa" fontSize="7" fontFamily="monospace" fontWeight="bold">$—</text>
              {/* Calculator button grid 3×4 */}
              <rect x="59" y="70" width="7" height="5" rx="1.5" fill="#334155"/>
              <rect x="68" y="70" width="7" height="5" rx="1.5" fill="#334155"/>
              <rect x="77" y="70" width="7" height="5" rx="1.5" fill="#1e3a5f" stroke="#3b82f6" strokeWidth="0.75" strokeOpacity="0.5"/>
              <rect x="59" y="77" width="7" height="5" rx="1.5" fill="#334155"/>
              <rect x="68" y="77" width="7" height="5" rx="1.5" fill="#334155"/>
              <rect x="77" y="77" width="7" height="5" rx="1.5" fill="#1e3a5f" stroke="#3b82f6" strokeWidth="0.75" strokeOpacity="0.5"/>
              <rect x="59" y="84" width="7" height="5" rx="1.5" fill="#334155"/>
              <rect x="68" y="84" width="16" height="5" rx="1.5" fill="#1e3a5f" stroke="#3b82f6" strokeWidth="0.75" strokeOpacity="0.6"/>
            </svg>
            <div className="space-y-1">
              <p className="text-slate-200 text-sm font-semibold leading-snug">Configure a deal above</p>
              <p className="text-slate-500 text-xs leading-relaxed">to see your commission breakdown</p>
            </div>
            {/* Pulsing up arrow */}
            <div className="animate-bounce opacity-40 -mt-1">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden="true">
                <path d="M11 17V5M11 5L6 10M11 5L16 10" stroke="#94a3b8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function CalculatorSkeleton() {
  return (
    <div className="p-4 md:p-8 max-w-2xl">
      {/* Page header shimmer */}
      <div className="mb-8">
        <div className="h-[3px] w-12 rounded-full bg-slate-700 animate-skeleton mb-3" />
        <div className="flex items-center gap-3 mb-1">
          <div
            className="h-9 w-9 bg-slate-800 rounded-lg animate-skeleton"
            style={{ animationDelay: '50ms' }}
          />
          <div
            className="h-8 w-56 bg-slate-800 rounded animate-skeleton"
            style={{ animationDelay: '100ms' }}
          />
        </div>
        <div
          className="h-3 w-72 bg-slate-800/70 rounded animate-skeleton ml-12 mt-1"
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
              className={`h-3 ${labelW} bg-slate-700/70 rounded animate-skeleton mb-2`}
              style={{ animationDelay: `${delay}ms` }}
            />
            <div
              className="h-10 w-full bg-slate-800 rounded-xl animate-skeleton"
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
              className="h-3 w-28 bg-slate-700/50 rounded animate-skeleton mb-4"
              style={{ animationDelay: `${delay}ms` }}
            />
            {/* Card body shimmer */}
            <div
              className={`${bodyH} w-full bg-slate-800/70 rounded-xl animate-skeleton`}
              style={{ animationDelay: `${delay + 50}ms` }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
