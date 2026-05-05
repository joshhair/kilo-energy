import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { renderInstallerHandoffPdf, type HandoffPdfPayload } from '@/lib/pdf/installer-handoff';
import { EMPTY_BVI_INTAKE } from '@/lib/installer-intakes/bvi';

/**
 * Smoke tests for the BVI handoff PDF renderer. We don't assert visual
 * correctness here — coordinate calibration is a Phase 7 visual task.
 * What we DO assert: the renderer produces a valid, non-empty PDF that
 * pdf-lib can re-load (proving we didn't corrupt the template).
 */

const BASE_PAYLOAD: HandoffPdfPayload = {
  installerSlug: 'bvi',
  salesRepName: 'Jane Smith',
  salesRepPhone: '555-0100',
  salesRepEmail: 'jane@kiloenergies.com',
  customerName: 'John Homeowner',
  financeProduct: 'Goodleap',
  intake: {
    ...EMPTY_BVI_INTAKE,
    customerPhone: '555-0200',
    customerEmail: 'john@example.com',
    customerAddress: '123 Sunny Lane, Solar City, CA 90210',
    exportType: 'NEM 3.0',
    siteSurveyNeeded: true,
    batteryLocation: 'Inside Garage',
    dogsOnProperty: false,
    lockedGates: true,
    gateCode: '1234',
    additionalNotes: 'Customer prefers morning install. Tall ladder needed for the back side of the roof.',
  },
};

describe('renderInstallerHandoffPdf', () => {
  it('renders a non-empty PDF for a fully-populated BVI payload', async () => {
    const bytes = await renderInstallerHandoffPdf(BASE_PAYLOAD);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('output PDF is valid (re-loadable by pdf-lib)', async () => {
    const bytes = await renderInstallerHandoffPdf(BASE_PAYLOAD);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('renders successfully with an empty intake (all-null booleans, no checkmarks)', async () => {
    const payload: HandoffPdfPayload = {
      ...BASE_PAYLOAD,
      intake: { ...EMPTY_BVI_INTAKE, customerPhone: '', customerEmail: '', customerAddress: '' },
    };
    const bytes = await renderInstallerHandoffPdf(payload);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('renders successfully with debugGrid option enabled', async () => {
    const bytes = await renderInstallerHandoffPdf(BASE_PAYLOAD, { debugGrid: true });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it('handles long additionalNotes by wrapping (does not throw)', async () => {
    const longText = 'lorem ipsum dolor sit amet '.repeat(50);
    const payload: HandoffPdfPayload = {
      ...BASE_PAYLOAD,
      intake: { ...BASE_PAYLOAD.intake, additionalNotes: longText },
    };
    const bytes = await renderInstallerHandoffPdf(payload);
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });
});
