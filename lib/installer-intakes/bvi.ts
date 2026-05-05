/**
 * BVI Solar — installer intake shape + PDF render configuration.
 *
 * BVI requires reps to fill out their "Sales Intake Form" + email it +
 * the homeowner's utility bill on every project. We capture the
 * BVI-specific fields conditionally on our new-deal form, store as
 * Project.installerIntakeJson, and at handoff time compose a PDF that
 * exactly mirrors BVI's master form using their template at
 * lib/forms/bvi-intake.pdf.
 *
 * The master PDF is STATIC (no AcroForm fields), so we draw text via
 * coordinate overlay using pdf-lib. Coordinates below are PRELIMINARY
 * estimates based on the visual layout — Phase 7 testing must visually
 * verify alignment and dial them in.
 *
 * To future-proof for additional installers: each installer gets a sibling
 * file in lib/installer-intakes/ defining its own intake shape + field map.
 * The handoff renderer dispatches by installer slug.
 */

/**
 * Fields BVI's intake form asks for that are NOT already in our standard
 * project model. These are stored as a JSON blob in Project.installerIntakeJson.
 *
 * Fields BVI's form ALSO asks for that we already have (rep name/phone/email,
 * customer name/phone/email/address, finance product) are pulled from the
 * Project's existing fields at render time — not duplicated here.
 */
export interface BviIntake {
  // ─── Customer contact (not on Project model today) ──────────────────
  // Other installers will likely want these too. If a second installer
  // grows the same need, promote these to Project columns and remove
  // here. For v1 they live in installerIntakeJson to avoid scope creep.
  /** Homeowner phone number (free-text; not normalized). */
  customerPhone: string;
  /** Homeowner email. */
  customerEmail: string;
  /** Homeowner street address (full single-line). */
  customerAddress: string;

  // ─── BVI-specific fields ────────────────────────────────────────────
  /** "NEM 3.0" or "Non-Export" — net metering classification. */
  exportType: 'NEM 3.0' | 'Non-Export' | null;
  /** Free-text description of any pre-existing solar/battery on the property. */
  existingSystemInfo: string;
  /** Whether BVI ops should schedule a site survey before install. */
  siteSurveyNeeded: boolean | null;
  /** Where the homeowner wants the battery installed (if any). */
  batteryLocation: 'Inside Garage' | 'Outside Garage' | 'Other' | null;
  /** Free-text when batteryLocation === 'Other'. */
  batteryLocationOther: string;
  /** Dogs on property? Affects site survey + installer access. */
  dogsOnProperty: boolean | null;
  /** Locked gates? Triggers gateCode capture. */
  lockedGates: boolean | null;
  /** Gate code / access instructions when lockedGates is true. */
  gateCode: string;
  /** Free-text "important notes, special instructions, or feedback for the team". */
  additionalNotes: string;
}

/**
 * Empty intake — used as the form's initial state and as a fallback when
 * an older project's installerIntakeJson is null/malformed.
 */
export const EMPTY_BVI_INTAKE: BviIntake = {
  customerPhone: '',
  customerEmail: '',
  customerAddress: '',
  exportType: null,
  existingSystemInfo: '',
  siteSurveyNeeded: null,
  batteryLocation: null,
  batteryLocationOther: '',
  dogsOnProperty: null,
  lockedGates: null,
  gateCode: '',
  additionalNotes: '',
};

/**
 * Parse a Project.installerIntakeJson string into a BviIntake.
 * Falls back to EMPTY_BVI_INTAKE on null / malformed JSON / wrong shape.
 * Defensive — never throws — because legacy rows or hand-edited DB rows
 * shouldn't crash the project page.
 */
export function parseBviIntake(json: string | null | undefined): BviIntake {
  if (!json) return { ...EMPTY_BVI_INTAKE };
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== 'object') return { ...EMPTY_BVI_INTAKE };
    const p = parsed as Partial<BviIntake>;
    return {
      customerPhone: typeof p.customerPhone === 'string' ? p.customerPhone : '',
      customerEmail: typeof p.customerEmail === 'string' ? p.customerEmail : '',
      customerAddress: typeof p.customerAddress === 'string' ? p.customerAddress : '',
      exportType: p.exportType === 'NEM 3.0' || p.exportType === 'Non-Export' ? p.exportType : null,
      existingSystemInfo: typeof p.existingSystemInfo === 'string' ? p.existingSystemInfo : '',
      siteSurveyNeeded: typeof p.siteSurveyNeeded === 'boolean' ? p.siteSurveyNeeded : null,
      batteryLocation:
        p.batteryLocation === 'Inside Garage' || p.batteryLocation === 'Outside Garage' || p.batteryLocation === 'Other'
          ? p.batteryLocation
          : null,
      batteryLocationOther: typeof p.batteryLocationOther === 'string' ? p.batteryLocationOther : '',
      dogsOnProperty: typeof p.dogsOnProperty === 'boolean' ? p.dogsOnProperty : null,
      lockedGates: typeof p.lockedGates === 'boolean' ? p.lockedGates : null,
      gateCode: typeof p.gateCode === 'string' ? p.gateCode : '',
      additionalNotes: typeof p.additionalNotes === 'string' ? p.additionalNotes : '',
    };
  } catch {
    return { ...EMPTY_BVI_INTAKE };
  }
}

// ─── PDF coordinate map ──────────────────────────────────────────────────
//
// PRELIMINARY COORDINATES — derived from visual layout of the BVI template.
// Phase 7 testing must visually verify and recalibrate.
//
// PDF coordinate space:
//   - Origin (0,0) is BOTTOM-LEFT of the page
//   - X grows rightward, Y grows UPWARD
//   - Page is US Letter 612 × 792 points (8.5" × 11" at 72 dpi)
//
// Layout reading from top of page:
//   - Header band ends ~y=720 (top of page minus header height)
//   - SALES REPRESENTATIVE band      — ~y=685
//   - CUSTOMER INFORMATION band      — ~y=620
//   - SYSTEM DETAILS band            — ~y=510
//   - SITE SURVEY band               — ~y=380
//   - ADDITIONAL NOTES band          — ~y=200
//
// Three-column layout uses x offsets:
//   - Column 1: x=85 (left margin)
//   - Column 2: x=245
//   - Column 3: x=405
//   - Full-width fields: x=85 extending to x=540

export interface PdfCoord {
  x: number;
  y: number;
  /** Optional max width for text wrapping (long-text fields). */
  maxWidth?: number;
  /** Font size; defaults to 10pt. */
  size?: number;
}

/**
 * Map of BVI form fields to (x, y) draw positions on the master template.
 * Keys are NOT the same as BviIntake keys — they include both intake
 * fields AND project-derived fields (rep name, customer info, etc.).
 */
export interface BviCoordMap {
  // Sales Representative section
  salesRepName: PdfCoord;
  salesRepPhone: PdfCoord;
  salesRepEmail: PdfCoord;

  // Customer Information section
  customerName: PdfCoord;
  customerPhone: PdfCoord;
  customerEmail: PdfCoord;
  customerAddress: PdfCoord;

  // System Details section
  exportTypeNem3Box: PdfCoord;
  exportTypeNonExportBox: PdfCoord;
  financeProduct: PdfCoord;
  existingSystemInfo: PdfCoord;

  // Site Survey & Installation Notes section
  siteSurveyYesBox: PdfCoord;
  siteSurveyNoBox: PdfCoord;
  batteryLocationInsideGarageBox: PdfCoord;
  batteryLocationOutsideGarageBox: PdfCoord;
  batteryLocationOther: PdfCoord;
  dogsYesBox: PdfCoord;
  dogsNoBox: PdfCoord;
  lockedGatesYesBox: PdfCoord;
  lockedGatesNoBox: PdfCoord;
  gateCode: PdfCoord;

  // Additional Notes & Feedback section
  additionalNotes: PdfCoord;
}

/**
 * Coordinate offsets for the BVI template at lib/forms/bvi-intake.pdf.
 *
 * NOTE: These are first-pass estimates. To recalibrate, render a test PDF
 * with sample data via Phase 7 verification + adjust by visual inspection.
 * Add a debug-grid mode to the renderer if recalibration becomes frequent.
 */
export const BVI_PDF_COORDS: BviCoordMap = {
  salesRepName:  { x: 90, y: 668, maxWidth: 145 },
  salesRepPhone: { x: 250, y: 668, maxWidth: 145 },
  salesRepEmail: { x: 410, y: 668, maxWidth: 145 },

  customerName:    { x: 90, y: 595, maxWidth: 145 },
  customerPhone:   { x: 250, y: 595, maxWidth: 145 },
  customerEmail:   { x: 410, y: 595, maxWidth: 145 },
  customerAddress: { x: 90, y: 558, maxWidth: 460 },

  exportTypeNem3Box:      { x: 96, y: 484 },
  exportTypeNonExportBox: { x: 188, y: 484 },
  financeProduct:    { x: 90, y: 448, maxWidth: 460 },
  existingSystemInfo:{ x: 90, y: 410, maxWidth: 460 },

  siteSurveyYesBox: { x: 96, y: 332 },
  siteSurveyNoBox:  { x: 156, y: 332 },
  batteryLocationInsideGarageBox:  { x: 96, y: 296 },
  batteryLocationOutsideGarageBox: { x: 234, y: 296 },
  batteryLocationOther:            { x: 388, y: 296, maxWidth: 165 },
  dogsYesBox:       { x: 96, y: 260 },
  dogsNoBox:        { x: 156, y: 260 },
  lockedGatesYesBox:{ x: 96, y: 222 },
  lockedGatesNoBox: { x: 156, y: 222 },
  gateCode:         { x: 90, y: 188, maxWidth: 460 },

  additionalNotes: { x: 90, y: 130, maxWidth: 460, size: 9 },
};

/**
 * Filename used when this PDF is generated and attached to the handoff
 * email. Customer last name + ISO date for predictable filing.
 */
export function bviHandoffFilename(customerLastName: string, dateIso: string): string {
  const safe = customerLastName.replace(/[^a-zA-Z0-9-]/g, '_').slice(0, 40) || 'customer';
  return `BVI_Intake_${safe}_${dateIso}.pdf`;
}
