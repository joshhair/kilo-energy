/**
 * Installer handoff PDF renderer.
 *
 * Renders a per-installer intake PDF by overlaying typed text on the
 * installer's master template. Today only BVI is wired (other installers
 * plug in by adding a sibling lib/forms/<slug>-intake.pdf + a coord map
 * + extending the dispatch in renderInstallerHandoffPdf).
 *
 * The BVI master is a STATIC PDF (no AcroForm fields), so we use
 * coordinate overlay via pdf-lib. Coordinates live in
 * lib/installer-intakes/bvi.ts and need visual calibration in Phase 7
 * — render with debugGrid=true to overlay a labeled grid.
 *
 * Returns Uint8Array bytes; the caller is responsible for emailing,
 * persisting, or streaming the result.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, PDFPage, PDFFont, StandardFonts, rgb } from 'pdf-lib';
import { BVI_PDF_COORDS, type BviIntake, type PdfCoord } from '@/lib/installer-intakes/bvi';

/**
 * Composed payload for rendering — caller pre-fills from Project + intake.
 * Decoupled from Prisma types so the renderer can be unit-tested with
 * plain POJOs and future installers can plug in their own payload shape.
 */
export interface HandoffPdfPayload {
  installerSlug: 'bvi'; // expand union as more installers are added
  // Sales Representative section
  salesRepName: string;
  salesRepPhone: string;
  salesRepEmail: string;
  // Customer Information section
  customerName: string;
  // Finance Product (renders as section text in System Details)
  financeProduct: string;
  // Per-installer intake (BVI fields)
  intake: BviIntake;
}

export interface RenderOptions {
  /**
   * If true, overlays a labeled grid + every field's coordinate so we can
   * visually calibrate BVI_PDF_COORDS. Phase-7-only flag, never set in prod.
   */
  debugGrid?: boolean;
}

const DEFAULT_FONT_SIZE = 10;
const CHECKMARK = 'X';
const TEXT_COLOR = rgb(0.06, 0.07, 0.13); // near-black, matches form ink

/** Resolves the master template path on disk by installer slug. */
function templatePath(slug: HandoffPdfPayload['installerSlug']): string {
  return path.resolve(process.cwd(), 'lib', 'forms', `${slug}-intake.pdf`);
}

/**
 * Wrap text into lines that fit within maxWidth at the given font size.
 * Word-by-word greedy fill. If a single word exceeds maxWidth, it's
 * placed on its own line (will overflow visually — calibrate maxWidth
 * up if this happens often).
 */
function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (!text) return [];
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current.length === 0 ? word : `${current} ${word}`;
      const w = font.widthOfTextAtSize(candidate, size);
      if (w <= maxWidth) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function drawSingleLine(
  page: PDFPage,
  text: string,
  coord: PdfCoord,
  font: PDFFont,
): void {
  if (!text) return;
  const size = coord.size ?? DEFAULT_FONT_SIZE;
  // Truncate to maxWidth if specified — drop the last chars rather than
  // wrap. Single-line callers (rep name, phone, etc.) want it inline.
  let rendered = text;
  if (coord.maxWidth && font.widthOfTextAtSize(rendered, size) > coord.maxWidth) {
    while (rendered.length > 0 && font.widthOfTextAtSize(rendered + '…', size) > coord.maxWidth) {
      rendered = rendered.slice(0, -1);
    }
    rendered = rendered + '…';
  }
  page.drawText(rendered, {
    x: coord.x,
    y: coord.y,
    size,
    font,
    color: TEXT_COLOR,
  });
}

function drawWrapped(
  page: PDFPage,
  text: string,
  coord: PdfCoord,
  font: PDFFont,
): void {
  if (!text) return;
  const size = coord.size ?? DEFAULT_FONT_SIZE;
  const maxWidth = coord.maxWidth ?? 460;
  const lines = wrapText(text, font, size, maxWidth);
  // Lines flow downward from anchor (top line at coord.y; subsequent
  // lines at y - lineHeight). Line height = size * 1.25.
  const lineHeight = size * 1.25;
  for (let i = 0; i < lines.length; i++) {
    page.drawText(lines[i] ?? '', {
      x: coord.x,
      y: coord.y - i * lineHeight,
      size,
      font,
      color: TEXT_COLOR,
    });
  }
}

function drawCheckmark(
  page: PDFPage,
  coord: PdfCoord,
  font: PDFFont,
): void {
  page.drawText(CHECKMARK, {
    x: coord.x,
    y: coord.y,
    size: coord.size ?? DEFAULT_FONT_SIZE,
    font,
    color: TEXT_COLOR,
  });
}

/**
 * Optional debug grid: draws a 50pt grid + the field labels at each
 * coord position. Only used when calibrating coordinates — never in prod.
 */
function drawDebugGrid(page: PDFPage, font: PDFFont, coords: Record<string, PdfCoord>): void {
  const { width, height } = page.getSize();
  const gridColor = rgb(0.85, 0.85, 0.95);
  for (let x = 0; x < width; x += 50) {
    page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, thickness: 0.25, color: gridColor });
    page.drawText(String(x), { x: x + 1, y: 2, size: 5, font, color: rgb(0.5, 0.5, 0.5) });
  }
  for (let y = 0; y < height; y += 50) {
    page.drawLine({ start: { x: 0, y }, end: { x: width, y }, thickness: 0.25, color: gridColor });
    page.drawText(String(y), { x: 2, y: y + 1, size: 5, font, color: rgb(0.5, 0.5, 0.5) });
  }
  for (const [label, coord] of Object.entries(coords)) {
    page.drawCircle({ x: coord.x, y: coord.y, size: 1.5, color: rgb(1, 0, 0) });
    page.drawText(label, {
      x: coord.x + 3,
      y: coord.y + 3,
      size: 5,
      font,
      color: rgb(0.6, 0.1, 0.1),
    });
  }
}

/**
 * Render a BVI handoff PDF from a composed payload. Returns the bytes;
 * caller decides what to do with them (email attachment, blob upload, etc.).
 */
async function renderBviPdf(
  payload: HandoffPdfPayload,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  const templateBytes = readFileSync(templatePath('bvi'));
  const doc = await PDFDocument.load(templateBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const page = doc.getPage(0);
  const c = BVI_PDF_COORDS;
  const intake = payload.intake;

  // Sales Representative
  drawSingleLine(page, payload.salesRepName, c.salesRepName, font);
  drawSingleLine(page, payload.salesRepPhone, c.salesRepPhone, font);
  drawSingleLine(page, payload.salesRepEmail, c.salesRepEmail, font);

  // Customer Information
  drawSingleLine(page, payload.customerName, c.customerName, font);
  drawSingleLine(page, intake.customerPhone, c.customerPhone, font);
  drawSingleLine(page, intake.customerEmail, c.customerEmail, font);
  drawSingleLine(page, intake.customerAddress, c.customerAddress, font);

  // System Details
  if (intake.exportType === 'NEM 3.0') drawCheckmark(page, c.exportTypeNem3Box, font);
  if (intake.exportType === 'Non-Export') drawCheckmark(page, c.exportTypeNonExportBox, font);
  drawSingleLine(page, payload.financeProduct, c.financeProduct, font);
  drawWrapped(page, intake.existingSystemInfo, c.existingSystemInfo, font);

  // Site Survey & Installation Notes
  if (intake.siteSurveyNeeded === true) drawCheckmark(page, c.siteSurveyYesBox, font);
  if (intake.siteSurveyNeeded === false) drawCheckmark(page, c.siteSurveyNoBox, font);
  if (intake.batteryLocation === 'Inside Garage') drawCheckmark(page, c.batteryLocationInsideGarageBox, font);
  if (intake.batteryLocation === 'Outside Garage') drawCheckmark(page, c.batteryLocationOutsideGarageBox, font);
  if (intake.batteryLocation === 'Other') {
    drawSingleLine(page, intake.batteryLocationOther, c.batteryLocationOther, font);
  }
  if (intake.dogsOnProperty === true) drawCheckmark(page, c.dogsYesBox, font);
  if (intake.dogsOnProperty === false) drawCheckmark(page, c.dogsNoBox, font);
  if (intake.lockedGates === true) drawCheckmark(page, c.lockedGatesYesBox, font);
  if (intake.lockedGates === false) drawCheckmark(page, c.lockedGatesNoBox, font);
  drawSingleLine(page, intake.gateCode, c.gateCode, font);

  // Additional Notes & Feedback
  drawWrapped(page, intake.additionalNotes, c.additionalNotes, font);

  if (options.debugGrid) {
    drawDebugGrid(page, font, c as unknown as Record<string, PdfCoord>);
  }

  return doc.save();
}

/**
 * Public entry — dispatches by installer slug. Today only BVI is wired.
 * Add a case branch when onboarding the next installer.
 */
export async function renderInstallerHandoffPdf(
  payload: HandoffPdfPayload,
  options: RenderOptions = {},
): Promise<Uint8Array> {
  switch (payload.installerSlug) {
    case 'bvi':
      return renderBviPdf(payload, options);
    default: {
      // Exhaustiveness: TypeScript will catch this if a new slug is added
      // to HandoffPdfPayload.installerSlug without adding a case here.
      const exhaustive: never = payload.installerSlug;
      throw new Error(`Unsupported installer slug: ${String(exhaustive)}`);
    }
  }
}
