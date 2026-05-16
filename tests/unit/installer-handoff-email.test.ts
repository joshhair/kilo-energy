/**
 * Tests for the BVI installer handoff email body template.
 *
 * Focus: the utility-bill link block, which is the fallback path when
 * a recipient's mail client filters out the binary attachment. The
 * heading text + project summary table are stable structure and
 * indirectly covered by the higher-level service tests.
 */

import { describe, it, expect } from 'vitest';
import { renderHandoffEmailHtml, type HandoffEmailBodyInput } from '@/lib/email-templates/installer-handoff';

const baseInput: HandoffEmailBodyInput = {
  installerDisplayName: 'BVI Solar',
  customerName: 'John Homeowner',
  customerAddress: '123 Sunny Lane, Solar City, CA 90210',
  systemSizeKw: '8.4',
  financeProduct: 'Goodleap',
  exportType: 'NEM 3.0',
  siteSurveyText: 'Yes',
  repName: 'Jane Smith',
  repPhone: '555-0200',
  repEmail: 'jane@example.com',
  customNotes: '',
  projectUrl: 'https://app.kiloenergies.com/dashboard/projects/proj_abc123',
};

describe('renderHandoffEmailHtml', () => {
  it('omits the utility-bill block when no URL is supplied', () => {
    const html = renderHandoffEmailHtml(baseInput);
    expect(html).not.toMatch(/Utility bill:/i);
  });

  it('omits the utility-bill block when URL is null', () => {
    const html = renderHandoffEmailHtml({ ...baseInput, utilityBillUrl: null });
    expect(html).not.toMatch(/Utility bill:/i);
  });

  it('renders an anchor with the URL when supplied', () => {
    const url = 'https://blob.public.vercel-storage.com/project-files/abc/1700000000-bill.pdf';
    const html = renderHandoffEmailHtml({
      ...baseInput,
      utilityBillUrl: url,
      utilityBillFilename: 'pge-bill-may-2026.pdf',
    });
    expect(html).toMatch(/Utility bill:/i);
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain('pge-bill-may-2026.pdf');
  });

  it('uses a fallback label when no filename is provided', () => {
    const url = 'https://blob.public.vercel-storage.com/project-files/abc/bill.pdf';
    const html = renderHandoffEmailHtml({ ...baseInput, utilityBillUrl: url });
    expect(html).toContain(`href="${url}"`);
    expect(html).toMatch(/Download \(PDF\/image\)/);
  });

  it('HTML-escapes the URL and filename to prevent injection from a malicious upload', () => {
    const html = renderHandoffEmailHtml({
      ...baseInput,
      utilityBillUrl: 'https://blob.example.com/"><script>alert(1)</script>',
      utilityBillFilename: '<img src=x onerror=alert(1)>.pdf',
    });
    // No literal <script> or <img tags should appear — all '<' characters
    // from user-controlled input must be escaped to &lt;. The strings
    // 'script' / 'onerror' may still appear as text inside the escaped
    // sequence; we only care that no executable HTML element is emitted.
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).toContain('Utility bill:');
  });

  it('preserves the project-summary table when bill block renders', () => {
    const url = 'https://blob.example.com/bill.pdf';
    const html = renderHandoffEmailHtml({ ...baseInput, utilityBillUrl: url });
    expect(html).toContain('Project summary');
    expect(html).toContain('123 Sunny Lane, Solar City, CA 90210');
    expect(html).toContain('8.4 kW');
  });
});
