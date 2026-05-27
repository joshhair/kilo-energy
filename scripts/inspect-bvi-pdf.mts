// Inspection: list AcroForm fields in a BVI intake PDF.
// Tells us whether the PDF is fillable (has AcroForm fields) or static.
//
// Run (default — inspects the deployed template):
//   npx tsx scripts/inspect-bvi-pdf.mts
//
// Run against a different file (e.g. a refreshed template before swap):
//   npx tsx scripts/inspect-bvi-pdf.mts path/to/other.pdf

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';

const argPath = process.argv[2];
const pdfPath = argPath
  ? path.resolve(process.cwd(), argPath)
  : path.resolve(process.cwd(), 'lib/forms/bvi-intake.pdf');
const bytes = readFileSync(pdfPath);
const doc = await PDFDocument.load(bytes);

console.log(`Loaded ${pdfPath}`);
console.log(`Pages: ${doc.getPageCount()}`);

const page = doc.getPage(0);
const { width, height } = page.getSize();
console.log(`Page 0 dimensions: ${width} x ${height} points (${(width / 72).toFixed(2)}" x ${(height / 72).toFixed(2)}")`);

const form = doc.getForm();
const fields = form.getFields();

console.log(`\nForm field count: ${fields.length}`);
if (fields.length === 0) {
  console.log('\n⚠ Static PDF (no fillable AcroForm fields). Need to use coordinate overlay.');
  process.exit(0);
}

console.log('\nField inventory:');
for (const field of fields) {
  const name = field.getName();
  const type = field.constructor.name;
  console.log(`  - ${type.padEnd(20)} ${JSON.stringify(name)}`);
}
