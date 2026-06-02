import { todayLocalDateStr } from '../../../../lib/utils';
import { IncentiveMetric, IncentivePeriod } from '../../../../lib/data';

export function todayISO(): string {
  return todayLocalDateStr();
}

export const MOBILE_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const MOBILE_QUARTERS = [
  { value: 'Q1', label: 'Q1 (Jan–Mar)', startMonth: 0, endMonth: 2 },
  { value: 'Q2', label: 'Q2 (Apr–Jun)', startMonth: 3, endMonth: 5 },
  { value: 'Q3', label: 'Q3 (Jul–Sep)', startMonth: 6, endMonth: 8 },
  { value: 'Q4', label: 'Q4 (Oct–Dec)', startMonth: 9, endMonth: 11 },
];

export function mobileLastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function mobileComputeDatesForPeriod(period: IncentivePeriod, year: number, month: number, quarter: string): { startDate: string; endDate: string | null } {
  if (period === 'alltime') return { startDate: '', endDate: null };
  if (period === 'month') {
    const lastDay = mobileLastDayOfMonth(year, month);
    return {
      startDate: `${year}-${String(month + 1).padStart(2, '0')}-01`,
      endDate: `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
  }
  if (period === 'quarter') {
    const q = MOBILE_QUARTERS.find((qq) => qq.value === quarter) ?? MOBILE_QUARTERS[0];
    const lastDay = mobileLastDayOfMonth(year, q.endMonth);
    return {
      startDate: `${year}-${String(q.startMonth + 1).padStart(2, '0')}-01`,
      endDate: `${year}-${String(q.endMonth + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    };
  }
  return { startDate: `${year}-01-01`, endDate: `${year}-12-31` };
}

export const INCENTIVE_TEMPLATES: { label: string; title: string; metric: IncentiveMetric; period: IncentivePeriod; milestones: { threshold: string; reward: string }[] }[] = [
  {
    label: 'Monthly Deal Sprint',
    title: 'Monthly Deal Sprint',
    metric: 'deals',
    period: 'month',
    milestones: [
      { threshold: '5', reward: '$150 Bonus' },
      { threshold: '10', reward: '$400 Bonus' },
      { threshold: '15', reward: '$750 Bonus + Team Dinner' },
    ],
  },
  {
    label: 'Quarterly kW Target',
    title: 'Quarterly kW Target',
    metric: 'kw',
    period: 'quarter',
    milestones: [
      { threshold: '50', reward: '$300 Bonus' },
      { threshold: '100', reward: '$750 Bonus' },
      { threshold: '150', reward: '$1,500 Bonus + PTO Day' },
    ],
  },
  {
    label: 'Annual Revenue Goal',
    title: 'Annual Revenue Goal',
    metric: 'revenue',
    period: 'year',
    milestones: [
      { threshold: '250000', reward: '$1,000 Bonus' },
      { threshold: '500000', reward: '$3,000 Bonus' },
      { threshold: '1000000', reward: '$7,500 Bonus + Trip' },
    ],
  },
  {
    label: 'Commission Milestone',
    title: 'Commission Milestone',
    metric: 'commission',
    period: 'quarter',
    milestones: [
      { threshold: '5000', reward: '$200 Spiff' },
      { threshold: '15000', reward: '$600 Spiff' },
      { threshold: '30000', reward: '$1,500 Spiff + Award' },
    ],
  },
];
