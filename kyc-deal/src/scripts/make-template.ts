/** Emit the blank Excel import template to ./data/structure-template.xlsx.
 *  Run: `npm run template:xlsx`. */

import * as XLSX from 'xlsx';
import * as fs from 'node:fs';
import { buildTemplateWorkbook } from '../connectors/excel.js';

const out = './data/structure-template.xlsx';
fs.mkdirSync('./data', { recursive: true });
XLSX.writeFile(buildTemplateWorkbook(), out);
console.log(`Wrote ${out}. Fill the Entities and Relationships sheets, then import on the Structure tab.`);
