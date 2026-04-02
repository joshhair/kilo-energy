export type Phase =
  | 'New'
  | 'Acceptance'
  | 'Site Survey'
  | 'Design'
  | 'Permitting'
  | 'Pending Install'
  | 'Installed'
  | 'PTO'
  | 'Completed'
  | 'Cancelled'
  | 'On Hold';

export const PHASES: Phase[] = [
  'New',
  'Acceptance',
  'Site Survey',
  'Design',
  'Permitting',
  'Pending Install',
  'Installed',
  'PTO',
  'Completed',
  'Cancelled',
  'On Hold',
];

export const ACTIVE_PHASES: Phase[] = ['New', 'Acceptance', 'Site Survey', 'Design', 'Permitting', 'Pending Install', 'Installed', 'PTO', 'Completed'];

export const INSTALLERS = [
  'ESP',
  'EXO',
  'SolarTech',
  'GEG',
  'SunPower',
  'Complete Solar',
  'Solrite',
  'Solnova',
  'EXO (OLD)',
  'Bryton',
  'One Source',
  'Pacific Coast',
];

export const FINANCERS = [
  'Enfin',
  'Everbright',
  'Mosaic',
  'Solrite',
  'Sunnova',
  'Sunrun',
  'LightReach',
  'Dividend',
  'Wheelhouse',
  'Sungage',
  'Goodleap',
  'Participate',
  'Credit Human',
];

export const PREPAID_OPTIONS = ['HDM', 'PE'];

// Installer pay configs: what percentage of M2 commission is paid at install vs PTO
// installPayPct = 100 means 100% paid at Installed (no M3). < 100 means remainder at PTO.
export interface InstallerPayConfig {
  installPayPct: number; // 0–100
}

export const INSTALLER_PAY_CONFIGS: Record<string, InstallerPayConfig> = {
  'ESP': { installPayPct: 80 },
  'EXO': { installPayPct: 80 },
  'SolarTech': { installPayPct: 100 },
  'GEG': { installPayPct: 80 },
  'SunPower': { installPayPct: 80 },
  'Complete Solar': { installPayPct: 80 },
  'Solrite': { installPayPct: 80 },
  'Solnova': { installPayPct: 80 },
  'Bryton': { installPayPct: 80 },
  'One Source': { installPayPct: 80 },
  'Pacific Coast': { installPayPct: 80 },
};

export const DEFAULT_INSTALL_PAY_PCT = 80;

export const PRODUCT_TYPES = ['PPA', 'Lease', 'Loan', 'Cash'];

export interface Rep {
  id: string;
  firstName: string;
  lastName: string;
  name: string; // computed display name (keep for backward compat)
  email: string;
  phone: string;
  role: 'rep' | 'sub-dealer';
  repType: 'closer' | 'setter' | 'both';
  canRequestBlitz?: boolean;
  canCreateBlitz?: boolean;
}

export interface SubDealer {
  id: string;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
  role: 'sub-dealer';
}

export interface TrainerOverrideTier {
  upToDeal: number | null; // null = perpetual
  ratePerW: number;        // e.g. 0.20 = $0.20/W
}

export interface TrainerAssignment {
  id: string;
  trainerId: string;
  traineeId: string;
  tiers: TrainerOverrideTier[];
}

export function getTrainerOverrideRate(
  assignment: TrainerAssignment,
  completedDeals: number
): number {
  for (const tier of assignment.tiers) {
    if (tier.upToDeal === null || completedDeals < tier.upToDeal) {
      return tier.ratePerW;
    }
  }
  return assignment.tiers[assignment.tiers.length - 1]?.ratePerW ?? 0;
}

export const TRAINER_ASSIGNMENTS: TrainerAssignment[] = [
  {
    id: 'ta1',
    trainerId: 'rep1',   // Alex Rivera is the trainer
    traineeId: 'rep3',   // James Park is the trainee
    tiers: [
      { upToDeal: 10, ratePerW: 0.20 },
      { upToDeal: 25, ratePerW: 0.10 },
      { upToDeal: null, ratePerW: 0.05 },
    ],
  },
  {
    id: 'ta2',
    trainerId: 'rep2',   // Maria Santos is the trainer
    traineeId: 'rep5',   // Jordan Lee is the trainee
    tiers: [
      { upToDeal: 10, ratePerW: 0.20 },
      { upToDeal: null, ratePerW: 0.10 },
    ],
  },
];

export interface Project {
  id: string;
  customerId: string;
  customerName: string;
  repId: string;
  repName: string;
  setterId?: string;
  setterName?: string;
  soldDate: string;
  installer: string;
  financer: string;
  productType: string;
  kWSize: number;
  netPPW: number;
  phase: Phase;
  m1Paid: boolean;
  m1Amount: number;
  m2Paid: boolean;
  m2Amount: number;
  notes: string;
  flagged: boolean;
  // SolarTech-specific: stores the product ID so historical pricing is preserved
  // when SolarTech updates their rates (archived pricing model)
  solarTechProductId?: string;
  // Admin can override the installer baseline for this specific project
  baselineOverride?: InstallerBaseline;
  // Non-SolarTech: stores the InstallerPricingVersion ID active when the deal was sold
  pricingVersionId?: string;
  // Product Catalog installer: stores the product ID (same role as solarTechProductId)
  installerProductId?: string;
  // Product Catalog installer: stores the ProductCatalogPricingVersion ID active when the deal was sold
  pcPricingVersionId?: string;
  prepaidSubType?: string;
  // M3: remaining commission paid at PTO for installers that don't pay 100% at install
  m3Amount?: number;
  // Lead source + blitz attribution
  leadSource?: string;
  blitzId?: string;
  // Cancellation tracking
  cancellationReason?: string;
  cancellationNotes?: string;
  // Sub-dealer attribution
  subDealerId?: string;
  subDealerName?: string;
}

export interface PayrollEntry {
  id: string;
  repId: string;
  repName: string;
  projectId: string | null;
  customerName: string;
  amount: number;
  type: 'Deal' | 'Bonus';
  paymentStage: 'M1' | 'M2' | 'M3' | 'Bonus' | 'Trainer';
  status: 'Draft' | 'Pending' | 'Paid';
  date: string;
  notes: string;
}

export interface Reimbursement {
  id: string;
  repId: string;
  repName: string;
  amount: number;
  description: string;
  date: string;
  status: 'Pending' | 'Approved' | 'Denied' | 'Rejected';
  receiptName?: string;
}

export const REPS: Rep[] = [
  { id: 'rep1', firstName: 'Alex',   lastName: 'Rivera', name: 'Alex Rivera',   email: 'alex@kiloenergy.com',   phone: '(555) 100-0001', role: 'rep', repType: 'both' },
  { id: 'rep2', firstName: 'Maria',  lastName: 'Santos', name: 'Maria Santos',  email: 'maria@kiloenergy.com',  phone: '(555) 100-0002', role: 'rep', repType: 'both' },
  { id: 'rep3', firstName: 'James',  lastName: 'Park',   name: 'James Park',    email: 'james@kiloenergy.com',  phone: '(555) 100-0003', role: 'rep', repType: 'closer' },
  { id: 'rep4', firstName: 'Taylor', lastName: 'Brooks', name: 'Taylor Brooks', email: 'taylor@kiloenergy.com', phone: '(555) 100-0004', role: 'rep', repType: 'setter' },
  { id: 'rep5', firstName: 'Jordan', lastName: 'Lee',    name: 'Jordan Lee',    email: 'jordan@kiloenergy.com', phone: '(555) 100-0005', role: 'rep', repType: 'both' },
];

export const SUB_DEALERS: SubDealer[] = [
  { id: 'sd1', firstName: 'Chris', lastName: 'Nguyen',  name: 'Chris Nguyen',  email: 'chris@solardealers.com',  phone: '(555) 200-0001', role: 'sub-dealer' },
  { id: 'sd2', firstName: 'Dana',  lastName: 'Morales', name: 'Dana Morales',  email: 'dana@greendealers.com',   phone: '(555) 200-0002', role: 'sub-dealer' },
  { id: 'sd3', firstName: 'Pat',   lastName: 'Kim',     name: 'Pat Kim',       email: 'pat@sunstardealers.com',  phone: '(555) 200-0003', role: 'sub-dealer' },
];

export const PROJECTS: Project[] = [
  {
    id: 'proj1',
    customerId: 'cust1',
    customerName: 'Robert & Linda Hawkins',
    repId: 'rep1',
    repName: 'Alex Rivera',
    soldDate: '2025-11-05',
    installer: 'ESP',
    financer: 'Goodleap',
    productType: 'Loan',
    kWSize: 8.4,
    netPPW: 3.55,
    phase: 'PTO',
    m1Paid: true,
    m1Amount: 1890,
    m2Paid: true,
    m2Amount: 1890,
    notes: 'Smooth install, customer very happy.',
    flagged: false,
  },
  {
    id: 'proj2',
    customerId: 'cust2',
    customerName: 'Sandra Nguyen',
    repId: 'rep1',
    repName: 'Alex Rivera',
    soldDate: '2025-12-01',
    installer: 'EXO',
    financer: 'Mosaic',
    productType: 'Loan',
    kWSize: 6.6,
    netPPW: 2.72,
    phase: 'Installed',
    m1Paid: true,
    m1Amount: 950,
    m2Paid: false,
    m2Amount: 700,
    notes: 'PTO application submitted.',
    flagged: false,
  },
  {
    id: 'proj3',
    customerId: 'cust3',
    customerName: 'Derek & Amy Collins',
    repId: 'rep1',
    repName: 'Alex Rivera',
    soldDate: '2026-01-14',
    installer: 'GEG',
    financer: 'Sunrun',
    productType: 'PPA',
    kWSize: 10.2,
    netPPW: 3.1,
    phase: 'Permitting',
    m1Paid: false,
    m1Amount: 1450,
    m2Paid: false,
    m2Amount: 1100,
    notes: '',
    flagged: false,
  },
  {
    id: 'proj4',
    customerId: 'cust4',
    customerName: 'Michelle Tran',
    repId: 'rep2',
    repName: 'Maria Santos',
    soldDate: '2025-10-22',
    installer: 'SolarTech',
    financer: 'Everbright',
    productType: 'Lease',
    kWSize: 7.8,
    netPPW: 2.95,
    phase: 'PTO',
    m1Paid: true,
    m1Amount: 1100,
    m2Paid: true,
    m2Amount: 850,
    notes: 'Great customer, referral sent.',
    flagged: false,
  },
  {
    id: 'proj5',
    customerId: 'cust5',
    customerName: 'Carlos Mendoza',
    repId: 'rep2',
    repName: 'Maria Santos',
    soldDate: '2026-01-08',
    installer: 'Bryton',
    financer: 'Dividend',
    productType: 'Loan',
    kWSize: 9.0,
    netPPW: 2.88,
    phase: 'Design',
    m1Paid: false,
    m1Amount: 1300,
    m2Paid: false,
    m2Amount: 975,
    notes: 'Waiting on HOA approval.',
    flagged: true,
  },
  {
    id: 'proj6',
    customerId: 'cust6',
    customerName: 'Patricia Kim',
    repId: 'rep2',
    repName: 'Maria Santos',
    soldDate: '2026-02-03',
    installer: 'ESP',
    financer: 'Enfin',
    productType: 'PPA',
    kWSize: 5.4,
    netPPW: 3.05,
    phase: 'Acceptance',
    m1Paid: false,
    m1Amount: 750,
    m2Paid: false,
    m2Amount: 600,
    notes: '',
    flagged: false,
  },
  {
    id: 'proj7',
    customerId: 'cust7',
    customerName: 'William Foster',
    repId: 'rep3',
    repName: 'James Park',
    soldDate: '2025-11-30',
    installer: 'Complete Solar',
    financer: 'Sungage',
    productType: 'Loan',
    kWSize: 12.0,
    netPPW: 2.65,
    phase: 'Installed',
    m1Paid: true,
    m1Amount: 1680,
    m2Paid: false,
    m2Amount: 1260,
    notes: 'Large system, commercial adjacent.',
    flagged: false,
  },
  {
    id: 'proj8',
    customerId: 'cust8',
    customerName: 'Helen & Mark Russo',
    repId: 'rep3',
    repName: 'James Park',
    soldDate: '2026-01-20',
    installer: 'Solnova',
    financer: 'LightReach',
    productType: 'Lease',
    kWSize: 7.2,
    netPPW: 3.0,
    phase: 'Site Survey',
    m1Paid: false,
    m1Amount: 1020,
    m2Paid: false,
    m2Amount: 765,
    notes: '',
    flagged: false,
  },
  {
    id: 'proj9',
    customerId: 'cust9',
    customerName: 'Gary Thompson',
    repId: 'rep3',
    repName: 'James Park',
    soldDate: '2026-02-11',
    installer: 'EXO',
    financer: 'Cash',
    productType: 'Cash',
    kWSize: 4.8,
    netPPW: 3.5,
    phase: 'New',
    m1Paid: false,
    m1Amount: 840,
    m2Paid: false,
    m2Amount: 630,
    notes: 'Cash deal, fast close expected.',
    flagged: false,
  },
  {
    id: 'proj10',
    customerId: 'cust10',
    customerName: 'Denise Walker',
    repId: 'rep4',
    repName: 'Taylor Brooks',
    soldDate: '2025-09-14',
    installer: 'SunPower',
    financer: 'Sunnova',
    productType: 'Lease',
    kWSize: 8.0,
    netPPW: 3.2,
    phase: 'Cancelled',
    m1Paid: false,
    m1Amount: 0,
    m2Paid: false,
    m2Amount: 0,
    notes: 'Customer backed out, financing fell through.',
    flagged: false,
  },
  {
    id: 'proj11',
    customerId: 'cust11',
    customerName: 'Bruce & Nancy Patel',
    repId: 'rep4',
    repName: 'Taylor Brooks',
    soldDate: '2026-01-05',
    installer: 'Pacific Coast',
    financer: 'Wheelhouse',
    productType: 'Loan',
    kWSize: 9.6,
    netPPW: 2.78,
    phase: 'Pending Install',
    m1Paid: true,
    m1Amount: 1344,
    m2Paid: false,
    m2Amount: 1008,
    notes: 'Install scheduled for March.',
    flagged: false,
  },
  {
    id: 'proj12',
    customerId: 'cust12',
    customerName: 'Laura Jensen',
    repId: 'rep4',
    repName: 'Taylor Brooks',
    soldDate: '2026-02-20',
    installer: 'Solrite',
    financer: 'Solrite',
    productType: 'Loan',
    kWSize: 6.0,
    netPPW: 2.9,
    phase: 'Acceptance',
    m1Paid: false,
    m1Amount: 870,
    m2Paid: false,
    m2Amount: 650,
    notes: '',
    flagged: false,
  },
  {
    id: 'proj13',
    customerId: 'cust13',
    customerName: 'Kevin & Sara Okonkwo',
    repId: 'rep5',
    repName: 'Jordan Lee',
    soldDate: '2025-12-15',
    installer: 'One Source',
    financer: 'Credit Human',
    productType: 'Loan',
    kWSize: 11.4,
    netPPW: 2.7,
    phase: 'PTO',
    m1Paid: true,
    m1Amount: 1596,
    m2Paid: true,
    m2Amount: 1197,
    notes: '',
    flagged: false,
  },
  {
    id: 'proj14',
    customerId: 'cust14',
    customerName: 'Fiona Castillo',
    repId: 'rep5',
    repName: 'Jordan Lee',
    soldDate: '2026-01-28',
    installer: 'GEG',
    financer: 'Participate',
    productType: 'PPA',
    kWSize: 7.5,
    netPPW: 3.15,
    phase: 'Permitting',
    m1Paid: false,
    m1Amount: 1050,
    m2Paid: false,
    m2Amount: 790,
    notes: 'Permitting taking longer than expected.',
    flagged: false,
  },
  {
    id: 'proj15',
    customerId: 'cust15',
    customerName: 'Thomas & Gwen Burke',
    repId: 'rep5',
    repName: 'Jordan Lee',
    soldDate: '2026-02-14',
    installer: 'ESP',
    financer: 'Mosaic',
    productType: 'Loan',
    kWSize: 8.8,
    netPPW: 2.82,
    phase: 'On Hold',
    m1Paid: false,
    m1Amount: 1232,
    m2Paid: false,
    m2Amount: 924,
    notes: 'HOA dispute, on hold until resolved.',
    flagged: true,
  },
];

// Seed payroll entries reflecting actual project milestone status.
// M1 = created when project reached Acceptance. M2 = created when project reached Installed.
// Status matches the project's m1Paid/m2Paid flags.
export const PAYROLL_ENTRIES: PayrollEntry[] = [
  // proj1 — PTO, m1Paid:true, m2Paid:true (Alex Rivera)
  { id: 'pay_p1_m1', repId: 'rep1', repName: 'Alex Rivera', projectId: 'proj1', customerName: 'Robert & Linda Hawkins', amount: 1890, type: 'Deal', paymentStage: 'M1', status: 'Paid', date: '2025-11-14', notes: '' },
  { id: 'pay_p1_m2', repId: 'rep1', repName: 'Alex Rivera', projectId: 'proj1', customerName: 'Robert & Linda Hawkins', amount: 1890, type: 'Deal', paymentStage: 'M2', status: 'Paid', date: '2025-12-19', notes: '' },
  // proj2 — Installed, m1Paid:true, m2Paid:false (Alex Rivera)
  { id: 'pay_p2_m1', repId: 'rep1', repName: 'Alex Rivera', projectId: 'proj2', customerName: 'Sandra Nguyen', amount: 950, type: 'Deal', paymentStage: 'M1', status: 'Paid', date: '2025-12-12', notes: '' },
  { id: 'pay_p2_m2', repId: 'rep1', repName: 'Alex Rivera', projectId: 'proj2', customerName: 'Sandra Nguyen', amount: 700, type: 'Deal', paymentStage: 'M2', status: 'Draft', date: '2026-03-28', notes: '' },
  // proj3 — Permitting, past Acceptance (Alex Rivera)
  { id: 'pay_p3_m1', repId: 'rep1', repName: 'Alex Rivera', projectId: 'proj3', customerName: 'Derek & Amy Collins', amount: 1450, type: 'Deal', paymentStage: 'M1', status: 'Paid', date: '2026-01-24', notes: '' },
  // proj4 — PTO, m1Paid:true, m2Paid:true (Maria Santos)
  { id: 'pay_p4_m1', repId: 'rep2', repName: 'Maria Santos', projectId: 'proj4', customerName: 'Michelle Tran', amount: 1100, type: 'Deal', paymentStage: 'M1', status: 'Paid', date: '2025-10-31', notes: '' },
  { id: 'pay_p4_m2', repId: 'rep2', repName: 'Maria Santos', projectId: 'proj4', customerName: 'Michelle Tran', amount: 850, type: 'Deal', paymentStage: 'M2', status: 'Paid', date: '2025-12-05', notes: '' },
  // proj5 — Design, past Acceptance (Maria Santos)
  { id: 'pay_p5_m1', repId: 'rep2', repName: 'Maria Santos', projectId: 'proj5', customerName: 'Carlos Mendoza', amount: 1300, type: 'Deal', paymentStage: 'M1', status: 'Pending', date: '2026-01-17', notes: '' },
  // proj6 — Acceptance (Maria Santos) — M1 just drafted
  { id: 'pay_p6_m1', repId: 'rep2', repName: 'Maria Santos', projectId: 'proj6', customerName: 'Patricia Kim', amount: 750, type: 'Deal', paymentStage: 'M1', status: 'Draft', date: '2026-04-04', notes: '' },
  // proj7 — Installed, m1Paid:true, m2Paid:false (James Park)
  { id: 'pay_p7_m1', repId: 'rep3', repName: 'James Park', projectId: 'proj7', customerName: 'William Foster', amount: 1680, type: 'Deal', paymentStage: 'M1', status: 'Paid', date: '2025-12-12', notes: '' },
  { id: 'pay_p7_m2', repId: 'rep3', repName: 'James Park', projectId: 'proj7', customerName: 'William Foster', amount: 1260, type: 'Deal', paymentStage: 'M2', status: 'Pending', date: '2026-03-28', notes: '' },
  // proj8 — Site Survey, past Acceptance (James Park)
  { id: 'pay_p8_m1', repId: 'rep3', repName: 'James Park', projectId: 'proj8', customerName: 'Helen & Mark Russo', amount: 1020, type: 'Deal', paymentStage: 'M1', status: 'Pending', date: '2026-01-31', notes: '' },
  // proj9 — New (James Park) — no payroll yet
  // proj10 — Cancelled (Taylor Brooks) — no entries (m1Amount: 0)
  // proj11 — Pending Install, m1Paid:true (Taylor Brooks)
  { id: 'pay_p11_m1', repId: 'rep4', repName: 'Taylor Brooks', projectId: 'proj11', customerName: 'Bruce & Nancy Patel', amount: 1344, type: 'Deal', paymentStage: 'M1', status: 'Paid', date: '2026-01-17', notes: '' },
  // proj12 — Acceptance (Taylor Brooks) — M1 just drafted
  { id: 'pay_p12_m1', repId: 'rep4', repName: 'Taylor Brooks', projectId: 'proj12', customerName: 'Laura Jensen', amount: 870, type: 'Deal', paymentStage: 'M1', status: 'Draft', date: '2026-04-04', notes: '' },
  // proj13 — PTO, m1Paid:true, m2Paid:true (Jordan Lee)
  { id: 'pay_p13_m1', repId: 'rep5', repName: 'Jordan Lee', projectId: 'proj13', customerName: 'Kevin & Sara Okonkwo', amount: 1596, type: 'Deal', paymentStage: 'M1', status: 'Paid', date: '2025-12-26', notes: '' },
  { id: 'pay_p13_m2', repId: 'rep5', repName: 'Jordan Lee', projectId: 'proj13', customerName: 'Kevin & Sara Okonkwo', amount: 1197, type: 'Deal', paymentStage: 'M2', status: 'Paid', date: '2026-01-31', notes: '' },
  // proj14 — Permitting, past Acceptance (Jordan Lee)
  { id: 'pay_p14_m1', repId: 'rep5', repName: 'Jordan Lee', projectId: 'proj14', customerName: 'Fiona Castillo', amount: 1050, type: 'Deal', paymentStage: 'M1', status: 'Pending', date: '2026-02-07', notes: '' },
  // proj15 — On Hold (Jordan Lee) — no new entries (was past Acceptance before hold)
  { id: 'pay_p15_m1', repId: 'rep5', repName: 'Jordan Lee', projectId: 'proj15', customerName: 'Thomas & Gwen Burke', amount: 1232, type: 'Deal', paymentStage: 'M1', status: 'Draft', date: '2026-02-21', notes: '' },
  // ── Trainer override entries ──
  // Alex Rivera (rep1) earns trainer overrides from trainee James Park (rep3)
  { id: 'pay_t1_p7', repId: 'rep1', repName: 'Alex Rivera', projectId: 'proj7', customerName: 'William Foster', amount: 1680, type: 'Deal', paymentStage: 'Trainer', status: 'Paid', date: '2025-12-12', notes: 'Trainer override — James Park (Deal 1, $0.20/W)' },
  { id: 'pay_t1_p8', repId: 'rep1', repName: 'Alex Rivera', projectId: 'proj8', customerName: 'Helen & Mark Russo', amount: 1020, type: 'Deal', paymentStage: 'Trainer', status: 'Pending', date: '2026-01-31', notes: 'Trainer override — James Park (Deal 2, $0.20/W)' },
  // Maria Santos (rep2) earns trainer overrides from trainee Jordan Lee (rep5)
  { id: 'pay_t2_p13', repId: 'rep2', repName: 'Maria Santos', projectId: 'proj13', customerName: 'Kevin & Sara Okonkwo', amount: 1596, type: 'Deal', paymentStage: 'Trainer', status: 'Paid', date: '2025-12-26', notes: 'Trainer override — Jordan Lee (Deal 1, $0.20/W)' },
  { id: 'pay_t2_p14', repId: 'rep2', repName: 'Maria Santos', projectId: 'proj14', customerName: 'Fiona Castillo', amount: 1050, type: 'Deal', paymentStage: 'Trainer', status: 'Pending', date: '2026-02-07', notes: 'Trainer override — Jordan Lee (Deal 2, $0.20/W)' },
  { id: 'pay_t2_p15', repId: 'rep2', repName: 'Maria Santos', projectId: 'proj15', customerName: 'Thomas & Gwen Burke', amount: 1232, type: 'Deal', paymentStage: 'Trainer', status: 'Draft', date: '2026-02-21', notes: 'Trainer override — Jordan Lee (Deal 3, $0.20/W)' },
];

const _SEED_PAYROLL_ENTRIES: PayrollEntry[] = [
  {
    id: 'pay1',
    repId: 'rep1',
    repName: 'Alex Rivera',
    projectId: 'proj1',
    customerName: 'Robert & Linda Hawkins',
    amount: 1200,
    type: 'Deal',
    paymentStage: 'M1',
    status: 'Paid',
    date: '2025-12-01',
    notes: '',
  },
  {
    id: 'pay2',
    repId: 'rep1',
    repName: 'Alex Rivera',
    projectId: 'proj1',
    customerName: 'Robert & Linda Hawkins',
    amount: 900,
    type: 'Deal',
    paymentStage: 'M2',
    status: 'Paid',
    date: '2026-01-15',
    notes: '',
  },
  {
    id: 'pay3',
    repId: 'rep2',
    repName: 'Maria Santos',
    projectId: 'proj4',
    customerName: 'Michelle Tran',
    amount: 1100,
    type: 'Deal',
    paymentStage: 'M1',
    status: 'Paid',
    date: '2025-11-20',
    notes: '',
  },
  {
    id: 'pay4',
    repId: 'rep3',
    repName: 'James Park',
    projectId: 'proj7',
    customerName: 'William Foster',
    amount: 1680,
    type: 'Deal',
    paymentStage: 'M1',
    status: 'Paid',
    date: '2026-01-05',
    notes: '',
  },
  {
    id: 'pay5',
    repId: 'rep5',
    repName: 'Jordan Lee',
    projectId: 'proj13',
    customerName: 'Kevin & Sara Okonkwo',
    amount: 1596,
    type: 'Deal',
    paymentStage: 'M1',
    status: 'Paid',
    date: '2026-01-20',
    notes: '',
  },
  {
    id: 'pay6',
    repId: 'rep4',
    repName: 'Taylor Brooks',
    projectId: 'proj11',
    customerName: 'Bruce & Nancy Patel',
    amount: 1344,
    type: 'Deal',
    paymentStage: 'M1',
    status: 'Pending',
    date: '2026-02-10',
    notes: '',
  },
  {
    id: 'pay7',
    repId: 'rep1',
    repName: 'Alex Rivera',
    projectId: null,
    customerName: '',
    amount: 500,
    type: 'Bonus',
    paymentStage: 'Bonus',
    status: 'Pending',
    date: '2026-02-28',
    notes: 'Q4 performance bonus',
  },
  {
    id: 'pay8',
    repId: 'rep2',
    repName: 'Maria Santos',
    projectId: null,
    customerName: '',
    amount: 750,
    type: 'Bonus',
    paymentStage: 'Bonus',
    status: 'Draft',
    date: '2026-03-01',
    notes: 'Referral bonus — 3 deals',
  },
]; // end _SEED_PAYROLL_ENTRIES (archived — payroll entries now auto-created on milestones)

export const REIMBURSEMENTS: Reimbursement[] = [
  {
    id: 'reimb1',
    repId: 'rep1',
    repName: 'Alex Rivera',
    amount: 45.5,
    description: 'Gas mileage — site visits',
    date: '2026-02-15',
    status: 'Approved',
    receiptName: 'receipt_feb.pdf',
  },
  {
    id: 'reimb2',
    repId: 'rep3',
    repName: 'James Park',
    amount: 120.0,
    description: 'Client lunch',
    date: '2026-02-20',
    status: 'Pending',
    receiptName: 'lunch_receipt.jpg',
  },
  {
    id: 'reimb3',
    repId: 'rep5',
    repName: 'Jordan Lee',
    amount: 30.0,
    description: 'Printed marketing materials',
    date: '2026-03-01',
    status: 'Pending',
    receiptName: 'print_receipt.pdf',
  },
];

// Baseline pricing table: Closer/Setter/Kilo rates in $/W by financer+productType+kW tier
// Setter baseline = Closer baseline + $0.10/W
// Commission = (soldPPW - baseline) × kW × 1000
export interface BaselineRate {
  id: string;
  financer: string;
  productType: string;
  tierMinKW: number;
  tierMaxKW: number | null; // null = no upper limit
  closerPerW: number;  // Closer baseline $/W
  kiloPerW: number;    // Kilo (company) baseline $/W
}

export const BASELINE_RATES: BaselineRate[] = [
  // Goodleap / Loan
  { id: 'b1',  financer: 'Goodleap',     productType: 'Loan',  tierMinKW: 1,    tierMaxKW: 5,    closerPerW: 3.45, kiloPerW: 2.90 },
  { id: 'b2',  financer: 'Goodleap',     productType: 'Loan',  tierMinKW: 5,    tierMaxKW: 10,   closerPerW: 3.10, kiloPerW: 2.50 },
  { id: 'b3',  financer: 'Goodleap',     productType: 'Loan',  tierMinKW: 10,   tierMaxKW: 13,   closerPerW: 2.90, kiloPerW: 2.35 },
  { id: 'b4',  financer: 'Goodleap',     productType: 'Loan',  tierMinKW: 13,   tierMaxKW: null, closerPerW: 2.85, kiloPerW: 2.35 },
  // Mosaic / Loan
  { id: 'b5',  financer: 'Mosaic',       productType: 'Loan',  tierMinKW: 1,    tierMaxKW: 5,    closerPerW: 3.25, kiloPerW: 2.75 },
  { id: 'b6',  financer: 'Mosaic',       productType: 'Loan',  tierMinKW: 5,    tierMaxKW: 10,   closerPerW: 3.00, kiloPerW: 2.45 },
  { id: 'b7',  financer: 'Mosaic',       productType: 'Loan',  tierMinKW: 10,   tierMaxKW: 13,   closerPerW: 2.75, kiloPerW: 2.20 },
  { id: 'b8',  financer: 'Mosaic',       productType: 'Loan',  tierMinKW: 13,   tierMaxKW: null, closerPerW: 2.70, kiloPerW: 2.20 },
  // Sunrun / PPA
  { id: 'b9',  financer: 'Sunrun',       productType: 'PPA',   tierMinKW: 1,    tierMaxKW: 5,    closerPerW: 3.60, kiloPerW: 3.15 },
  { id: 'b10', financer: 'Sunrun',       productType: 'PPA',   tierMinKW: 5,    tierMaxKW: 10,   closerPerW: 3.30, kiloPerW: 2.75 },
  { id: 'b11', financer: 'Sunrun',       productType: 'PPA',   tierMinKW: 10,   tierMaxKW: 13,   closerPerW: 3.15, kiloPerW: 2.60 },
  { id: 'b12', financer: 'Sunrun',       productType: 'PPA',   tierMinKW: 13,   tierMaxKW: null, closerPerW: 3.10, kiloPerW: 2.60 },
  // Everbright / Lease
  { id: 'b13', financer: 'Everbright',   productType: 'Lease', tierMinKW: 1,    tierMaxKW: 5,    closerPerW: 3.45, kiloPerW: 2.95 },
  { id: 'b14', financer: 'Everbright',   productType: 'Lease', tierMinKW: 5,    tierMaxKW: 10,   closerPerW: 3.05, kiloPerW: 2.50 },
  { id: 'b15', financer: 'Everbright',   productType: 'Lease', tierMinKW: 10,   tierMaxKW: 13,   closerPerW: 3.00, kiloPerW: 2.45 },
  { id: 'b16', financer: 'Everbright',   productType: 'Lease', tierMinKW: 13,   tierMaxKW: null, closerPerW: 2.95, kiloPerW: 2.45 },
  // LightReach / Lease
  { id: 'b17', financer: 'LightReach',   productType: 'Lease', tierMinKW: 1,    tierMaxKW: 5,    closerPerW: 3.45, kiloPerW: 2.95 },
  { id: 'b18', financer: 'LightReach',   productType: 'Lease', tierMinKW: 5,    tierMaxKW: 10,   closerPerW: 3.05, kiloPerW: 2.50 },
  { id: 'b19', financer: 'LightReach',   productType: 'Lease', tierMinKW: 10,   tierMaxKW: 13,   closerPerW: 3.00, kiloPerW: 2.45 },
  { id: 'b20', financer: 'LightReach',   productType: 'Lease', tierMinKW: 13,   tierMaxKW: null, closerPerW: 2.95, kiloPerW: 2.45 },
  // Sunnova / Lease
  { id: 'b21', financer: 'Sunnova',      productType: 'Lease', tierMinKW: 1,    tierMaxKW: 5,    closerPerW: 3.35, kiloPerW: 2.80 },
  { id: 'b22', financer: 'Sunnova',      productType: 'Lease', tierMinKW: 5,    tierMaxKW: null, closerPerW: 3.20, kiloPerW: 2.65 },
  // Enfin / Loan
  { id: 'b23', financer: 'Enfin',        productType: 'Loan',  tierMinKW: 1,    tierMaxKW: 5,    closerPerW: 3.25, kiloPerW: 2.75 },
  { id: 'b24', financer: 'Enfin',        productType: 'Loan',  tierMinKW: 5,    tierMaxKW: null, closerPerW: 2.90, kiloPerW: 2.35 },
  // Enfin / PPA
  { id: 'b25', financer: 'Enfin',        productType: 'PPA',   tierMinKW: 1,    tierMaxKW: 5,    closerPerW: 3.40, kiloPerW: 2.90 },
  { id: 'b26', financer: 'Enfin',        productType: 'PPA',   tierMinKW: 5,    tierMaxKW: null, closerPerW: 3.05, kiloPerW: 2.50 },
  // Dividend / Loan
  { id: 'b27', financer: 'Dividend',     productType: 'Loan',  tierMinKW: 1,    tierMaxKW: 5,    closerPerW: 3.30, kiloPerW: 2.80 },
  { id: 'b28', financer: 'Dividend',     productType: 'Loan',  tierMinKW: 5,    tierMaxKW: 10,   closerPerW: 2.90, kiloPerW: 2.35 },
  { id: 'b29', financer: 'Dividend',     productType: 'Loan',  tierMinKW: 10,   tierMaxKW: null, closerPerW: 2.85, kiloPerW: 2.30 },
  // Sungage / Loan
  { id: 'b30', financer: 'Sungage',      productType: 'Loan',  tierMinKW: 1,    tierMaxKW: 5,    closerPerW: 3.15, kiloPerW: 2.65 },
  { id: 'b31', financer: 'Sungage',      productType: 'Loan',  tierMinKW: 5,    tierMaxKW: null, closerPerW: 3.00, kiloPerW: 2.45 },
  // Wheelhouse / Loan
  { id: 'b32', financer: 'Wheelhouse',   productType: 'Loan',  tierMinKW: 1,    tierMaxKW: 5,    closerPerW: 3.20, kiloPerW: 2.70 },
  { id: 'b33', financer: 'Wheelhouse',   productType: 'Loan',  tierMinKW: 5,    tierMaxKW: null, closerPerW: 2.95, kiloPerW: 2.40 },
  // Credit Human / Loan
  { id: 'b34', financer: 'Credit Human', productType: 'Loan',  tierMinKW: 1,    tierMaxKW: 5,    closerPerW: 3.25, kiloPerW: 2.75 },
  { id: 'b35', financer: 'Credit Human', productType: 'Loan',  tierMinKW: 5,    tierMaxKW: null, closerPerW: 2.95, kiloPerW: 2.40 },
  // Participate / PPA
  { id: 'b36', financer: 'Participate',  productType: 'PPA',   tierMinKW: 1,    tierMaxKW: 5,    closerPerW: 3.35, kiloPerW: 2.90 },
  { id: 'b37', financer: 'Participate',  productType: 'PPA',   tierMinKW: 5,    tierMaxKW: null, closerPerW: 3.05, kiloPerW: 2.50 },
  // Cash / Cash
  { id: 'b38', financer: 'Cash',         productType: 'Cash',  tierMinKW: 1,    tierMaxKW: 5,    closerPerW: 3.10, kiloPerW: 2.60 },
  { id: 'b39', financer: 'Cash',         productType: 'Cash',  tierMinKW: 5,    tierMaxKW: null, closerPerW: 2.75, kiloPerW: 2.20 },
  // Solrite / Loan (generic fallback for Solrite financer)
  { id: 'b40', financer: 'Solrite',      productType: 'Loan',  tierMinKW: 1,    tierMaxKW: null, closerPerW: 3.00, kiloPerW: 2.45 },
];

// Returns the baseline rate for a deal. Falls back to a default if no match found.
// NOTE: This generic lookup is kept for backward compat. For new deals, use
// getSolarTechBaseline() for SolarTech or getNonSolarTechBaseline() for others.
export function getBaselineRate(financer: string, productType: string, kW: number): { closerPerW: number; kiloPerW: number } {
  const match = BASELINE_RATES.find(
    (r) =>
      r.financer === financer &&
      r.productType === productType &&
      kW >= r.tierMinKW &&
      (r.tierMaxKW === null || kW < r.tierMaxKW)
  );
  if (match) return { closerPerW: match.closerPerW, kiloPerW: match.kiloPerW };
  // Generic fallback by product type
  const byType = BASELINE_RATES.find((r) => r.productType === productType);
  if (byType) return { closerPerW: byType.closerPerW, kiloPerW: byType.kiloPerW };
  return { closerPerW: 3.00, kiloPerW: 2.45 };
}

// ─── SolarTech Equipment-Specific Pricing ─────────────────────────────────────
// SolarTech is the only installer with per-product, per-kW-tier pricing.
// Financer is determined by the product family (not selected separately).
// Setter baseline = Closer baseline + $0.10/W always.
// Pricing is archived in Glide — store solarTechProductId on projects so
// commission calculations remain correct even when rates change.

export interface SolarTechTier {
  minKW: number;
  maxKW: number | null; // null = no upper limit
  closerPerW: number;
  setterPerW: number;  // always closerPerW + 0.10
  kiloPerW: number;
  subDealerPerW?: number;
}

export interface SolarTechProduct {
  id: string;
  family: string;       // Goodleap | Enfin | Lightreach | Cash/HDM/PE
  financer: string;     // auto-derived from family
  name: string;
  tiers: SolarTechTier[];
}

export const SOLARTECH_FAMILIES = ['Goodleap', 'Enfin', 'Lightreach', 'Cash/HDM/PE'] as const;
export type SolarTechFamily = typeof SOLARTECH_FAMILIES[number];

export const SOLARTECH_FAMILY_FINANCER: Record<string, string> = {
  'Goodleap': 'Goodleap',
  'Enfin': 'Enfin',
  'Lightreach': 'LightReach',
  'Cash/HDM/PE': 'Cash',
};

// Helper to build tiers array from parallel closer/kilo arrays
// subDealerOffset: if provided, subDealerPerW = kiloPerW + offset (e.g., 0.30)
function makeTiers(closer: number[], kilo: number[], subDealerOffset?: number): SolarTechTier[] {
  const breaks = [1, 5, 10, 13];
  return closer.map((c, i) => ({
    minKW: breaks[i],
    maxKW: i < breaks.length - 1 ? breaks[i + 1] : null,
    closerPerW: c,
    setterPerW: Math.round((c + 0.10) * 100) / 100,
    kiloPerW: kilo[i],
    ...(subDealerOffset != null ? { subDealerPerW: Math.round((kilo[i] + subDealerOffset) * 100) / 100 } : {}),
  }));
}

export const SOLARTECH_PRODUCTS: SolarTechProduct[] = [
  // ── Goodleap Family ──────────────────────────────────────────────────────────
  {
    id: 'gl-qpeak-enphase',
    family: 'Goodleap',
    financer: 'Goodleap',
    name: 'Q.Peak DUO BLK ML-G10.C+ 410 + Enphase IQ8HC',
    tiers: makeTiers([3.45, 3.10, 2.90, 2.85], [2.90, 2.50, 2.35, 2.35], 0.30),
  },
  {
    id: 'gl-qtron-1pw3',
    family: 'Goodleap',
    financer: 'Goodleap',
    name: 'Q.TRON + 1x Powerwall 3',
    tiers: makeTiers([5.98, 4.57, 3.66, 3.61], [5.43, 3.97, 3.11, 3.11], 0.30),
  },
  {
    id: 'gl-qtron-2pw3',
    family: 'Goodleap',
    financer: 'Goodleap',
    name: 'Q.TRON + 2x Powerwall 3',
    tiers: makeTiers([8.28, 5.94, 4.47, 4.42], [7.73, 5.34, 3.92, 3.92], 0.30),
  },
  {
    id: 'gl-qtron-3pw3',
    family: 'Goodleap',
    financer: 'Goodleap',
    name: 'Q.TRON + 3x Powerwall 3',
    tiers: makeTiers([10.58, 7.30, 5.29, 5.24], [10.03, 6.70, 4.74, 4.74], 0.30),
  },
  {
    id: 'gl-hyundai-dc-pw3',
    family: 'Goodleap',
    financer: 'Goodleap',
    name: 'Hyundai 440 DC + Powerwall 3',
    tiers: makeTiers([2.85, 2.60, 2.50, 2.45], [2.35, 1.95, 1.90, 1.90], 0.30),
  },
  {
    id: 'gl-hyundai-enphase',
    family: 'Goodleap',
    financer: 'Goodleap',
    name: 'Hyundai 440 + Enphase',
    tiers: makeTiers([3.20, 2.90, 2.80, 2.75], [2.70, 2.25, 2.20, 2.20], 0.30),
  },
  {
    id: 'gl-spr-dc-pw3',
    family: 'Goodleap',
    financer: 'Goodleap',
    name: 'SPR-MAX3 DC + Powerwall 3',
    tiers: makeTiers([2.90, 2.65, 2.50, 2.45], [2.40, 2.00, 1.90, 1.90], 0.30),
  },
  {
    id: 'gl-spr-enphase',
    family: 'Goodleap',
    financer: 'Goodleap',
    name: 'SPR-MAX3 + Enphase',
    tiers: makeTiers([3.30, 3.05, 2.90, 2.85], [2.80, 2.40, 2.30, 2.30], 0.30),
  },

  // ── Enfin Family ─────────────────────────────────────────────────────────────
  {
    id: 'ef-qpeak-dc-pw3',
    family: 'Enfin',
    financer: 'Enfin',
    name: 'Q.Peak DUO DC + Powerwall 3',
    tiers: makeTiers([3.20, 2.85, 2.80, 2.75], [2.70, 2.30, 2.25, 2.25], 0.30),
  },
  {
    id: 'ef-qpeak-tesla',
    family: 'Enfin',
    financer: 'Enfin',
    name: 'Q.Peak DUO + Tesla PVI',
    tiers: makeTiers([3.40, 3.05, 2.95, 2.90], [2.90, 2.50, 2.40, 2.40], 0.30),
  },
  {
    id: 'ef-qpeak-enphase',
    family: 'Enfin',
    financer: 'Enfin',
    name: 'Q.Peak DUO + Enphase',
    tiers: makeTiers([3.25, 2.90, 2.75, 2.70], [2.75, 2.35, 2.20, 2.20], 0.30),
  },

  // ── LightReach Family ────────────────────────────────────────────────────────
  {
    id: 'lr-hyundai-dc-pw3',
    family: 'Lightreach',
    financer: 'LightReach',
    name: 'Hyundai 440 DC + Powerwall 3',
    tiers: makeTiers([3.10, 2.75, 2.70, 2.65], [2.60, 2.20, 2.15, 2.15], 0.30),
  },
  {
    id: 'lr-hyundai-tesla',
    family: 'Lightreach',
    financer: 'LightReach',
    name: 'Hyundai 440 + Tesla PVI',
    tiers: makeTiers([3.30, 2.90, 2.85, 2.80], [2.80, 2.35, 2.30, 2.30], 0.30),
  },
  {
    id: 'lr-hyundai-enphase',
    family: 'Lightreach',
    financer: 'LightReach',
    name: 'Hyundai 440 + Enphase',
    tiers: makeTiers([3.45, 3.05, 3.00, 2.95], [2.95, 2.50, 2.45, 2.45], 0.30),
  },
  {
    id: 'lr-spr-tesla',
    family: 'Lightreach',
    financer: 'LightReach',
    name: 'SPR-MAX3 + Tesla PVI',
    tiers: makeTiers([3.30, 3.00, 2.90, 2.85], [2.85, 2.45, 2.35, 2.35], 0.30),
  },
  {
    id: 'lr-spr-dc-pw3',
    family: 'Lightreach',
    financer: 'LightReach',
    name: 'SPR-MAX3 DC + Powerwall 3',
    tiers: makeTiers([3.10, 2.80, 2.70, 2.65], [2.65, 2.25, 2.15, 2.15], 0.30),
  },
  {
    id: 'lr-qpeak-tesla',
    family: 'Lightreach',
    financer: 'LightReach',
    name: 'Q.Peak DUO + Tesla PVI',
    tiers: makeTiers([3.35, 3.05, 2.95, 2.90], [2.90, 2.50, 2.40, 2.40], 0.30),
  },
  {
    id: 'lr-qpeak-enphase',
    family: 'Lightreach',
    financer: 'LightReach',
    name: 'Q.Peak DUO + Enphase',
    tiers: makeTiers([3.60, 3.30, 3.15, 3.10], [3.15, 2.75, 2.60, 2.60], 0.30),
  },
  {
    id: 'lr-qpeak-dc-pw3',
    family: 'Lightreach',
    financer: 'LightReach',
    name: 'Q.Peak DUO DC + Powerwall 3',
    tiers: makeTiers([3.15, 2.85, 2.80, 2.75], [2.70, 2.30, 2.25, 2.25], 0.30),
  },
  {
    id: 'lr-spr-enphase',
    family: 'Lightreach',
    financer: 'LightReach',
    name: 'SPR-MAX3 + Enphase',
    tiers: makeTiers([3.50, 3.20, 3.10, 3.05], [3.05, 2.65, 2.55, 2.55], 0.30),
  },

  // ── Cash/HDM/PE Family ───────────────────────────────────────────────────────
  {
    id: 'ca-hyundai-dc-pw3',
    family: 'Cash/HDM/PE',
    financer: 'Cash',
    name: 'Hyundai/SEG 440 DC + Powerwall 3',
    tiers: makeTiers([3.10, 2.75, 2.70, 2.65], [2.60, 2.20, 2.15, 2.15], 0.30),
  },
  {
    id: 'ca-hyundai-tesla',
    family: 'Cash/HDM/PE',
    financer: 'Cash',
    name: 'Hyundai/SEG 440 + Tesla PVI',
    tiers: makeTiers([3.30, 2.90, 2.85, 2.80], [2.80, 2.35, 2.30, 2.30], 0.30),
  },
  {
    id: 'ca-hyundai-enphase',
    family: 'Cash/HDM/PE',
    financer: 'Cash',
    name: 'Hyundai/SEG 440 + Enphase',
    tiers: makeTiers([3.45, 3.05, 3.00, 2.95], [2.95, 2.50, 2.45, 2.45], 0.30),
  },
  {
    id: 'ca-spr-dc-pw3',
    family: 'Cash/HDM/PE',
    financer: 'Cash',
    name: 'SPR-MAX3 DC + Powerwall 3',
    tiers: makeTiers([3.10, 2.80, 2.70, 2.65], [2.65, 2.25, 2.15, 2.15], 0.30),
  },
  {
    id: 'ca-spr-tesla',
    family: 'Cash/HDM/PE',
    financer: 'Cash',
    name: 'SPR-MAX3 + Tesla PVI',
    tiers: makeTiers([3.30, 3.00, 2.90, 2.85], [2.85, 2.45, 2.35, 2.35], 0.30),
  },
  {
    id: 'ca-spr-enphase',
    family: 'Cash/HDM/PE',
    financer: 'Cash',
    name: 'SPR-MAX3 + Enphase',
    tiers: makeTiers([3.50, 3.20, 3.10, 3.05], [3.05, 2.65, 2.55, 2.55], 0.30),
  },
  {
    id: 'ca-qpeak-dc-pw3',
    family: 'Cash/HDM/PE',
    financer: 'Cash',
    name: 'Q.Peak DUO DC + Powerwall 3',
    tiers: makeTiers([3.15, 2.85, 2.80, 2.75], [2.70, 2.30, 2.25, 2.25], 0.30),
  },
  {
    id: 'ca-qpeak-tesla',
    family: 'Cash/HDM/PE',
    financer: 'Cash',
    name: 'Q.Peak DUO + Tesla PVI',
    tiers: makeTiers([3.35, 3.05, 2.95, 2.90], [2.90, 2.50, 2.40, 2.40], 0.30),
  },
  {
    id: 'ca-qpeak-enphase',
    family: 'Cash/HDM/PE',
    financer: 'Cash',
    name: 'Q.Peak DUO + Enphase',
    tiers: makeTiers([3.60, 3.30, 3.15, 3.10], [3.15, 2.75, 2.60, 2.60], 0.30),
  },
];

export function getSolarTechBaseline(
  productId: string,
  kW: number
): { closerPerW: number; setterPerW: number; kiloPerW: number } {
  const product = SOLARTECH_PRODUCTS.find((p) => p.id === productId);
  if (!product) return { closerPerW: 0, setterPerW: 0, kiloPerW: 0 };
  const tier = product.tiers.find(
    (t) => kW >= t.minKW && (t.maxKW === null || kW < t.maxKW)
  );
  if (!tier) return { closerPerW: 0, setterPerW: 0, kiloPerW: 0 };
  return { closerPerW: tier.closerPerW, setterPerW: tier.setterPerW, kiloPerW: tier.kiloPerW };
}

// ─── Non-SolarTech Installer Baselines ───────────────────────────────────────
// All other installers use a flat closer baseline (no kW tiers, no financer dependency).
// Setter baseline = closerPerW + $0.10/W.
// kiloPerW = what Kilo pays the installer (their KILO Baseline field in Glide admin).

export interface InstallerBaseline {
  closerPerW: number;
  kiloPerW: number;
  setterPerW?: number;
  subDealerPerW?: number;
}

// ─── Installer Pricing Version System (Standard track only) ──────────────────
// Standard installers use a flat rate per watt.
// Each version has an effectiveFrom / effectiveTo date range so historical deals
// stay locked to the rates that were in effect when the deal was sold.

export interface InstallerFlatRate {
  type: 'flat';
  closerPerW: number;
  setterPerW?: number; // undefined = auto (closerPerW + $0.10)
  kiloPerW: number;
  subDealerPerW?: number;
}

export interface InstallerTieredKWBand {
  minKW: number;
  maxKW: number | null;
  closerPerW: number;
  setterPerW?: number; // undefined = auto (closerPerW + $0.10)
  kiloPerW: number;
  subDealerPerW?: number;
}

export interface InstallerTieredRate {
  type: 'tiered';
  bands: InstallerTieredKWBand[];
}

// InstallerRates supports both flat and tiered structures.
// Product Catalog installers (SolarTech-style) use ProductCatalogProduct instead.
export type InstallerRates = InstallerFlatRate | InstallerTieredRate;

export interface InstallerPricingVersion {
  id: string;
  installer: string;
  label: string;           // e.g. "v1 — Jan 2020"
  effectiveFrom: string;   // ISO date 'YYYY-MM-DD'
  effectiveTo: string | null; // null = currently active
  rates: InstallerRates;
}

// ─── Product Catalog Installer System ────────────────────────────────────────
// Mirrors the SolarTech model: multiple named products, grouped by financer family,
// each with kW-tier pricing. Any installer can use this structure.

export interface ProductCatalogTier {
  minKW: number;
  maxKW: number | null;
  closerPerW: number;
  setterPerW: number;
  kiloPerW: number;
  subDealerPerW?: number;
}

export interface ProductCatalogProduct {
  id: string;
  installer: string;
  family: string;
  name: string;
  tiers: ProductCatalogTier[];
}

// Per-installer config: which families exist and which financer each family maps to
export interface ProductCatalogInstallerConfig {
  families: string[];
  familyFinancerMap?: Record<string, string>; // optional label hints only — not used for deal financer selection
  prepaidFamily?: string; // which family is the prepaid family (only compatible with Cash/Loan product types)
}

export const PRODUCT_CATALOG_INSTALLER_CONFIGS: Record<string, ProductCatalogInstallerConfig> = {};
export const PRODUCT_CATALOG_PRODUCTS: ProductCatalogProduct[] = [];

// ─── Product Catalog Pricing Versions ────────────────────────────────────────
// Mirrors InstallerPricingVersion but for product-level tiered pricing.
// Each version snapshots the tiers for a specific product over a date range.

export interface ProductCatalogPricingVersion {
  id: string;
  productId: string;       // which ProductCatalogProduct this version is for
  label: string;           // e.g. "v1 — Jan 2026"
  effectiveFrom: string;   // ISO date 'YYYY-MM-DD'
  effectiveTo: string | null; // null = currently active
  tiers: ProductCatalogTier[];
}

export const PRODUCT_CATALOG_PRICING_VERSIONS: ProductCatalogPricingVersion[] = [];

// Builds 4 standard kW tiers (1–5, 5–10, 10–13, 13+) from parallel closer/kilo arrays
export function makeProductCatalogTiers(closer: number[], kilo: number[], subDealerOffset?: number): ProductCatalogTier[] {
  const breaks = [1, 5, 10, 13];
  return closer.map((c, i) => ({
    minKW: breaks[i],
    maxKW: i < breaks.length - 1 ? breaks[i + 1] : null,
    closerPerW: c,
    setterPerW: Math.round((c + 0.10) * 100) / 100,
    kiloPerW: kilo[i],
    ...(subDealerOffset != null ? { subDealerPerW: Math.round((kilo[i] + subDealerOffset) * 100) / 100 } : {}),
  }));
}

export function getProductCatalogBaseline(
  products: ProductCatalogProduct[],
  productId: string,
  kW: number,
): { closerPerW: number; setterPerW: number; kiloPerW: number } {
  const product = products.find((p) => p.id === productId);
  if (!product) return { closerPerW: 0, setterPerW: 0, kiloPerW: 0 };
  const tier = product.tiers.find((t) => kW >= t.minKW && (t.maxKW === null || kW < t.maxKW));
  if (!tier) return { closerPerW: 0, setterPerW: 0, kiloPerW: 0 };
  return { closerPerW: tier.closerPerW, setterPerW: tier.setterPerW, kiloPerW: tier.kiloPerW };
}

// Returns the active ProductCatalogPricingVersion for a product on a given date.
// When multiple versions overlap, the most recent effectiveFrom wins.
export function getActiveProductCatalogVersion(
  productId: string,
  date: string,
  versions: ProductCatalogPricingVersion[],
): ProductCatalogPricingVersion | null {
  const candidates = versions.filter(
    (v) =>
      v.productId === productId &&
      v.effectiveFrom <= date &&
      (v.effectiveTo === null || v.effectiveTo >= date),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a.effectiveFrom >= b.effectiveFrom ? a : b));
}

// Versioned product catalog baseline lookup. If a pricing version exists for the
// product on the given date, its tiers are used. Otherwise falls back to the
// product's current tiers (backward compat — same as getProductCatalogBaseline).
export function getProductCatalogBaselineVersioned(
  products: ProductCatalogProduct[],
  productId: string,
  kW: number,
  date: string,
  versions: ProductCatalogPricingVersion[],
): { closerPerW: number; setterPerW: number; kiloPerW: number; pcPricingVersionId: string | null } {
  const version = getActiveProductCatalogVersion(productId, date, versions);
  const tiers = version
    ? version.tiers
    : products.find((p) => p.id === productId)?.tiers;
  if (!tiers) return { closerPerW: 0, setterPerW: 0, kiloPerW: 0, pcPricingVersionId: null };
  const tier = tiers.find((t) => kW >= t.minKW && (t.maxKW === null || kW < t.maxKW));
  if (!tier) return { closerPerW: 0, setterPerW: 0, kiloPerW: 0, pcPricingVersionId: version?.id ?? null };
  return { closerPerW: tier.closerPerW, setterPerW: tier.setterPerW, kiloPerW: tier.kiloPerW, pcPricingVersionId: version?.id ?? null };
}

export const NON_SOLARTECH_BASELINES: Record<string, InstallerBaseline> = {
  'ESP':           { closerPerW: 2.90, kiloPerW: 2.35 },
  'EXO':           { closerPerW: 2.90, kiloPerW: 2.35 },
  'GEG':           { closerPerW: 2.70, kiloPerW: 2.15 },
  'SunPower':      { closerPerW: 2.00, kiloPerW: 1.50 },
  'Complete Solar':{ closerPerW: 2.90, kiloPerW: 2.35 },
  'Solrite':       { closerPerW: 2.90, kiloPerW: 2.35 },
  'Solnova':       { closerPerW: 2.90, kiloPerW: 2.35 },
  'EXO (OLD)':     { closerPerW: 2.90, kiloPerW: 2.35 },
  'Bryton':        { closerPerW: 2.80, kiloPerW: 2.25 },
  // TODO: verify One Source and Pacific Coast baselines in Glide admin
  'One Source':    { closerPerW: 2.90, kiloPerW: 2.35 },
  'Pacific Coast': { closerPerW: 2.90, kiloPerW: 2.35 },
};

export function getNonSolarTechBaseline(installer: string): InstallerBaseline {
  return NON_SOLARTECH_BASELINES[installer] ?? { closerPerW: 2.90, kiloPerW: 2.35 };
}

// ─── Installer Pricing Version Seed Data ─────────────────────────────────────
// All existing NON_SOLARTECH_BASELINES converted to v1 flat-rate versions.
// effectiveTo: null means the version is currently active.

export const INSTALLER_PRICING_VERSIONS: InstallerPricingVersion[] = [
  { id: 'ipv_esp_v1',          installer: 'ESP',           label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.90, kiloPerW: 2.35 } },
  { id: 'ipv_exo_v1',          installer: 'EXO',           label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.90, kiloPerW: 2.35 } },
  { id: 'ipv_geg_v1',          installer: 'GEG',           label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.70, kiloPerW: 2.15 } },
  { id: 'ipv_sunpower_v1',     installer: 'SunPower',      label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.00, kiloPerW: 1.50 } },
  { id: 'ipv_complete_v1',     installer: 'Complete Solar', label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.90, kiloPerW: 2.35 } },
  { id: 'ipv_solrite_v1',      installer: 'Solrite',       label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.90, kiloPerW: 2.35 } },
  { id: 'ipv_solnova_v1',      installer: 'Solnova',       label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.90, kiloPerW: 2.35 } },
  { id: 'ipv_exo_old_v1',      installer: 'EXO (OLD)',     label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.90, kiloPerW: 2.35 } },
  { id: 'ipv_bryton_v1',       installer: 'Bryton',        label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.80, kiloPerW: 2.25 } },
  { id: 'ipv_one_source_v1',   installer: 'One Source',    label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.90, kiloPerW: 2.35 } },
  { id: 'ipv_pacific_v1',      installer: 'Pacific Coast', label: 'v1 — Jan 2020', effectiveFrom: '2020-01-01', effectiveTo: null, rates: { type: 'flat', closerPerW: 2.90, kiloPerW: 2.35 } },
];

// Returns the pricing version active on a given ISO date for a given installer.
// When multiple versions overlap (shouldn't happen in practice), the most recent effectiveFrom wins.
export function getActiveInstallerVersion(
  installer: string,
  date: string,
  versions: InstallerPricingVersion[],
): InstallerPricingVersion | null {
  const candidates = versions.filter(
    (v) =>
      v.installer === installer &&
      v.effectiveFrom <= date &&
      (v.effectiveTo === null || v.effectiveTo >= date),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((a, b) => (a.effectiveFrom >= b.effectiveFrom ? a : b));
}

// Returns resolved rates for commission calculation given an installer, date, and system size.
// Falls back to NON_SOLARTECH_BASELINES if no version is found for the installer.
export function getInstallerRatesForDeal(
  installer: string,
  date: string,
  kW: number,
  versions: InstallerPricingVersion[],
): { closerPerW: number; setterPerW: number; kiloPerW: number; versionId: string | null } {
  const version = getActiveInstallerVersion(installer, date, versions);
  if (!version) {
    const b = NON_SOLARTECH_BASELINES[installer] ?? { closerPerW: 2.90, kiloPerW: 2.35 };
    const setter = b.setterPerW != null ? b.setterPerW : Math.round((b.closerPerW + 0.10) * 100) / 100;
    return { closerPerW: b.closerPerW, setterPerW: setter, kiloPerW: b.kiloPerW, versionId: null };
  }
  const { rates } = version;
  if (rates.type === 'tiered') {
    const band = rates.bands.find((b) => kW >= b.minKW && (b.maxKW === null || kW < b.maxKW)) ?? rates.bands[rates.bands.length - 1];
    if (!band) return { closerPerW: 2.90, setterPerW: 3.00, kiloPerW: 2.35, versionId: version.id };
    const setter = band.setterPerW != null ? band.setterPerW : Math.round((band.closerPerW + 0.10) * 100) / 100;
    return { closerPerW: band.closerPerW, setterPerW: setter, kiloPerW: band.kiloPerW, versionId: version.id };
  }
  const setter = rates.setterPerW != null ? rates.setterPerW : Math.round((rates.closerPerW + 0.10) * 100) / 100;
  return { closerPerW: rates.closerPerW, setterPerW: setter, kiloPerW: rates.kiloPerW, versionId: version.id };
}

// Commission = (soldPPW - baseline) × kW × 1000
// Returns total commission amount in dollars.
export function calculateCommission(soldPPW: number, baselinePerW: number, kW: number): number {
  return Math.max(0, Math.round((soldPPW - baselinePerW) * kW * 1000 * 100) / 100);
}

// ─── Incentives ──────────────────────────────────────────────────────────────

export type IncentiveMetric = 'deals' | 'kw' | 'commission' | 'revenue';
export type IncentivePeriod = 'month' | 'quarter' | 'year' | 'alltime';
export type IncentiveType = 'company' | 'personal';

export interface IncentiveMilestone {
  id: string;
  threshold: number;
  reward: string;
  achieved: boolean;
}

export interface Incentive {
  id: string;
  title: string;
  description: string;
  type: IncentiveType;
  metric: IncentiveMetric;
  period: IncentivePeriod;
  startDate: string;
  endDate: string | null;
  targetRepId: string | null; // null = company-wide
  milestones: IncentiveMilestone[];
  active: boolean;
}

export const INCENTIVES: Incentive[] = [
  {
    id: 'inc1',
    title: 'Q1 Team Push',
    description: 'Hit 10 deals as a team this quarter and unlock rewards',
    type: 'company',
    metric: 'deals',
    period: 'quarter',
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    targetRepId: null,
    milestones: [
      { id: 'inc1m1', threshold: 5,  reward: 'Team Lunch',                 achieved: false },
      { id: 'inc1m2', threshold: 8,  reward: '$200 Bonus Pool',             achieved: false },
      { id: 'inc1m3', threshold: 10, reward: '$500 Bonus Pool + Day Off',   achieved: false },
    ],
    active: true,
  },
  {
    id: 'inc2',
    title: 'March Closer Challenge',
    description: 'Personal goal for Alex — close 5 deals in March',
    type: 'personal',
    metric: 'deals',
    period: 'month',
    startDate: '2026-03-01',
    endDate: '2026-03-31',
    targetRepId: 'rep1',
    milestones: [
      { id: 'inc2m1', threshold: 3, reward: '$150 Bonus',  achieved: false },
      { id: 'inc2m2', threshold: 5, reward: '$400 Bonus',  achieved: false },
    ],
    active: true,
  },
  {
    id: 'inc3',
    title: 'kW Sprint — Maria',
    description: 'Hit 20 kW sold in Q1',
    type: 'personal',
    metric: 'kw',
    period: 'quarter',
    startDate: '2026-01-01',
    endDate: '2026-03-31',
    targetRepId: 'rep2',
    milestones: [
      { id: 'inc3m1', threshold: 10, reward: '$100 Gift Card',  achieved: false },
      { id: 'inc3m2', threshold: 20, reward: '$300 Bonus',       achieved: false },
    ],
    active: true,
  },
];

export function computeIncentiveProgress(
  incentive: Incentive,
  projects: Project[],
  payrollEntries: PayrollEntry[]
): number {
  const inRange = (dateStr: string) => {
    const d = new Date(dateStr);
    const start = new Date(incentive.startDate);
    const end = incentive.endDate ? new Date(incentive.endDate) : new Date('2099-12-31');
    return d >= start && d <= end;
  };

  let relevantProjects = projects.filter((p) => inRange(p.soldDate));
  if (incentive.type === 'personal' && incentive.targetRepId) {
    relevantProjects = relevantProjects.filter((p) => p.repId === incentive.targetRepId);
  }

  switch (incentive.metric) {
    case 'deals':
      return relevantProjects.length;
    case 'kw':
      return Math.round(relevantProjects.reduce((s, p) => s + p.kWSize, 0) * 10) / 10;
    case 'revenue':
      return relevantProjects.reduce((s, p) => s + Math.round(p.netPPW * p.kWSize * 1000), 0);
    case 'commission': {
      const repIds = incentive.type === 'personal' && incentive.targetRepId
        ? [incentive.targetRepId]
        : null;
      return payrollEntries
        .filter((e) => inRange(e.date) && e.status === 'Paid' && (!repIds || repIds.includes(e.repId)))
        .reduce((s, e) => s + e.amount, 0);
    }
    default:
      return 0;
  }
}

export function formatIncentiveMetric(metric: IncentiveMetric, value: number): string {
  if (metric === 'deals') return `${value} deal${value !== 1 ? 's' : ''}`;
  if (metric === 'kw') return `${value.toFixed(1)} kW`;
  if (metric === 'commission' || metric === 'revenue') return `$${Math.round(value).toLocaleString()}`;
  return String(value);
}
