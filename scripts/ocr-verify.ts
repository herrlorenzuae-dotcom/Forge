// Dev check: run the full extractText pipeline on the scanned fixture.
import * as fs from 'node:fs';
import { extractText, chunkIntoProvisions } from '../src/documents/parser.js';

const buf = fs.readFileSync(process.argv[2] ?? '/tmp/scanned-side-letter.pdf');
const t0 = Date.now();
const text = await extractText(buf, 'scanned-side-letter.pdf', 'application/pdf');
console.log(`extracted ${text.replace(/\s+/g, '').length} chars in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log('--- first 400 chars ---');
console.log(text.slice(0, 400));
const provisions = chunkIntoProvisions(text);
console.log('--- provisions ---');
for (const p of provisions) console.log(`  [${p.topic}] ${p.heading.slice(0, 60)}`);
