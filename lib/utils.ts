/** Read a JSON value from localStorage with a fallback default. */
export function getCustomConfig<T>(key: string, defaultValue: T): T {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : defaultValue;
  } catch { return defaultValue; }
}

/** Generate and trigger a CSV download from an array of objects. */
export function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const escape = (v: string) => {
    if (v.includes(',') || v.includes('"') || v.includes('\n')) {
      return `"${v.replace(/"/g, '""')}"`;
    }
    return v;
  };
  const csv = [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatCurrency(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

export function fmt$(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount || 0);
}

/**
 * Compact currency formatter for tight spaces like mobile stat cards.
 * Below $10k: full format ($1,234). $10k–$999k: $12.3K. $1M+: $1.23M.
 * Prevents card overflow on 3-column mobile grids.
 */
export function fmtCompact$(amount: number): string {
  const n = amount || 0;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1_000).toFixed(1)}K`;
  return fmt$(n);
}

export function formatKW(kw: number): string {
  return `${kw.toFixed(1)} kW`;
}

/**
 * Compact system-size formatter for stat cards and tight spaces.
 * Below 1,000 kW: shown as kW with one decimal (`987.5 kW`).
 * 1,000+ kW: converted to MW (`1.2 MW`, `16.1 MW`) — matches how solar
 * industry actually talks about large totals and avoids the awkward
 * "16K kW" double-abbreviation.
 */
export function formatCompactKW(kw: number): string {
  const n = kw || 0;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} MW`;
  return `${n.toFixed(1)} kW`;
}

export function isInDateRange(dateStr: string, startDate: string, endDate: string | null): boolean {
  const date = new Date(dateStr);
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date('2099-12-31');
  return date >= start && date <= end;
}

/** Format a Date as YYYY-MM-DD using local time (avoids UTC off-by-one). */
export function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Today's date as YYYY-MM-DD in local time. Use this instead of new Date().toISOString().slice(0,10) to avoid UTC off-by-one. */
export function todayLocalDateStr(): string {
  return localDateString(new Date());
}

/**
 * Returns true when a payroll entry is Paid AND its pay date is not in the future.
 * Use this everywhere a "Paid" filter is applied to payroll entries to prevent
 * future-scheduled entries (created during payroll batch runs) from inflating stats.
 */
export function isPaidAndEffective(entry: { status: string; date: string }): boolean {
  return entry.status === 'Paid' && entry.date <= todayLocalDateStr();
}

/**
 * M1 payroll date: project reaches Acceptance phase.
 * Cutoff is Sunday 11:59 PM. M1 is paid on the following Friday.
 * If the milestone is hit Mon–Sun, the pay date is the Friday of that same week
 * (i.e. the next upcoming Friday after the Sunday cutoff).
 */
export function getM1PayDate(milestoneDate?: Date): string {
  const d = milestoneDate ?? new Date();
  // Day of week: 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
  const day = d.getDay();
  // Find the next Sunday (end of cutoff window). If today IS Sunday, cutoff is tonight.
  const daysToSunday = day === 0 ? 0 : 7 - day;
  const sunday = new Date(d);
  sunday.setDate(d.getDate() + daysToSunday);
  // Pay date is the Friday after that Sunday = Sunday + 5 days
  const friday = new Date(sunday);
  friday.setDate(sunday.getDate() + 5);
  return localDateString(friday);
}

/**
 * M2 payroll date: project reaches Installed phase.
 * Cutoff is Saturday 11:59 PM. M2 is paid on the following Friday.
 * If the milestone is hit Sun–Sat, the pay date is the Friday after the Saturday cutoff.
 */
export function getM2PayDate(milestoneDate?: Date): string {
  const d = milestoneDate ?? new Date();
  const day = d.getDay();
  // Find the next Saturday (end of cutoff window). If today IS Saturday, cutoff is tonight.
  const daysToSaturday = day === 6 ? 0 : 6 - day;
  const saturday = new Date(d);
  saturday.setDate(d.getDate() + daysToSaturday);
  // Pay date is the Friday after that Saturday = Saturday + 6 days
  const friday = new Date(saturday);
  friday.setDate(saturday.getDate() + 6);
  return localDateString(friday);
}
