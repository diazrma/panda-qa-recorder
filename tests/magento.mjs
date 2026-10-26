/**
 * Teste da extensão numa loja Magento real (tema Luma ou derivado).
 * Grava com interações reais, usa o botão Verificação, executa, repete e força falhas
 * típicas (senha errada, campos obrigatórios) para conferir o diagnóstico.
 *
 * Uso: MAGENTO_URL=https://sua-loja.test node tests/magento.mjs   (prints em tests/out/magento/)
 * Só navega e tenta login com senha errada: não cria pedido, cliente nem cotação.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'tests/out/magento');
fs.mkdirSync(outDir, { recursive: true });
if (!process.env.MAGENTO_URL) {
  console.error('Defina MAGENTO_URL, ex.: MAGENTO_URL=https://sua-loja.test node tests/magento.mjs');
  process.exit(2);
}
const base = process.env.MAGENTO_URL.replace(/\/+$/, '');
// E-mail novo a cada execução: o Magento passa a exigir captcha depois de 3 erros no mesmo login.
const EMAIL = `rodrigo.test+${Date.now()}@example.com`;

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  ignoreHTTPSErrors: true,
  viewport: { width: 1366, height: 860 },
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--ignore-certificate-errors'],
});

let failures = 0;
const check = async (name, fn) => {
  try {
    await fn();
    console.log(`  ok    ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FALHA ${name}\n        ${e.message.split('\n')[0]}`);
  }
};
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(outDir, name), ...opts });

try {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const page = context.pages()[0] || await context.newPage();

  await page.goto(`${base}/`, { waitUntil: 'load', timeout: 60000 });
  await sw.evaluate(async (baseUrl) => {
    await chrome.storage.local.set({
      tests: [],
      vars: [{ key: 'baseUrl', value: baseUrl, secret: false }, { key: 'senha', value: '', secret: true }],
    });
  }, base);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ active: true }))[0].id);
  const newTest = (id, name) => sw.evaluate(async ({ id, name }) => {
    const { tests } = await chrome.storage.local.get('tests');
    tests.push({ id, name, steps: [], runs: [], createdAt: Date.now(), updatedAt: Date.now() });
    await chrome.storage.local.set({ tests });
  }, { id, name });
  const getTest = (id) => sw.evaluate(async (id) => (await chrome.storage.local.get('tests')).tests.find((t) => t.id === id), id);
  const record = (id) => sw.evaluate(({ id, tabId }) => self.qa.startRecording({ testId: id, tabId }), { id, tabId });
  const stop = () => sw.evaluate(() => self.qa.stopRecording());
  const pick = async (id, selector) => {
    await sw.evaluate(({ id, tabId }) => self.qa.startPick({ testId: id, tabId }), { id, tabId });
    await page.hover(selector);
    await page.waitForTimeout(200);
    await page.click(selector);
    await page.waitForTimeout(400);
  };
  const run = (id) => sw.evaluate(({ id, tabId }) => self.qa.runTests({ testIds: [id], tabId }), { id, tabId });
  const list = (t) => t.steps.map((s, i) => `        ${i + 1}. ${s.type} ${JSON.stringify(s.selectors?.[0] ?? s.url ?? '')} ${s.value ?? ''}`).join('\n');

  // 1) Navegação: home > primeiro item do menu principal > verificar o título da página
  console.log('Gravação: navegação pelo menu');
  await newTest('nav', 'Magento: navegar pelo menu');
  await record('nav');
  await page.waitForTimeout(400);
  await shot(page, '01-gravando-home.png');
  const menu = page.locator('nav a.level-top[href]:not([href$="#"]), .navigation a.level-top[href]').filter({ visible: true }).first();
  const menuHref = await menu.getAttribute('href');
  await menu.click();
  await page.waitForURL((u) => u.href.replace(/\/$/, '') === new URL(menuHref, base).href.replace(/\/$/, ''), { timeout: 60000 });
  const title = page.locator('h1').filter({ visible: true }).first();
  await title.waitFor();
  const titleText = (await title.innerText()).trim();
  await pick('nav', 'h1 >> visible=true');
  await stop();
  const nav = await getTest('nav');
  console.log(list(nav));
  await check('grava abrir, clicar no menu e a verificação do título', async () => {
    assert.deepEqual(nav.steps.map((s) => s.type), ['navigate', 'click', 'assertText']);
    assert.equal(nav.steps[0].url, '{{baseUrl}}/');
    assert.ok(titleText.includes(nav.steps[2].value) || nav.steps[2].value.includes(titleText.slice(0, 20)));
  });

  // 2) Login com senha errada, verificando a mensagem do Magento
  console.log('Gravação: login com senha errada');
  await newTest('loginerr', 'Magento: login com senha errada mostra aviso');
  await page.goto(`${base}/customer/account/login/`, { waitUntil: 'load' });
  await record('loginerr');
  await page.click('#email >> visible=true');
  await page.keyboard.type(EMAIL);
  await page.click('[name="login[password]"] >> visible=true');
  await page.keyboard.type('SenhaErrada123');
  await page.click('#send2 >> visible=true');
  await page.waitForSelector('.message-error', { timeout: 60000 });
  await page.waitForTimeout(500);
  await pick('loginerr', '.message-error');
  await stop();
  await sw.evaluate(async () => {
    const { tests } = await chrome.storage.local.get('tests');
    tests.find((t) => t.id === 'loginerr').steps[1].value = 'rodrigo.test+{{$timestamp}}@example.com';
    await chrome.storage.local.set({ tests });
  });
  const loginerr = await getTest('loginerr');
  console.log(list(loginerr));
  await check('grava login: e-mail, {{senha}}, clique em Iniciar sesión e verificação do aviso', async () => {
    assert.deepEqual(loginerr.steps.map((s) => s.type), ['navigate', 'type', 'type', 'click', 'assertText']);
    assert.equal(loginerr.steps[2].value, '{{senha}}');
  });
  await shot(page, '02-magento-aviso-login.png');

  // 3) e 4) Testes que devem falhar, para conferir o diagnóstico
  await sw.evaluate(async () => {
    const { tests } = await chrome.storage.local.get('tests');
    const err = tests.find((t) => t.id === 'loginerr');
    tests.push({
      id: 'loginok', name: 'Magento: login (espera entrar na conta)', runs: [], createdAt: Date.now(), updatedAt: Date.now(),
      steps: [...err.steps.slice(0, 4).map((s) => ({ ...s })), { id: 'x1', type: 'assertUrl', value: '/customer/account/index', timeout: 6000 }],
    });
    tests.push({
      id: 'empty', name: 'Magento: entrar sem preencher', runs: [], createdAt: Date.now(), updatedAt: Date.now(),
      steps: [
        { id: 'y1', type: 'navigate', url: '{{baseUrl}}/customer/account/login/' },
        { id: 'y2', type: 'click', selectors: [{ css: '#send2' }], label: 'Iniciar sesión' },
        { id: 'y3', type: 'assertUrl', value: '/customer/account/index', timeout: 3000 },
      ],
    });
    await chrome.storage.local.set({ tests });
  });

  console.log('Replay');
  await page.goto('about:blank');
  for (const id of ['nav', 'loginerr']) {
    const t0 = Date.now();
    const [res] = await run(id);
    const t = await getTest(id);
    console.log(`        ${t.name}: ${res.status} em ${Date.now() - t0} ms${t.lastRun.error ? ` (${t.lastRun.error})` : ''}`);
    if (t.lastRun.logs?.length) console.log(t.lastRun.logs.map((l) => `          passo ${l.step + 1} ${l.kind}: ${l.text.slice(0, 110)}`).join('\n'));
    await check(`replay "${t.name}" passa`, async () => assert.equal(res.status, 'passed', t.lastRun.error));
  }

  const [okRes] = await run('loginok');
  const loginok = await getTest('loginok');
  console.log(`        mensagens: ${JSON.stringify(loginok.lastRun.diagnostics?.messages)}`);
  await check('login que deveria entrar falha e captura o aviso do Magento', async () => {
    assert.equal(okRes.status, 'failed');
    assert.equal(loginok.lastRun.failedIndex, 4);
    assert.ok(loginok.lastRun.diagnostics.messages.length >= 1, JSON.stringify(loginok.lastRun.diagnostics));
  });
  await shot(page, '03-magento-falha-login.png');

  const [emptyRes] = await run('empty');
  const empty = await getTest('empty');
  console.log(`        mensagens: ${JSON.stringify(empty.lastRun.diagnostics?.messages)}`);
  await check('entrar sem preencher falha e captura os erros de validação por campo', async () => {
    assert.equal(emptyRes.status, 'failed');
    assert.ok(empty.lastRun.diagnostics.messages.length >= 2, JSON.stringify(empty.lastRun.diagnostics));
  });
  await shot(page, '04-magento-validacao.png');

  console.log('Repetição');
  await sw.evaluate(async () => {
    const { tests } = await chrome.storage.local.get('tests');
    Object.assign(tests.find((t) => t.id === 'nav'), { repeat: 3, interval: 2 });
    await chrome.storage.local.set({ tests });
  });
  const r0 = Date.now();
  const reps = await run('nav');
  console.log(`        ${reps.map((r) => r.status).join(', ')} em ${Date.now() - r0} ms`);
  await check('navegação repetida 3 vezes passa todas', async () => assert.deepEqual(reps.map((r) => r.status), ['passed', 'passed', 'passed']));

  console.log('Prints do painel');
  const panel = await context.newPage();
  const panelErrors = [];
  panel.on('pageerror', (e) => panelErrors.push(e.message));
  await panel.setViewportSize({ width: 400, height: 860 });
  const open = async (name) => {
    await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
    if (name) await panel.click(`.card:has-text("${name}")`);
    await panel.waitForTimeout(300);
  };
  await open(null);
  await shot(panel, 'p1-lista.png');
  await open('login com senha errada');
  await shot(panel, 'p2-teste-passou.png');
  await open('espera entrar');
  await shot(panel, 'p3-falha-login.png', { fullPage: true });
  await open('sem preencher');
  await shot(panel, 'p4-falha-validacao.png', { fullPage: true });
  await open('navegar pelo menu');
  await shot(panel, 'p5-repeticao.png');
  await open('espera entrar');
  await panel.click('[data-action="share"]');
  await panel.waitForSelector('dialog[open] .share-opt');
  await shot(panel, 'p6-compartilhar.png');
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  await panel.click('[data-view="vars"]');
  await shot(panel, 'p7-variaveis.png');
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  await panel.click('[data-view="settings"]');
  await shot(panel, 'p8-config.png');

  const report = await panel.evaluate(async () => {
    const { toReportHtml } = await import('../lib/report.js');
    const t = (await chrome.storage.local.get('tests')).tests.find((x) => x.id === 'loginok');
    const s = (await chrome.storage.local.get('shot:loginok'))['shot:loginok'];
    return toReportHtml(t, t.lastRun, s);
  });
  fs.writeFileSync(path.join(outDir, 'relatorio-login.html'), report);
  const rp = await context.newPage();
  await rp.setViewportSize({ width: 1000, height: 800 });
  await rp.setContent(report);
  await rp.screenshot({ path: path.join(outDir, 'r1-relatorio.png'), fullPage: true });
  await rp.close();

  const ext = await context.newPage();
  await ext.goto('chrome://extensions');
  await ext.waitForTimeout(800);
  await shot(ext, 'i1-chrome-extensions.png');
  await check('painel sem erros de JS', async () => assert.deepEqual(panelErrors, []));
} finally {
  await context.close();
}

console.log(failures ? `\n${failures} verificação(ões) falharam.` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
