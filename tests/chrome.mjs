/**
 * Caminho do Chromium para os testes: CHROME_PATH, se informado; senão o do Playwright instalado;
 * se essa versão não estiver baixada, o Chromium mais novo que já existir no cache do Playwright.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

export function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (fs.existsSync(chromium.executablePath())) return undefined;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache/ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1])) : [];
  for (const d of dirs) {
    for (const sub of ['chrome-linux64/chrome', 'chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium', 'chrome-win/chrome.exe']) {
      const p = path.join(cache, d, sub);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}
