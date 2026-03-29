export function formatDate(dateStr: string): string {
  if (!dateStr) return '—';
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatCurrency(amount: number): string {
  return `$${Math.round(amount).toLocaleString('en-US')}`;
}

export function formatKW(kw: number): string {
  return `${kw.toFixed(1)} kW`;
}

export function isInDateRange(dateStr: string, startDate: string, endDate: string | null): boolean {
  const date = new Date(dateStr);
  const start = new Date(startDate);
  const end = endDate ? new Date(endDate) : new Date('2099-12-31');
  return date >= start && date <= end;
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
  return friday.toISOString().split('T')[0];
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
  return friday.toISOString().split('T')[0];
}
