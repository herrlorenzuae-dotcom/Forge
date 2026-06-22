/**
 * Drives the real, seeded Forge app at http://localhost:3000 through the
 * headline flow and captures milestone frames to PNG. Not part of the app —
 * a one-off demo recorder. Run with the dev server already up.
 *
 *   NODE_PATH=<lavern>/node_modules node scripts/capture-demo.mjs
 */
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer');

const OUT = path.resolve('scripts/demo-frames');
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launch() {
  try {
    return await puppeteer.launch({ headless: 'new', defaultViewport: { width: 1380, height: 880, deviceScaleFactor: 2 } });
  } catch {
    return await puppeteer.launch({ channel: 'chrome', headless: 'new', defaultViewport: { width: 1380, height: 880, deviceScaleFactor: 2 } });
  }
}

async function clickByText(page, re) {
  return page.evaluate((src) => {
    const rx = new RegExp(src.source, src.flags);
    const el = [...document.querySelectorAll('button,a')].find((n) => rx.test(n.textContent.trim()));
    if (!el) return false;
    el.click();
    return true;
  }, { source: re.source, flags: re.flags });
}

async function goTab(page, navRe, readyRe) {
  for (let i = 0; i < 3; i++) {
    await clickByText(page, navRe);
    try {
      await page.waitForFunction((s) => new RegExp(s.source, s.flags).test(document.body.innerText), { timeout: 6000 }, {
        source: readyRe.source,
        flags: readyRe.flags,
      });
      return true;
    } catch { await sleep(600); }
  }
  throw new Error(`tab ${navRe} never became ready`);
}

let n = 0;
const shot = async (page, label) => {
  const file = path.join(OUT, `${String(++n).padStart(2, '0')}-${label}.png`);
  await page.screenshot({ path: file });
  console.log('  frame', file);
};

const run = async () => {
  const browser = await launch();
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [page error]', m.text()); });

  console.log('1. Overview');
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => /Overview/i.test(document.body.innerText), { timeout: 15000 });
  // let React hydrate so nav onClick handlers are live
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Obligations'), { timeout: 10000 });
  await sleep(1500);
  await shot(page, 'overview');

  console.log('2. Obligations — the prefilled question');
  await goTab(page, /^Obligations$/i, /ASK WHAT YOU'VE PROMISED|the promises run for a decade/i);
  await page.waitForFunction(() => !!document.querySelector('input.field, textarea'), { timeout: 8000 });
  await sleep(1200);
  await shot(page, 'question');

  console.log('3. Ask — waiting for the live answer (frontier call)…');
  const before = await page.evaluate(() => document.body.innerText.length);
  await clickByText(page, /^Ask$/i);
  // wait for the answer to render: a verified-citation marker + a meaningful
  // content growth over the question-only page
  await page.waitForFunction(
    (b) => {
      const t = document.body.innerText;
      return t.length > b + 400 && /verif|citation|✓|✗/i.test(t);
    },
    { timeout: 120000, polling: 800 },
    before,
  );
  await sleep(1500);
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await sleep(400);
  await shot(page, 'answer');
  // scroll a little to reveal the cited checklist
  await page.evaluate(() => window.scrollBy({ top: 380 }));
  await sleep(600);
  await shot(page, 'answer-citations');

  console.log('4. Privacy — what left the machine');
  await page.evaluate(() => window.scrollTo({ top: 0 }));
  await sleep(300);
  await clickByText(page, /^Privacy$/i);
  await page.waitForFunction(() => /left your machine|sanitiz|payload|masked/i.test(document.body.innerText), { timeout: 8000 }).catch(() => {});
  await sleep(1200);
  await shot(page, 'privacy');

  await browser.close();
  console.log('done →', OUT);
};

run().catch((e) => { console.error('CAPTURE FAILED:', e.message); process.exit(1); });
