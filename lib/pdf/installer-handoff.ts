/**
 * Installer handoff PDF renderer.
 *
 * Loads the installer's master template from lib/forms/<slug>-intake.pdf,
 * fills its named AcroForm fields from the payload, flattens to static
 * content, returns the bytes.
 *
 * Adding a new installer:
 *   1. Drop their fillable PDF at lib/forms/<slug>-intake.pdf
 *   2. Add a sibling lib/installer-intakes/<slug>.ts with their intake shape
 *   3. Add a render<Slug>Pdf() function below + a case in the switch
 *
 * The PDF must already have named AcroForm fields. Field-name conventions
 * are documented per-installer in their lib/installer-intakes/<slug>.ts.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { BviIntake } from '@/lib/installer-intakes/bvi';

/**
 * Composed payload for rendering — caller pre-fills from Project + intake.
 * Decoupled from Prisma types so the renderer can be unit-tested with
 * plain POJOs and future installers can plug in their own payload shape.
 */
export interface HandoffPdfPayload {
  installerSlug: 'bvi'; // expand union as more installers are added
  salesRepName: string;
  customerName: string;
  financeProduct: string;
  intake: BviIntake;
}

function templatePath(slug: HandoffPdfPayload['installerSlug']): string {
  return path.resolve(process.cwd(), 'lib', 'forms', `${slug}-intake.pdf`);
}

async function renderBviPdf(payload: HandoffPdfPayload): Promise<Uint8Array> {
  const templateBytes = readFileSync(templatePath('bvi'));
  const doc = await PDFDocument.load(templateBytes);
  const form = doc.getForm();
  const intake = payload.intake;

  // Acrobat's auto-detect doesn't always write /DA (default appearance)
  // entries, which setFontSize() requires. Embed a font + force-update
  // appearances on all fields up front so per-field setFontSize works.
  const font = await doc.embedFont(StandardFonts.Helvetica);
  form.updateFieldAppearances(font);

  // Text fields
  form.getTextField('salesRepName').setText(payload.salesRepName);
  form.getTextField('customerName').setText(payload.customerName);
  form.getTextField('customerPhone').setText(intake.customerPhone);
  form.getTextField('customerEmail').setText(intake.customerEmail);
  form.getTextField('customerAddress').setText(intake.customerAddress);
  form.getTextField('financeProduct').setText(payload.financeProduct);
  form.getTextField('existingSystemInfo').setText(intake.existingSystemInfo);
  form.getTextField('gateCode').setText(intake.gateCode);
  // additionalNotes can hold a long paragraph; force a smaller font so it
  // doesn't render at Acrobat's default 12pt and overflow / look outsized.
  const notes = form.getTextField('additionalNotes');
  notes.setFontSize(9);
  notes.setText(intake.additionalNotes);
  if (intake.batteryLocation === 'Other') {
    form.getTextField('batteryOther').setText(intake.batteryLocationOther);
  }

  // Checkboxes
  if (intake.exportType === 'NEM 3.0') form.getCheckBox('exportTypeNem3').check();
  if (intake.exportType === 'Non-Export') form.getCheckBox('exportTypeNonExport').check();
  if (intake.siteSurveyNeeded === true) form.getCheckBox('siteSurveyYes').check();
  if (intake.siteSurveyNeeded === false) form.getCheckBox('siteSurveyNo').check();
  if (intake.batteryLocation === 'Inside Garage') form.getCheckBox('batteryInsideGarage').check();
  if (intake.batteryLocation === 'Outside Garage') form.getCheckBox('batteryOutsideGarage').check();
  if (intake.dogsOnProperty === true) form.getCheckBox('dogsYes').check();
  if (intake.dogsOnProperty === false) form.getCheckBox('dogsNo').check();
  if (intake.lockedGates === true) form.getCheckBox('lockedGatesYes').check();
  if (intake.lockedGates === false) form.getCheckBox('lockedGatesNo').check();

  // Flatten so the recipient sees populated text instead of a fillable form
  // (some PDF viewers highlight form fields with a tinted background).
  form.flatten();

  return doc.save();
}

export async function renderInstallerHandoffPdf(payload: HandoffPdfPayload): Promise<Uint8Array> {
  switch (payload.installerSlug) {
    case 'bvi':
      return renderBviPdf(payload);
    default: {
      const exhaustive: never = payload.installerSlug;
      throw new Error(`Unsupported installer slug: ${String(exhaustive)}`);
    }
  }
}
