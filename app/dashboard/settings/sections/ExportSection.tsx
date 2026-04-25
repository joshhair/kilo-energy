'use client';

import React, { useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { useApp } from '../../../../lib/context';
import { useToast } from '../../../../lib/toast';
import { SectionHeader } from '../components/SectionHeader';

export function ExportSection() {
  const {
    payrollEntries, projects, reps, trainerAssignments,
    installerPricingVersions, solarTechProducts, productCatalogProducts,
  } = useApp();
  const { toast } = useToast();

  const [exportSelected, setExportSelected] = useState<Set<'payments' | 'projects' | 'baselines' | 'trainers'>>(new Set());
  const [exportDateFrom, setExportDateFrom] = useState('');
  const [exportDateTo, setExportDateTo] = useState('');

  const filteredPayroll = payrollEntries.filter((p) => {
    if (exportDateFrom && p.date < exportDateFrom) return false;
    if (exportDateTo && p.date > exportDateTo) return false;
    return true;
  });
  const filteredProjects = projects.filter((p) => {
    if ((exportDateFrom || exportDateTo) && !p.soldDate) return false;
    if (exportDateFrom && p.soldDate! < exportDateFrom) return false;
    if (exportDateTo && p.soldDate! > exportDateTo) return false;
    return true;
  });
  const toggleExport = (type: 'payments' | 'projects' | 'baselines' | 'trainers') => {
    setExportSelected((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  return (
    <div key="export" className="animate-tab-enter max-w-2xl">
      <SectionHeader title="Export" subtitle="Download data exports as CSV" />

      {/* Date range filter */}
      <div className="card-surface rounded-2xl p-5 mb-6">
        <h2 className="text-[var(--text-primary)] font-semibold mb-3">Date Range Filter</h2>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">From</label>
            <input type="date" value={exportDateFrom} onChange={(e) => setExportDateFrom(e.target.value)}
              className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
            />
          </div>
          <div>
            <label className="block text-xs text-[var(--text-secondary)] mb-1">To</label>
            <input type="date" value={exportDateTo} onChange={(e) => setExportDateTo(e.target.value)}
              className="w-full bg-[var(--surface-card)] border border-[var(--border-subtle)] text-[var(--text-primary)] rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--accent-emerald-solid)]"
            />
          </div>
        </div>
        {(exportDateFrom || exportDateTo) && (
          <button onClick={() => { setExportDateFrom(''); setExportDateTo(''); }}
            className="text-[var(--text-muted)] hover:text-[var(--text-primary)] text-xs mt-2 transition-colors">Clear dates</button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <button
          onClick={() => toggleExport('payments')}
          className={`bg-[var(--surface)] rounded-2xl p-6 text-left transition-all duration-200 hover:translate-y-[-2px] ${
            exportSelected.has('payments')
              ? 'border border-[var(--accent-emerald-solid)]/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
              : 'border border-[var(--border-subtle)] hover:border-[var(--border)]/50'
          }`}
        >
          <div className="flex items-start justify-between mb-3">
            <div className={`p-2.5 rounded-xl transition-colors ${exportSelected.has('payments') ? 'bg-[var(--accent-emerald-solid)]/15' : 'bg-[var(--surface-card)]/80'}`}>
              <FileSpreadsheet className={`w-5 h-5 transition-colors ${exportSelected.has('payments') ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--text-secondary)]'}`} />
            </div>
            {exportSelected.has('payments') && (
              <span className="text-xs font-medium text-[var(--accent-emerald-text)] bg-[var(--accent-emerald-solid)]/10 border border-[var(--accent-emerald-solid)]/20 px-2 py-0.5 rounded-full">Selected</span>
            )}
          </div>
          <h2 className="text-[var(--text-primary)] font-bold tracking-tight text-base mb-1">Payments Export</h2>
          <p className="text-[var(--text-muted)] text-sm leading-relaxed mb-3">All payroll entries including deal commissions, bonuses, and payment status.</p>
          <p className="text-[var(--text-secondary)] text-xs font-medium tabular-nums">{filteredPayroll.length} of {payrollEntries.length} records</p>
        </button>
        <button
          onClick={() => toggleExport('projects')}
          className={`bg-[var(--surface)] rounded-2xl p-6 text-left transition-all duration-200 hover:translate-y-[-2px] ${
            exportSelected.has('projects')
              ? 'border border-[var(--accent-emerald-solid)]/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
              : 'border border-[var(--border-subtle)] hover:border-[var(--border)]/50'
          }`}
        >
          <div className="flex items-start justify-between mb-3">
            <div className={`p-2.5 rounded-xl transition-colors ${exportSelected.has('projects') ? 'bg-[var(--accent-emerald-solid)]/15' : 'bg-[var(--surface-card)]/80'}`}>
              <FileSpreadsheet className={`w-5 h-5 transition-colors ${exportSelected.has('projects') ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--text-secondary)]'}`} />
            </div>
            {exportSelected.has('projects') && (
              <span className="text-xs font-medium text-[var(--accent-emerald-text)] bg-[var(--accent-emerald-solid)]/10 border border-[var(--accent-emerald-solid)]/20 px-2 py-0.5 rounded-full">Selected</span>
            )}
          </div>
          <h2 className="text-[var(--text-primary)] font-bold tracking-tight text-base mb-1">Projects Export</h2>
          <p className="text-[var(--text-muted)] text-sm leading-relaxed mb-3">Full project pipeline with installers, financers, kW size, PPW, and payment milestones.</p>
          <p className="text-[var(--text-secondary)] text-xs font-medium tabular-nums">{filteredProjects.length} of {projects.length} records</p>
        </button>
        <button
          onClick={() => toggleExport('baselines')}
          className={`bg-[var(--surface)] rounded-2xl p-6 text-left transition-all duration-200 hover:translate-y-[-2px] ${
            exportSelected.has('baselines')
              ? 'border border-[var(--accent-emerald-solid)]/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
              : 'border border-[var(--border-subtle)] hover:border-[var(--border)]/50'
          }`}
        >
          <div className="flex items-start justify-between mb-3">
            <div className={`p-2.5 rounded-xl transition-colors ${exportSelected.has('baselines') ? 'bg-[var(--accent-emerald-solid)]/15' : 'bg-[var(--surface-card)]/80'}`}>
              <FileSpreadsheet className={`w-5 h-5 transition-colors ${exportSelected.has('baselines') ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--text-secondary)]'}`} />
            </div>
            {exportSelected.has('baselines') && (
              <span className="text-xs font-medium text-[var(--accent-emerald-text)] bg-[var(--accent-emerald-solid)]/10 border border-[var(--accent-emerald-solid)]/20 px-2 py-0.5 rounded-full">Selected</span>
            )}
          </div>
          <h2 className="text-[var(--text-primary)] font-bold tracking-tight text-base mb-1">Baselines Export</h2>
          <p className="text-[var(--text-muted)] text-sm leading-relaxed mb-3">Installer baselines, SolarTech tiers, and Product Catalog tiers with closer/kilo rates.</p>
          <p className="text-[var(--text-secondary)] text-xs font-medium tabular-nums">{installerPricingVersions.length + solarTechProducts.length + productCatalogProducts.length} total rows</p>
        </button>
        <button
          onClick={() => toggleExport('trainers')}
          className={`bg-[var(--surface)] rounded-2xl p-6 text-left transition-all duration-200 hover:translate-y-[-2px] ${
            exportSelected.has('trainers')
              ? 'border border-[var(--accent-emerald-solid)]/40 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
              : 'border border-[var(--border-subtle)] hover:border-[var(--border)]/50'
          }`}
        >
          <div className="flex items-start justify-between mb-3">
            <div className={`p-2.5 rounded-xl transition-colors ${exportSelected.has('trainers') ? 'bg-[var(--accent-emerald-solid)]/15' : 'bg-[var(--surface-card)]/80'}`}>
              <FileSpreadsheet className={`w-5 h-5 transition-colors ${exportSelected.has('trainers') ? 'text-[var(--accent-emerald-text)]' : 'text-[var(--text-secondary)]'}`} />
            </div>
            {exportSelected.has('trainers') && (
              <span className="text-xs font-medium text-[var(--accent-emerald-text)] bg-[var(--accent-emerald-solid)]/10 border border-[var(--accent-emerald-solid)]/20 px-2 py-0.5 rounded-full">Selected</span>
            )}
          </div>
          <h2 className="text-[var(--text-primary)] font-bold tracking-tight text-base mb-1">Trainer Assignments</h2>
          <p className="text-[var(--text-muted)] text-sm leading-relaxed mb-3">Trainee/trainer pairs with tier breakdowns and completed deal counts.</p>
          <p className="text-[var(--text-secondary)] text-xs font-medium tabular-nums">{trainerAssignments.length} assignments</p>
        </button>
      </div>
      {exportSelected.size > 0 && (
        <div className="mb-6">
          <div className="card-surface rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-[var(--accent-emerald-solid)]/10">
                <FileSpreadsheet className="w-4 h-4 text-[var(--accent-emerald-text)]" />
              </div>
              <div>
                <p className="text-[var(--text-primary)] text-sm font-semibold">
                  {[...exportSelected].map((t) => ({ payments: 'Payments', projects: 'Projects', baselines: 'Baselines', trainers: 'Trainers' }[t])).join(' + ')} Export ready
                </p>
                <p className="text-[var(--text-muted)] text-xs">
                  {[
                    exportSelected.has('payments') ? `${filteredPayroll.length} payment records` : '',
                    exportSelected.has('projects') ? `${filteredProjects.length} project records` : '',
                    exportSelected.has('baselines') ? `${installerPricingVersions.length + solarTechProducts.length + productCatalogProducts.length} baseline rows` : '',
                    exportSelected.has('trainers') ? `${trainerAssignments.length} assignments` : '',
                  ].filter(Boolean).join(' + ')}
                  {' will be exported as CSV'}
                </p>
              </div>
            </div>
            <button
              onClick={() => {
                const escape = (val: string) => `"${val.replace(/"/g, '""')}"`;
                const toCSV = (headers: string[], rows: string[][]) =>
                  [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
                const download = (csv: string, filename: string) => {
                  const blob = new Blob([csv], { type: 'text/csv' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = filename; a.click();
                  URL.revokeObjectURL(url);
                };
                const _d = new Date(); const dateStr = `${_d.getFullYear()}-${String(_d.getMonth()+1).padStart(2,'0')}-${String(_d.getDate()).padStart(2,'0')}`;
                if (exportSelected.has('payments')) {
                  const csv = toCSV(
                    ['Rep', 'Customer / Notes', 'Type', 'Stage', 'Amount', 'Status', 'Date'],
                    filteredPayroll.map((p) => [p.repName, p.customerName || p.notes || '', p.type, String(p.paymentStage ?? ''), String(p.amount), p.status, p.date]),
                  );
                  download(csv, `kilo_payments_${dateStr}.csv`);
                }
                if (exportSelected.has('projects')) {
                  const csv = toCSV(
                    ['Customer', 'Rep', 'Phase', 'Installer', 'Financer', 'Product Type', 'kW Size', 'Net PPW', 'Sold Date', 'M1 Amount', 'M1 Paid', 'M2 Amount', 'M2 Paid', 'Flagged'],
                    filteredProjects.map((p) => [p.customerName, p.repName, p.phase, p.installer, p.financer, p.productType, String(p.kWSize), String(p.netPPW), p.soldDate, String(p.m1Amount), p.m1Paid ? 'Yes' : 'No', String(p.m2Amount), p.m2Paid ? 'Yes' : 'No', p.flagged ? 'Yes' : 'No']),
                  );
                  download(csv, `kilo_projects_${dateStr}.csv`);
                }
                if (exportSelected.has('baselines')) {
                  const rows: string[][] = [];
                  // Installer baselines (flat rate versions)
                  installerPricingVersions.forEach((v) => {
                    if (v.rates.type === 'flat') {
                      rows.push(['Installer Baseline', v.installer, v.label, v.effectiveFrom, v.effectiveTo || '', String(v.rates.closerPerW), String(v.rates.kiloPerW), '', '', '', '', '', '']);
                    } else {
                      v.rates.bands.forEach((b) => {
                        rows.push(['Installer Baseline (Tiered)', v.installer, v.label, v.effectiveFrom, v.effectiveTo || '', String(b.closerPerW), String(b.kiloPerW), '', '', String(b.minKW), String(b.maxKW ?? ''), '', '']);
                      });
                    }
                  });
                  // SolarTech products
                  solarTechProducts.forEach((p) => {
                    p.tiers.forEach((t) => {
                      rows.push(['SolarTech', p.name, p.family, '', '', String(t.closerPerW), String(t.kiloPerW), String(t.minKW), String(t.maxKW ?? ''), '', '', '', '']);
                    });
                  });
                  // Product Catalog products
                  productCatalogProducts.forEach((p) => {
                    p.tiers.forEach((t) => {
                      rows.push(['Product Catalog', p.name, p.family, p.installer, '', String(t.closerPerW), String(t.kiloPerW), String(t.minKW), String(t.maxKW ?? ''), '', '', '', '']);
                    });
                  });
                  const csv = toCSV(
                    ['Source', 'Name', 'Family / Label', 'Installer / EffectiveFrom', 'EffectiveTo', 'Closer $/W', 'Kilo $/W', 'Min kW', 'Max kW', 'Band Min kW', 'Band Max kW', '', ''],
                    rows,
                  );
                  download(csv, `kilo_baselines_${dateStr}.csv`);
                }
                if (exportSelected.has('trainers')) {
                  const rows: string[][] = [];
                  trainerAssignments.forEach((a) => {
                    const trainee = reps.find((r) => r.id === a.traineeId);
                    const trainer = reps.find((r) => r.id === a.trainerId);
                    const dealCount = projects.filter((p) => (p.repId === a.traineeId || p.setterId === a.traineeId) && ['Installed', 'PTO', 'Completed'].includes(p.phase)).length;
                    const tierStrs = a.tiers.map((t, i) => `Tier ${i + 1}: up to ${t.upToDeal === null ? '\u221e' : t.upToDeal} deals @ $${t.ratePerW}/W`).join(' | ');
                    rows.push([trainee?.name || a.traineeId, trainer?.name || a.trainerId, String(a.tiers.length), tierStrs, String(dealCount)]);
                  });
                  const csv = toCSV(
                    ['Trainee', 'Trainer', 'Tier Count', 'Tier Breakdown', 'Completed Deals'],
                    rows,
                  );
                  download(csv, `kilo_trainer_assignments_${new Date().toISOString().split('T')[0]}.csv`);
                }
                toast(`Export started — ${exportSelected.size} file${exportSelected.size > 1 ? 's' : ''} downloading`, 'info');
              }}
              className="flex items-center gap-2 bg-[var(--accent-emerald-solid)] hover:bg-[var(--accent-emerald-solid)] active:scale-[0.97] text-black text-sm font-semibold px-5 py-2.5 rounded-xl transition-all shadow-lg shadow-blue-500/20 whitespace-nowrap"
            >
              <Download className="w-4 h-4" />
              Download CSV{exportSelected.size > 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
