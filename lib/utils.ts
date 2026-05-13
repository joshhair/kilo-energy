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
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 10_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
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

/**
 * Same as formatCompactKW but omits the "kW" suffix — intended for
 * stat-card values where the label already says "Total kW" and the
 * suffix would be redundant. Still shows "MW" for values ≥ 1,000 so
 * very large org-wide totals don't render as "21,000".
 *
 * NOTE: when the value crosses into MW, the unit label on the card
 * is wrong ("kW Sold" with "2.1 MW" value). Use formatCompactKWParts
 * below for the dynamic-label case.
 */
export function formatCompactKWValue(kw: number): string {
  const n = kw || 0;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} MW`;
  return `${n.toFixed(1)}`;
}

/**
 * Returns the formatted number + its unit so a stat card can render
 * `${unit} Sold` / `${unit} Installed` and the value side-by-side
 * without the unit mismatch (e.g. "2.1 MW" value with "kW Sold"
 * label, which formatCompactKWValue produces above 1,000 kW).
 *
 *   formatCompactKWParts(34.8)   → { value: '34.8', unit: 'kW' }
 *   formatCompactKWParts(2_100)  → { value: '2.1',  unit: 'MW' }
 */
export function formatCompactKWParts(kw: number): { value: string; unit: 'kW' | 'MW' } {
  const n = kw || 0;
  if (n >= 1_000) return { value: (n / 1_000).toFixed(1), unit: 'MW' };
  return { value: n.toFixed(1), unit: 'kW' };
}

export function isInDateRange(dateStr: string, startDate: string, endDate: string | null): boolean {
  const [dy, dm, dd] = dateStr.split('-').map(Number);
  const [sy, sm, sd] = startDate.split('-').map(Number);
  const end = endDate ?? '2099-12-31';
  const [ey, em, ed] = end.split('-').map(Number);
  const d = dy * 10000 + dm * 100 + dd;
  const s = sy * 10000 + sm * 100 + sd;
  const e = ey * 10000 + em * 100 + ed;
  return d >= s && d <= e;
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

// M3 (PTO phase) uses the same Saturday cutoff as M2 but falls in the following
// week's cycle so it doesn't collapse into the M2 pay period when both entries
// are created simultaneously (e.g. during setter reassignment on a past-PTO project).
export function getM3PayDate(milestoneDate?: Date): string {
  const d = milestoneDate ?? new Date();
  const offsetDate = new Date(d);
  offsetDate.setDate(d.getDate() + 7);
  return getM2PayDate(offsetDate);
}

export function relativeTime(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const past = new Date(year, month - 1, day);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const days = Math.max(0, Math.floor((now.getTime() - past.getTime()) / (1000 * 60 * 60 * 24)));
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}
