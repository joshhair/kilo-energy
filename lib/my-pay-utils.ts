import { localDateString } from './utils';
import type { PayrollEntry } from './data';

export function getNextFriday(): Date {
  const d = new Date();
  const day = d.getDay();
  const diff = (5 - day + 7) % 7;
  const nf = new Date(d);
  nf.setDate(d.getDate() + diff);
  return nf;
}

export function getFridayForDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  const day = d.getDay();
  const diff = ((5 - day + 7) % 7) || 7;
  if (day === 5) return dateStr;
  const nf = new Date(d);
  nf.setDate(d.getDate() + diff);
  return localDateString(nf);
}

// Shared base shape — both surfaces extend this with their own fields.
export interface PayPeriodBase {
  friday: string;
  entries: PayrollEntry[];
  total: number;
}
