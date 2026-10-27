/**
 * Teste de ponta a ponta das funções de time da extensão: seletor de site, previsão de teste
 * instável, lançamento de horas no ClickUp (API simulada) e o servidor do time rodando local
 * (modelo federado, contribuição e radar). Prints em tests/out/time/.
 *
 * Uso: npm run test:time
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const siteDir = path.join(root, 'tests/site');
const outDir = path.join(root, 'tests/out/time');
fs.mkdirSync(outDir, { recursive: true });

process.env.DADOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'panda-qa-time-'));
process.env.EQUIPE_CHAVE = 'chave-do-time-e2e';
process.env.ADMIN_SENHA = 'senha-admin-e2e-123';
delete process.env.BLOB_READ_WRITE_TOKEN;
const { criarServidor } = await import('../servidor/dev.js');
const team = criarServidor();
await new Promise((r) => team.listen(0, '127.0.0.1', r));
const teamUrl = `http://127.0.0.1:${team.address().port}`;
const admin = async (acao, extra = {}) => (await fetch(`${teamUrl}/api/admin`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-senha': process.env.ADMIN_SENHA }, body: JSON.stringify({ acao, ...extra }),
})).json();

const site = http.createServer((req, res) => {
  const file = path.join(siteDir, new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'login.html');
  if (!file.startsWith(siteDir) || !fs.existsSync(file)) return res.writeHead(404).end('not found');
  res.writeHead(200, { 'content-type': `${file.endsWith('.css') ? 'text/css' : 'text/html'}; charset=utf-8` }).end(fs.readFileSync(file));
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${site.address().port}`;

const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  executablePath: process.env.CHROME_PATH || undefined,
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
});

// ClickUp simulado: guarda o que a extensão mandou.
const clickup = [];
await context.route('https://api.clickup.com/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  clickup.push({ method: req.method(), path: url.pathname, auth: req.headers().authorization, body: req.postDataBuffer()?.toString('utf8') });
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (req.headers().authorization !== 'pk_teste') return json(401, { err: 'Token invalid' });
  if (req.method() === 'GET' && /\/task\/86ajthyru$/.test(url.pathname)) {
    return json(200, { id: '86ajthyru', name: 'Checkout com boleto não gera pedido', status: { status: 'qa', color: '#f59e0b' }, list: { name: 'Sprint 42' }, folder: { name: 'Mueller' }, team_id: '9011', url: 'https://app.clickup.com/t/86ajthyru' });
  }
  if (req.method() === 'GET' && /\/task\/86ajthyru\/time$/.test(url.pathname)) {
    return json(200, { data: [{ user: { username: 'Ana' }, intervals: [{ start: String(Date.now() - 864e5), time: String(65 * 60e3) }] }] });
  }
  return json(200, { id: 'x' });
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

try {
  const sw = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;
  const page = context.pages()[0] || await context.newPage();
  await page.goto(`${base}/login.html`);

  const runs = (pattern) => pattern.split('').map((c, i) => ({ status: c === 'p' ? 'passed' : 'failed', at: Date.now() - i * 60e3, ms: 4000 }));
  await sw.evaluate(async ({ base }) => {
    const steps = (url) => [{ id: 'a', type: 'navigate', url }, { id: 'b', type: 'click', selectors: [{ css: '#email' }], label: 'E-mail' }];
    await chrome.storage.local.set({
      tests: [
        { id: 'm1', name: 'Checkout boleto', site: 'https://staging.mueller.com.br', steps: steps('https://staging.mueller.com.br/'), runs: [] },
        { id: 'm2', name: 'Login cliente', site: 'https://staging.mueller.com.br', steps: steps('https://staging.mueller.com.br/customer/account/login'), runs: [] },
        { id: 's1', name: 'Busca', steps: steps('https://loja.simpress.com.br/'), runs: [] },
        { id: 'l1', name: 'Login local', steps: [{ id: 'a', type: 'navigate', url: '{{baseUrl}}/login.html' }, { id: 'b', type: 'click', selectors: [{ css: '#nao-existe' }], label: 'Botão que sumiu', timeout: 1500 }], runs: [] },
      ],
      vars: [{ key: 'baseUrl', value: base, secret: false }, { key: 'senha', value: '', secret: true }],
      sites: { 'https://staging.mueller.com.br': { label: 'Mueller · staging' } },
    });
  }, { base });
  // Histórico que alterna entre passar e falhar.
  await sw.evaluate(async (r) => {
    const { tests } = await chrome.storage.local.get('tests');
    tests.find((t) => t.id === 'm2').runs = r;
    await chrome.storage.local.set({ tests });
  }, runs('pfppfpfppp'));

  const panel = await context.newPage();
  const panelErrors = [];
  panel.on('pageerror', (e) => panelErrors.push(e.message));
  panel.on('console', (m) => m.type() === 'error' && panelErrors.push(m.text()));
  await panel.setViewportSize({ width: 400, height: 860 });
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  await panel.waitForSelector('.card');

  console.log('Seletor de site');
  await panel.click('[data-action="site-toggle"]');
  await panel.waitForSelector('.site-dd');
  await panel.screenshot({ path: path.join(outDir, 'sites-aberto.png') });
  const options = await panel.$$eval('.site-opt[data-site]', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim().replace(/^\S /, "")));
  await check('lista os sites com a contagem (inclusive o da variável baseUrl)', async () => {
    assert.equal(options[0].replace(/^✱ /, ''), 'Todos os sites 4');
    assert.ok(options.includes('Mueller · staging staging.mueller.com.br 2'), options.join(' | '));
    assert.ok(options.some((o) => o.startsWith('loja.simpress.com.br 1')), options.join(' | '));
    assert.ok(options.some((o) => o.startsWith(`${base.replace('http://', '')} 1`)), options.join(' | '));
  });
  await panel.click('.site-opt:has-text("Mueller")');
  await panel.waitForSelector('.site-dd', { state: 'detached' });
  const names = await panel.$$eval('.card .card-title', (els) => els.map((e) => e.textContent));
  await check('filtra a lista e o "Executar todos" pelo site escolhido', async () => {
    assert.deepEqual(names.sort(), ['Checkout boleto', 'Login cliente']);
    assert.match(await panel.textContent('[data-action="run-all"]'), /Executar todos \(2\)/);
  });
  await check('lembra o site escolhido ao reabrir o painel', async () => {
    await panel.reload();
    await panel.waitForSelector('.card');
    assert.equal((await panel.$$('.card')).length, 2);
  });

  console.log('Previsão de teste instável');
  await panel.screenshot({ path: path.join(outDir, 'sites-filtrado.png') });
  await check('marca o teste que alterna entre passar e falhar', async () => {
    assert.match(await panel.textContent('.card:has-text("Login cliente")'), /Instável · 3\/10/);
    assert.doesNotMatch(await panel.textContent('.card:has-text("Checkout boleto")'), /Instável/);
  });
  await panel.click('.card:has-text("Login cliente")');
  await panel.waitForSelector('.steps');
  await check('mostra a previsão dentro do teste', async () => assert.match(await panel.textContent('.banner.stopped'), /falhou 3 das últimas 10.*cerca de 30%/s));

  console.log('ClickUp');
  await check('sem token, só convida a configurar', async () => assert.ok(await panel.$('.cu-off')));
  await sw.evaluate(async () => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, clickupToken: 'pk_teste', clickupDoneStatus: 'qa aprovado' } });
  });
  await panel.waitForSelector('#cu-ref');
  await panel.fill('#cu-ref', 'https://app.clickup.com/t/86ajthyru');
  await panel.click('[data-action="cu-link"]');
  await panel.waitForSelector('.cu-task');
  await panel.waitForSelector('.cu-hist');
  await check('vincula pela URL e mostra tarefa, status e quem já lançou', async () => {
    assert.match(await panel.textContent('.cu-task'), /Checkout com boleto não gera pedido.*Mueller › Sprint 42/s);
    assert.match(await panel.textContent('.cu-hist'), /Ana.*1 h 05 min/s);
  });
  // Sessão de QA começou há 25 min (gravação/execução).
  await sw.evaluate(async () => {
    const { tests } = await chrome.storage.local.get('tests');
    const t = tests.find((x) => x.id === 'm2');
    t.qaSince = Date.now() - 25 * 60e3;
    t.lastRun = { status: 'passed', at: Date.now(), ms: 8000, failedIndex: -1, results: [{ status: 'passed', ms: 1 }, { status: 'passed', ms: 1 }], logs: [] };
    await chrome.storage.local.set({ tests });
  });
  await panel.waitForFunction(() => document.querySelector('#cu-min')?.value === '25');
  await panel.check('#cu-status');
  await panel.locator('.cu').screenshot({ path: path.join(outDir, 'clickup.png') });
  clickup.length = 0;
  await panel.click('[data-action="cu-launch"]');
  await panel.waitForFunction(() => !document.querySelector('[data-action="cu-reset"]'));
  const entry = clickup.find((c) => c.method === 'POST' && c.path === '/api/v2/team/9011/time_entries');
  await check('lança 25 min na tarefa certa, no nome do token', async () => {
    assert.ok(entry, JSON.stringify(clickup.map((c) => `${c.method} ${c.path}`)));
    const body = JSON.parse(entry.body);
    assert.equal(body.tid, '86ajthyru');
    assert.equal(body.duration, 25 * 60e3);
    assert.equal(entry.auth, 'pk_teste');
    assert.match(body.description, /QA: Login cliente \(Mueller · staging\), passou/);
  });
  await check('comenta, anexa o relatório HTML e move o status', async () => {
    assert.ok(clickup.some((c) => c.method === 'POST' && c.path === '/api/v2/task/86ajthyru/comment' && /Tempo lançado: 25 min/.test(c.body)));
    assert.ok(clickup.some((c) => c.method === 'POST' && c.path === '/api/v2/task/86ajthyru/attachment' && /relatorio-login-cliente/.test(c.body)));
    const put = clickup.find((c) => c.method === 'PUT' && c.path === '/api/v2/task/86ajthyru');
    assert.equal(JSON.parse(put.body).status, 'qa aprovado');
  });
  await check('zera o relógio da sessão depois de lançar', async () => {
    const t = await sw.evaluate(async () => (await chrome.storage.local.get('tests')).tests.find((x) => x.id === 'm2'));
    assert.equal(t.qaSince, null);
  });

  console.log('Servidor do time');
  await sw.evaluate(async (url) => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, teamServer: url, teamKey: 'chave-do-time-e2e' } });
  }, teamUrl);
  await panel.click('[data-action="back"]');
  await panel.click('[data-view="settings"]');
  await panel.click('[data-action="team-sync"]');
  await panel.waitForFunction(() => /Modelo do time v1/.test(document.body.innerText), null, { timeout: 30000 });
  await panel.screenshot({ path: path.join(outDir, 'config-time.png'), fullPage: true });
  await check('baixa o modelo do time (v1) do servidor com a chave', async () => {
    const tm = await sw.evaluate(async () => (await chrome.storage.local.get('teamModel')).teamModel);
    assert.equal(tm.versao, 1);
  });

  // Falha real no site de teste -> sinal do radar.
  await sw.evaluate(async (tabUrl) => {
    const [tab] = await chrome.tabs.query({ url: tabUrl + '/*' });
    await self.qa.runTests({ testIds: ['l1'], tabId: tab.id });
  }, base);
  const fila = await sw.evaluate(async () => (await chrome.storage.local.get('radarFila')).radarFila || []);
  await check('execução gera sinal do radar sem endereço, texto ou dado da página', async () => {
    assert.equal(fila.length, 1);
    const s = fila[0];
    assert.equal(s.st, 'failed');
    assert.match(s.s, /^s[0-9a-z]+$/);
    assert.equal(s.f, '/*');
    const raw = JSON.stringify(s);
    assert.doesNotMatch(raw, /127\.0\.0\.1|login\.html|Botão|sumiu/);
    assert.ok(Object.keys(s.v).length > 3);
  });
  await sw.evaluate(() => self.qa.flushSignals ? self.qa.flushSignals() : null);
  await panel.evaluate(() => chrome.runtime.sendMessage({ type: 'radar:flush' }));
  const painel1 = await admin('painel');
  await check('servidor recebe o sinal e classifica a falha pelo vetor', async () => {
    assert.equal(painel1.radar.resumo.execucoes, 1);
    assert.equal(painel1.radar.resumo.falhas, 1);
    assert.equal(painel1.radar.categorias[0].cat, 'selector');
  });

  console.log('Relatório por link');
  const link = await panel.evaluate(async () => {
    const { uploadReport } = await import('../lib/team.js');
    const { tests } = await chrome.storage.local.get('tests');
    const t = tests.find((x) => x.id === 'l1');
    const shot = (await chrome.storage.local.get('shot:l1'))['shot:l1'];
    const url = await uploadReport({ ...t, name: 'Login local <script>alert(1)</script>' }, t.lastRun, shot, { label: 'Elemento mudou ou sumiu', explain: 'x', fix: 'y', confidence: 0.9 });
    return { url, temPrint: Boolean(shot) };
  });
  const semChave = await fetch(link.url);
  const semChaveHtml = await semChave.text();
  const errada = await fetch(link.url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'chave=errada-errada' });
  const certa = await fetch(link.url, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'chave=chave-do-time-e2e' });
  const cookie = (certa.headers.get('set-cookie') || '').split(';')[0];
  await check('sem a chave do time o link pede a chave e não mostra nada do relatório', async () => {
    assert.equal(semChave.status, 401);
    assert.match(semChaveHtml, /Chave do time/);
    assert.doesNotMatch(semChaveHtml, /Botão que sumiu|data:image/);
    assert.equal(errada.status, 401);
    assert.equal(certa.status, 303);
    assert.match(certa.headers.get('set-cookie'), /HttpOnly/);
    assert.doesNotMatch(cookie, /chave-do-time-e2e/);
  });
  const relRes = await fetch(link.url, { headers: { cookie } });
  const relHtml = await relRes.text();
  await check('com a chave abre o link individual /relatorio/<18 dígitos>', async () => {
    assert.match(link.url, /\/relatorio\/\d{18}$/);
    assert.equal(relRes.status, 200);
    assert.match(relHtml, /Baixar PDF/);
    assert.match(relHtml, /Botão que sumiu/);
    assert.ok(link.temPrint && /data:image\/jpeg;base64/.test(relHtml), 'print da falha no relatório');
  });
  await check('texto do teste é escapado e a página só roda o próprio script (CSP)', async () => {
    assert.doesNotMatch(relHtml, /<script>alert\(1\)<\/script>/);
    assert.match(relHtml, /&lt;script&gt;alert/);
    assert.match(relRes.headers.get('content-security-policy'), /default-src 'none'.*script-src 'nonce-/);
  });
  await check('link inexistente dá 404', async () => assert.equal((await fetch(link.url.replace(/\d{18}$/, '123456789012345678'), { headers: { cookie } })).status, 404));
  const relPage = await context.newPage();
  const relErrors = [];
  relPage.on('pageerror', (e) => relErrors.push(e.message));
  relPage.on('console', (m) => m.type() === 'error' && relErrors.push(m.text()));
  await relPage.goto(link.url);
  await relPage.screenshot({ path: path.join(outDir, 'relatorio-chave.png') });
  await relPage.fill('input[name=chave]', 'chave-do-time-e2e');
  await relPage.click('button[type=submit]');
  await relPage.waitForSelector('#pqa-pdf');
  relErrors.length = 0;
  await relPage.reload();
  await relPage.waitForSelector('#pqa-pdf');
  await relPage.screenshot({ path: path.join(outDir, 'relatorio-link.png'), fullPage: true });
  const pdf = await relPage.pdf({ format: 'A4' });
  fs.writeFileSync(path.join(outDir, 'relatorio.pdf'), pdf);
  await check('página do relatório sem erros (CSP não bloqueia nada) e gera PDF', async () => {
    assert.deepEqual(relErrors, []);
    assert.ok(pdf.length > 20000 && pdf.subarray(0, 4).toString() === '%PDF', `${pdf.length} bytes`);
    const clicked = await relPage.evaluate(() => { let n = 0; window.print = () => { n++; }; document.getElementById('pqa-pdf').click(); return n; });
    assert.equal(clicked, 1);
  });
  await relPage.close();

  // Correção do QA -> ajuste local a partir do modelo do time -> contribuição.
  await panel.evaluate(async () => {
    const { learn } = await import('../lib/diagnosis.js');
    const { pushContribution } = await import('../lib/team.js');
    await learn({ stepType: 'click', stepLabel: 'Comprar', error: 'Elemento não encontrado: Comprar', messages: ['Este produto está indisponível para a sua região'], logs: [] }, 'business');
    await pushContribution();
  });
  const painel2 = await admin('painel');
  const delta = await sw.evaluate(async () => (await chrome.storage.local.get('teamDelta')).teamDelta);
  await check('manda a contribuição (só números) e ela fica pendente no servidor', async () => {
    assert.equal(painel2.pendentes.length, 1);
    assert.equal(delta.base, 1);
    assert.equal(delta.n, 1);
    assert.ok(delta.delta.length > 100000);
  });
  const rodada = await admin('rodada');
  await check('rodada fecha e publica a v2; a extensão baixa a nova', async () => {
    assert.equal(rodada.publicado, 2, JSON.stringify(rodada));
    await panel.click('[data-action="team-sync"]');
    await panel.waitForFunction(() => /Modelo do time v2/.test(document.body.innerText), null, { timeout: 30000 });
  });
  await check('diagnóstico continua funcionando com o modelo do time', async () => {
    const key = await panel.evaluate(async () => {
      const { diagnose } = await import('../lib/diagnosis.js');
      return (await diagnose({ stepType: 'click', stepLabel: 'Comprar', error: 'Elemento não encontrado: Comprar', messages: ['Produto indisponível para a sua região'], logs: [] })).key;
    });
    assert.equal(key, 'business');
  });
  await check('servidor de teste gravou só na pasta local, nunca no Blob', async () => {
    assert.ok(!process.env.BLOB_READ_WRITE_TOKEN);
    assert.ok(fs.readdirSync(path.join(process.env.DADOS_DIR, 'relatorios')).length >= 1);
  });
  await check('painel sem erros de JS', async () => assert.deepEqual(panelErrors.filter((e) => !/Failed to load resource/.test(e)), []));
} finally {
  await context.close();
  site.close();
  team.close();
}

console.log(failures ? `\n${failures} verificação(ões) falharam.` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
