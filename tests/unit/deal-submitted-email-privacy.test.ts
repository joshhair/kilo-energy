// Privacy snapshot tests for the deal-submitted email templates.
//
// The rep-tier email must NEVER contain kilo margin, baseline rates, or
// other-party commission amounts. TypeScript already enforces this at the
// type level (RepDealEmailData has no margin/baseline fields), but we
// also assert at runtime by rendering a populated email and grepping for
// dangerous strings. Defense in depth against:
//   - Future template edits that accidentally inline sensitive data
//   - String-interpolation slips that bypass the type check
//   - Copy regressions when other templates get refactored

import { describe, it, expect } from 'vitest';
import {
  renderDealSubmittedRepEmail,
  renderDealSubmittedAdminEmail,
  type RepDealEmailData,
  type AdminDealEmailData,
} from '@/lib/email-templates/deal-submitted';

const baseRepData: RepDealEmailData = {
  recipientFirstName: 'Hunter',
  recipientRole: 'closer',
  customerName: 'Jane Customer',
  soldDate: '2026-05-11',
  kWSize: 5.28,
  salePrice: 20328,
  myCommission: { m1: 1000, m2: 3092, m3: 773 },
  parties: {
    setterName: 'Tyson Smack',
    coCloserNames: ['Casey Helton'],
  },
  projectUrl: 'https://app.kiloenergies.com/dashboard/projects/proj_1',
};

describe('Rep deal-submitted email — privacy', () => {
  it('does not contain the word "Kilo margin" (case-insensitive)', () => {
    const { html } = renderDealSubmittedRepEmail(baseRepData);
    expect(html.toLowerCase()).not.toContain('kilo margin');
  });

  it('does not contain any baseline-rate signatures ($/W per-watt rates)', () => {
    const { html } = renderDealSubmittedRepEmail(baseRepData);
    // Defensive: even decorative copy mentioning $/W rates leaks
    // information about the baseline structure.
    expect(html).not.toMatch(/\$[\d.]+\s*\/\s*W/i);
    expect(html).not.toMatch(/per[-\s]watt\s+rate/i);
    expect(html).not.toContain('closerPerW');
    expect(html).not.toContain('kiloPerW');
    expect(html).not.toContain('setterPerW');
  });

  it('contains the recipient\'s own commission totals', () => {
    const { html } = renderDealSubmittedRepEmail(baseRepData);
    expect(html).toContain('$1,000'); // M1
    expect(html).toContain('$3,092'); // M2
    expect(html).toContain('$773');   // M3
  });

  it('names other parties but NOT their commission amounts', () => {
    const repWithCoSetterAmount: RepDealEmailData = {
      ...baseRepData,
      parties: {
        ...baseRepData.parties,
        setterName: 'Tyson Smack',
      },
    };
    const { html } = renderDealSubmittedRepEmail(repWithCoSetterAmount);
    // The setter's NAME appears.
    expect(html).toContain('Tyson Smack');
    // But there should be no setter commission breakdown.
    // (We can't easily test "this number isn't anywhere" without knowing
    // the setter's amount, but we can assert there's no setter-commission
    // headline copy.)
    expect(html.toLowerCase()).not.toContain('setter total');
    expect(html.toLowerCase()).not.toContain("setter's commission");
    expect(html.toLowerCase()).not.toContain('setter m1');
    expect(html.toLowerCase()).not.toContain('setter m2');
  });

  it('subject line does not leak sensitive terms', () => {
    const { subject } = renderDealSubmittedRepEmail(baseRepData);
    expect(subject.toLowerCase()).not.toContain('margin');
    expect(subject.toLowerCase()).not.toContain('kilo per');
    expect(subject.toLowerCase()).not.toContain('baseline');
  });
});

describe('Admin deal-submitted email — content', () => {
  const baseAdminData: AdminDealEmailData = {
    customerName: 'Jane Customer',
    closerName: 'Hunter Helton',
    setterName: 'Tyson Smack',
    installer: 'BVI',
    financer: 'Goodleap',
    soldDate: '2026-05-11',
    kWSize: 5.28,
    netPPW: 3.85,
    salePrice: 20328,
    closerTotal: 4865,
    setterTotal: 3564,
    trainerPayout: 0,
    projectUrl: 'https://app.kiloenergies.com/dashboard/projects/proj_1',
  };

  it('includes both rep totals and attribution', () => {
    const { html } = renderDealSubmittedAdminEmail(baseAdminData);
    expect(html).toContain('Hunter Helton');
    expect(html).toContain('Tyson Smack');
    expect(html).toContain('$4,865'); // closer total
    expect(html).toContain('$3,564'); // setter total
  });

  it('includes kilo margin row when provided', () => {
    const withMargin: AdminDealEmailData = { ...baseAdminData, kiloMargin: 2640 };
    const { html } = renderDealSubmittedAdminEmail(withMargin);
    expect(html.toLowerCase()).toContain('kilo margin');
    expect(html).toContain('$2,640');
  });

  it('omits kilo margin row when undefined', () => {
    const { html } = renderDealSubmittedAdminEmail(baseAdminData);
    expect(html.toLowerCase()).not.toContain('kilo margin');
  });

  it('sub-dealer mode replaces split with single payout line', () => {
    const subDealer: AdminDealEmailData = {
      ...baseAdminData,
      isSubDealer: true,
      closerTotal: 5000,
      setterTotal: 0,
    };
    const { html } = renderDealSubmittedAdminEmail(subDealer);
    expect(html.toLowerCase()).toContain('sub-dealer payout');
    expect(html.toLowerCase()).not.toContain('setter total');
  });
});
