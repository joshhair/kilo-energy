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
  /** Sales rep phone — surfaced on the new BVI template (2026-05-26). May be
   *  empty string if the rep's User row has no phone on file. */
  salesRepPhone: string;
  /** Sales rep email — surfaced on the new BVI template. Always populated
   *  since User.email is required + unique. */
  salesRepEmail: string;
  customerName: string;
  /**
   * BVI's "Finance Product" question moved from a single free-text field
   * to four checkboxes (HDM / Wheelhouse / CASH / Other + a free-text
   * "Other:" companion field). Caller derives the flags from the Project's
   * existing financer + productFamily + productType — see
   * lib/handoff-service.ts deriveBviFinanceFlags(). Any subset of HDM/
   * Wheelhouse/CASH can be true; otherText carries the financer name when
   * none of the three matched.
   */
  bviFinance: {
    hdm: boolean;
    wheelhouse: boolean;
    cash: boolean;
    otherText: string;
  };
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

  // ── Text fields ────────────────────────────────────────────────────────
  // Names are snake_case in the 2026-05-26 BVI template refresh. Field
  // inventory verified via scripts/inspect-bvi-pdf.mts. See the comment
  // block in lib/installer-intakes/bvi.ts for the full list.
  form.getTextField('rep_name').setText(payload.salesRepName);
  form.getTextField('rep_phone').setText(payload.salesRepPhone);
  // Email + address fields can hold strings longer than the visual field
  // width (long firstname.lastname@company.com, or a full street address).
  // Acrobat's default 12pt clips at the right border — drop to 9pt so
  // common-length values render fully without changing the template's
  // field positions. Matches the notes-field treatment below.
  const repEmail = form.getTextField('rep_email');
  repEmail.setFontSize(9);
  repEmail.setText(payload.salesRepEmail);
  form.getTextField('cust_name').setText(payload.customerName);
  form.getTextField('cust_phone').setText(intake.customerPhone);
  const custEmail = form.getTextField('cust_email');
  custEmail.setFontSize(9);
  custEmail.setText(intake.customerEmail);
  const custAddress = form.getTextField('cust_address');
  custAddress.setFontSize(9);
  custAddress.setText(intake.customerAddress);
  form.getTextField('existing_system').setText(intake.existingSystemInfo);
  form.getTextField('gate_code').setText(intake.gateCode);
  // notes can hold a long paragraph; force a smaller font so it doesn't
  // render at Acrobat's default 12pt and overflow / look outsized.
  const notes = form.getTextField('notes');
  notes.setFontSize(9);
  notes.setText(intake.additionalNotes);
  if (intake.batteryLocation === 'Other') {
    form.getTextField('battery_other').setText(intake.batteryLocationOther);
  }
  // Finance "Other:" companion text — only populated when none of HDM /
  // Wheelhouse / CASH matched (per deriveBviFinanceFlags in handoff-service).
  if (payload.bviFinance.otherText) {
    form.getTextField('finance_other_text').setText(payload.bviFinance.otherText);
  }

  // ── Checkboxes ─────────────────────────────────────────────────────────
  // Helper that also ticks the _v2 duplicate when one exists. The new BVI
  // template has duplicate finance-product checkboxes (finance_hdm_v2 etc.)
  // — likely a residual from BVI's Acrobat editing. Filling both is cheap
  // and means the recipient sees consistent state regardless of which copy
  // their PDF viewer renders.
  const checkPair = (name: string, v2?: string) => {
    form.getCheckBox(name).check();
    if (v2) {
      try { form.getCheckBox(v2).check(); } catch { /* v2 absent in some templates — best-effort */ }
    }
  };

  if (intake.exportType === 'NEM 3.0') form.getCheckBox('export_nem3').check();
  if (intake.exportType === 'Non-Export') form.getCheckBox('export_non_export').check();

  // Finance-product checkboxes — derived (see HandoffPdfPayload.bviFinance).
  // Multiple may be checked when the deal carries signal in both the
  // financer + productFamily fields (Jane Smith: Wheelhouse financer + HDM
  // family → both finance_hdm and finance_wheelhouse checked).
  if (payload.bviFinance.hdm)        checkPair('finance_hdm',        'finance_hdm_v2');
  if (payload.bviFinance.wheelhouse) checkPair('finance_wheelhouse', 'finance_wheelhouse_v2');
  if (payload.bviFinance.cash)       checkPair('finance_cash',       'finance_cash_v2');
  if (payload.bviFinance.otherText)  checkPair('finance_other_cb',   'finance_other_cb_v2');

  if (intake.siteSurveyNeeded === true)  form.getCheckBox('survey_yes').check();
  if (intake.siteSurveyNeeded === false) form.getCheckBox('survey_no').check();
  if (intake.batteryLocation === 'Inside Garage')  form.getCheckBox('battery_inside').check();
  if (intake.batteryLocation === 'Outside Garage') form.getCheckBox('battery_outside').check();
  if (intake.dogsOnProperty === true)  form.getCheckBox('dogs_yes').check();
  if (intake.dogsOnProperty === false) form.getCheckBox('dogs_no').check();
  if (intake.lockedGates === true)  form.getCheckBox('gates_yes').check();
  if (intake.lockedGates === false) form.getCheckBox('gates_no').check();

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
