// One-shot smoke test for the BVI handoff PDF renderer (post-fillable-form
// rewrite). Renders a sample to C:\Users\Jarvis\Desktop\bvi-sample.pdf so
// you can visually confirm the AcroForm fields populate correctly.
//
// Run: npx tsx scripts/render-bvi-smoke.mts
//
// Self-contained — does not import from @/lib (path-alias resolution
// outside Next.js runtime is finicky). Mirrors the production renderer.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const templatePath = path.resolve(process.cwd(), 'lib', 'forms', 'bvi-intake.pdf');
const templateBytes = readFileSync(templatePath);
const doc = await PDFDocument.load(templateBytes);
const form = doc.getForm();
const font = await doc.embedFont(StandardFonts.Helvetica);
form.updateFieldAppearances(font);

form.getTextField('salesRepName').setText('Sample Rep Name');
form.getTextField('customerName').setText('Sample Customer Name');
form.getTextField('customerPhone').setText('(555) 987-6543');
form.getTextField('customerEmail').setText('customer@example.com');
form.getTextField('customerAddress').setText('1234 Sample Street, Anytown, CA 91234');
form.getTextField('financeProduct').setText('Mosaic Loan 25yr');
form.getTextField('existingSystemInfo').setText('No existing solar; gas water heater.');
form.getTextField('gateCode').setText('#4321');
const notes = form.getTextField('additionalNotes');
notes.setFontSize(9);
notes.setText('Customer prefers morning install. Park in driveway only.');

form.getCheckBox('exportTypeNem3').check();
form.getCheckBox('siteSurveyYes').check();
form.getCheckBox('batteryInsideGarage').check();
form.getCheckBox('dogsNo').check();
form.getCheckBox('lockedGatesYes').check();

form.flatten();

const bytes = await doc.save();
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = `C:\\Users\\Jarvis\\Desktop\\bvi-sample-${stamp}.pdf`;
writeFileSync(out, bytes);
console.log(`Rendered ${bytes.length} bytes → ${out}`);
