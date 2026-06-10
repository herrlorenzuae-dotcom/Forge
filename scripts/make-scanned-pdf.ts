/**
 * Dev fixture: produce a "scanned" PDF — a single page containing only a
 * raster image of a fictional side letter, no text layer at all. This is
 * what a real office scanner emits, and what the OCR fallback must handle.
 *
 *   npx tsx scripts/make-scanned-pdf.ts [outPath]
 */

import * as fs from 'node:fs';
import { createCanvas } from '@napi-rs/canvas';

const LINES = [
  'SIDE LETTER — RIVERBEND COUNTY PENSION TRUST',
  '',
  'Paragraph 1 - Reporting',
  'The General Partner shall deliver to Riverbend County Pension Trust',
  'unaudited quarterly reports within forty-five (45) days after the end',
  'of each fiscal quarter.',
  '',
  'Paragraph 2 - Excused Investments',
  'Riverbend County Pension Trust shall be excused from participation in',
  'any Portfolio Investment in companies deriving revenue from tobacco',
  'products or thermal coal extraction.',
  '',
  'Paragraph 3 - Notice',
  'The General Partner shall provide Riverbend County Pension Trust no',
  'fewer than ten (10) Business Days written notice prior to closing any',
  'investment in an excused category.',
];

function renderPageJpeg(): Buffer {
  const W = 1700;
  const H = 2200;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fdfcf8'; // slightly off-white, like paper
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#1a1a1a';
  let y = 220;
  for (const line of LINES) {
    ctx.font = line === LINES[0] || line.startsWith('Paragraph') ? 'bold 44px Georgia' : '40px Georgia';
    ctx.fillText(line, 160, y);
    y += 74;
  }
  return canvas.toBuffer('image/jpeg', 88);
}

/** Minimal valid one-page PDF embedding a JPEG via DCTDecode. */
function jpegToPdf(jpeg: Buffer, width: number, height: number): Buffer {
  const objects: Buffer[] = [];
  const add = (s: string | Buffer): void => {
    objects.push(typeof s === 'string' ? Buffer.from(s, 'latin1') : s);
  };

  add('%PDF-1.4\n');
  const offsets: number[] = [0]; // object 0 is the free head
  const startObj = (): void => {
    offsets.push(objects.reduce((a, b) => a + b.length, 0));
  };

  startObj();
  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj();
  add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  startObj();
  add(
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
  );
  startObj();
  add(
    `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
  );
  add(jpeg);
  add('\nendstream\nendobj\n');
  const contents = 'q 612 0 0 792 0 0 cm /Im0 Do Q';
  startObj();
  add(`5 0 obj\n<< /Length ${contents.length} >>\nstream\n${contents}\nendstream\nendobj\n`);

  const xrefAt = objects.reduce((a, b) => a + b.length, 0);
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  add(xref);
  add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  return Buffer.concat(objects);
}

const out = process.argv[2] ?? '/tmp/scanned-side-letter.pdf';
const jpeg = renderPageJpeg();
fs.writeFileSync(out, jpegToPdf(jpeg, 1700, 2200));
console.log(`wrote ${out} (${fs.statSync(out).size} bytes, image-only — no text layer)`);
