/**
 * Gera os prints do guia (docs/guia/img) usando a Loja Demo de tests/site,
 * para o guia não depender de nenhuma loja real.
 * Uso: node scripts/guide-screens.mjs && node scripts/build-guide.mjs
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const siteDir = path.join(root, 'tests/site');
const imgDir = path.join(root, 'docs/guia/img');
const tmpDir = path.join(root, 'tests/out/guide');
fs.mkdirSync(tmpDir, { recursive: true });

const server = http.createServer((req, res) => {
  const file = path.join(siteDir, new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'home.html');
  if (!file.startsWith(siteDir) || !fs.existsSync(file)) return res.writeHead(404).end();
  const types = { '.css': 'text/css', '.json': 'application/json' };
  res.writeHead(200, { 'content-type': `${types[path.extname(file)] || 'text/html'}; charset=utf-8` }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});

try {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const page = context.pages()[0];
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 800 });
  await page.bringToFront();

  await page.goto(`${base}/home.html`);
  await sw.evaluate(async (baseUrl) => {
    await chrome.storage.local.set({
      tests: [],
      vars: [
        { key: 'baseUrl', value: baseUrl, secret: false },
        { key: 'senha', value: '', secret: true },
        { key: 'emailDomain', value: 'example.com', secret: false },
      ],
      settings: { updateUrl: `${baseUrl}/version-test.json` },
    });
  }, base);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0].id);
  const call = (fn, arg) => sw.evaluate(fn, arg);
  const newTest = (id, name, extra = {}) => call(async ({ id, name, extra }) => {
    const { tests } = await chrome.storage.local.get('tests');
    tests.push({ id, name, steps: [], runs: [], createdAt: Date.now(), updatedAt: Date.now(), ...extra });
    await chrome.storage.local.set({ tests });
  }, { id, name, extra });
  const editTests = async (fn) => {
    const tests = await call(async () => (await chrome.storage.local.get('tests')).tests);
    fn(tests);
    await call(async (t) => chrome.storage.local.set({ tests: t }), tests);
  };
  const record = (id) => call(({ id, tabId }) => self.qa.startRecording({ testId: id, tabId }), { id, tabId });
  const stop = () => call(() => self.qa.stopRecording());
  const pick = async (id, selector) => {
    await call(({ id, tabId }) => self.qa.startPick({ testId: id, tabId }), { id, tabId });
    await page.hover(selector);
    await page.waitForTimeout(150);
    await page.click(selector);
    await page.waitForTimeout(300);
  };
  const run = (id) => call(({ id, tabId }) => self.qa.runTests({ testIds: [id], tabId }), { id, tabId });
  const openPanel = async (name) => {
    await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
    if (name) await panel.click(`.card:has-text("${name}")`);
    await panel.waitForTimeout(400);
  };
  const appShot = async (file, maxH = 800) => {
    const h = await panel.evaluate(() => document.getElementById('app').scrollHeight);
    await panel.screenshot({ path: file, clip: { x: 0, y: 0, width: 400, height: Math.min(h + 4, maxH) }, fullPage: true });
  };

  // Compra com tamanho, verificando a mensagem de sucesso
  await newTest('buy', 'Comprar camiseta tamanho M');
  await record('buy');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(tmpDir, 'home-gravando.png') });
  await page.click('.product-item >> nth=0 >> text=Ver produto');
  await page.waitForURL(/produto/);
  await page.selectOption('#size', 'M');
  await page.click('text=Adicionar ao carrinho');
  await page.waitForSelector('.message-success');
  await pick('buy', '.message-success');
  await stop();

  // Login com senha errada, verificando o aviso
  await newTest('loginerr', 'Login com senha errada mostra aviso');
  await page.goto(`${base}/login.html`);
  await record('loginerr');
  await page.click('#email');
  await page.keyboard.type('rodrigo.test@example.com');
  await page.click('#pass');
  await page.keyboard.type('errada');
  await page.click('button.login');
  await page.waitForSelector('.message-error');
  await pick('loginerr', '.message-error');
  await stop();
  await editTests((tests) => {
    const err = tests.find((t) => t.id === 'loginerr');
    tests.push({
      id: 'loginok', name: 'Login (espera entrar na conta)', runs: [], createdAt: Date.now(), updatedAt: Date.now(),
      steps: [...err.steps.slice(0, 4).map((s) => ({ ...s })), { id: 'z1', type: 'assertUrl', value: 'account.html', timeout: 4000 }],
    });
    tests.push({
      id: 'heal', name: 'Login com seletores antigos', runs: [], createdAt: Date.now(), updatedAt: Date.now(),
      steps: [
        { id: 'h1', type: 'navigate', url: '{{baseUrl}}/login.html' },
        { id: 'h2', type: 'type', selectors: [{ css: '#email-antigo' }], value: 'rodrigo.test@example.com', label: 'E-mail', fp: { tag: 'input', type: 'email', label: 'E-mail' } },
        { id: 'h3', type: 'click', selectors: [{ css: '#botao-entrar-velho' }], label: 'Entrar', fp: { tag: 'button', text: 'Entrar', classes: ['action', 'login'] } },
        { id: 'h4', type: 'assertText', selectors: [{ css: '.page.messages' }], value: 'incorretos', label: 'aviso' },
      ],
    });
    Object.assign(tests.find((t) => t.id === 'buy'), { repeat: 3, interval: 1 });
  });

  await page.goto('about:blank');
  await run('loginerr');
  await run('heal');
  await run('buy');
  await run('loginok');
  await page.screenshot({ path: path.join(tmpDir, 'login-falha.png') });

  await openPanel(null);
  await panel.screenshot({ path: path.join(tmpDir, 'panel-lista.png') });
  await openPanel('Login com senha errada mostra aviso');
  await appShot(path.join(imgDir, 'p2-teste-passou.png'));
  await openPanel('Comprar camiseta');
  await appShot(path.join(imgDir, 'p5-repeticao.png'));
  await openPanel('espera entrar');
  await panel.waitForSelector('.ai .ai-title');
  await panel.screenshot({ path: path.join(tmpDir, 'panel-falha.png') });
  await panel.locator('.banner.failed').screenshot({ path: path.join(imgDir, 'ia.png') });
  await panel.click('[data-action="share"]');
  await panel.waitForSelector('dialog[open] .share-opt');
  await panel.locator('dialog[open]').screenshot({ path: path.join(imgDir, 'p6-compartilhar.png') });
  await openPanel('seletores antigos');
  await panel.waitForSelector('.step-healed');
  await panel.locator('.steps').screenshot({ path: path.join(imgDir, 'autocorrecao.png') });
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  await panel.click('[data-view="vars"]');
  await panel.waitForTimeout(300);
  await appShot(path.join(imgDir, 'p7-variaveis.png'));
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  await panel.click('[data-view="settings"]');
  await panel.waitForTimeout(300);
  await appShot(path.join(imgDir, 'p8-config.png'), 1200);
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'update:check' }));
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  await panel.click('.update-pill');
  await panel.waitForSelector('dialog[open] .update-steps');
  await panel.locator('dialog[open]').screenshot({ path: path.join(imgDir, 'atualizacao.png') });

  // Loja + painel lado a lado, como o QA vê no Chrome.
  const compose = async (left, right, out) => {
    const data = (f) => 'data:image/png;base64,' + fs.readFileSync(path.join(tmpDir, f)).toString('base64');
    const c = await context.newPage();
    await c.setViewportSize({ width: 1682, height: 800 });
    await c.setContent(`<body style="margin:0;display:flex;gap:2px;background:#e2e6ec"><img src="${data(left)}" style="width:1280px;height:800px"><img src="${data(right)}" style="width:400px;height:800px;object-fit:cover;object-position:top"></body>`);
    await c.screenshot({ path: path.join(imgDir, out) });
    await c.close();
  };
  await compose('home-gravando.png', 'panel-lista.png', 'tela-gravando.png');
  await compose('login-falha.png', 'panel-falha.png', 'tela-falha.png');

  const ext = await context.newPage();
  await ext.goto('chrome://extensions');
  await ext.waitForTimeout(800);
  await ext.screenshot({ path: path.join(imgDir, 'i1-chrome-extensions.png'), clip: { x: 0, y: 0, width: 1280, height: 320 } });
} finally {
  await context.close();
  server.close();
}

console.log('prints gerados em', imgDir);
