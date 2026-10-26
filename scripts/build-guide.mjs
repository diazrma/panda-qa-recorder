/**
 * Gera docs/Panda-QA-Recorder-Guia.pdf a partir de docs/guia/guia.html.
 * Uso: node scripts/build-guide.mjs   (CHROME_PATH opcional, como nos testes)
 */
import { chromium } from 'playwright';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage();
await page.goto('file://' + path.join(root, 'docs/guia/guia.html'), { waitUntil: 'load' });
const out = path.join(root, 'docs/Panda-QA-Recorder-Guia.pdf');
await page.pdf({
  path: out,
  format: 'A4',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: true,
  headerTemplate: '<span></span>',
  footerTemplate: '<div style="width:100%;font-size:8px;color:#8a909c;padding:0 16mm;display:flex;justify-content:space-between"><span>Panda QA Recorder · Guia de instalação e uso</span><span><span class="pageNumber"></span>/<span class="totalPages"></span></span></div>',
});
await browser.close();
console.log(out);
