/**
 * Teste de ponta a ponta da extensão: carrega no Chromium, grava um fluxo com
 * interações reais, executa o replay, força uma falha e tira prints do painel.
 *
 * Uso: npm test   (prints em tests/out/)
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromePath } from './chrome.mjs';

const root = path.resolve(import.meta.dirname, '..');
const siteDir = path.join(root, 'tests/site');
const outDir = path.join(root, 'tests/out');
fs.mkdirSync(outDir, { recursive: true });

const server = http.createServer((req, res) => {
  const file = path.join(siteDir, new URL(req.url, 'http://x').pathname.replace(/^\/+/, '') || 'login.html');
  if (!file.startsWith(siteDir) || !fs.existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  const types = { '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
  res.writeHead(200, { 'content-type': `${types[path.extname(file)] || 'text/html'}; charset=utf-8` }).end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// CHROME_PATH permite usar um Chromium já instalado quando a versão do Playwright não bate com o cache.
const context = await chromium.launchPersistentContext('', {
  channel: 'chromium',
  executablePath: chromePath(),
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`],
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
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${base}/login.html`);
  await sw.evaluate(async (baseUrl) => {
    await chrome.storage.local.set({
      tests: [{ id: 't1', name: 'Login e telefone', steps: [], runs: [] }],
      vars: [{ key: 'baseUrl', value: baseUrl, secret: false }, { key: 'senha', value: '', secret: true }],
    });
  }, base);
  const tabId = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'http://127.0.0.1/*' }))[0].id);

  console.log('Gravação');
  await sw.evaluate(({ tabId }) => self.qa.startRecording({ testId: 't1', tabId }), { tabId });
  await page.waitForTimeout(300);
  await page.click('#email');
  await page.keyboard.type('rodrigo.test@example.com');
  await page.click('#pass');
  await page.keyboard.type('Senha123');
  await page.click('label.remember');
  await page.selectOption('#store', 'cl');
  await page.click('button.login');
  await page.waitForURL(/account\.html/);
  await page.locator('[name=telephone]').click();
  await page.keyboard.type('11999990000');
  await page.click('text=Salvar');
  await page.click('text=Meus pedidos');
  await page.waitForURL(/orders\.html/);
  await page.waitForTimeout(300);
  await sw.evaluate(() => self.qa.stopRecording());

  const recorded = await sw.evaluate(async () => (await chrome.storage.local.get('tests')).tests[0]);
  const vars = await sw.evaluate(async () => (await chrome.storage.local.get('vars')).vars);
  console.log(recorded.steps.map((s, i) => `        ${i + 1}. ${s.type} ${JSON.stringify(s.selectors?.[0] ?? s.url)} ${s.value ?? ''}`).join('\n'));

  await check('grava os 9 passos esperados, sem duplicar o clique do label', async () => {
    assert.deepEqual(recorded.steps.map((s) => s.type), ['navigate', 'type', 'type', 'click', 'select', 'click', 'type', 'click', 'click']);
  });
  await check('URL inicial vira {{baseUrl}}', async () => assert.equal(recorded.steps[0].url, '{{baseUrl}}/login.html'));
  await check('senha gravada como {{senha}} e valor só nas variáveis', async () => {
    assert.equal(recorded.steps[2].value, '{{senha}}');
    assert.equal(vars.find((v) => v.key === 'senha').value, 'Senha123');
    assert.ok(!JSON.stringify(recorded).includes('Senha123'));
  });
  await check('campo com id aleatório usa o name como seletor', async () => {
    assert.equal(recorded.steps[6].selectors[0].css, 'input[name="telephone"]');
  });
  await check('botão com id aleatório usa o texto', async () => {
    assert.ok(recorded.steps[7].selectors.some((s) => s.text === 'Salvar'));
    assert.ok(!recorded.steps[7].selectors.some((s) => /#[A-Z0-9]{7}$/.test(s.css || '')));
  });

  // Troca o e-mail fixo pelo gerado e adiciona verificações, como o QA faria no editor.
  await sw.evaluate(async () => {
    const { tests } = await chrome.storage.local.get('tests');
    const t = tests[0];
    t.steps[1].value = '{{$email}}';
    t.steps.splice(6, 0, { id: 'a1', type: 'assertText', selectors: [{ css: 'h1.welcome' }], value: 'Bem-vindo, qa+', label: 'título' });
    t.steps.splice(9, 0, { id: 'a2', type: 'assertText', selectors: [{ css: '.msg' }], value: 'Telefone salvo: 11999990000', label: 'mensagem' });
    t.steps.push({ id: 'a3', type: 'assertUrl', value: 'orders.html' });
    t.steps.push({ id: 'a4', type: 'assertText', selectors: [{ css: 'p.empty' }], value: 'Você não tem pedidos', label: 'aviso' });
    tests.push({ id: 't2', name: 'Falha proposital', runs: [], steps: [
      { id: 'b1', type: 'navigate', url: '{{baseUrl}}/login.html' },
      { id: 'b2', type: 'assertText', selectors: [{ css: 'h1' }], value: 'Texto que não existe', label: 'título', timeout: 1500 },
    ] });
    await chrome.storage.local.set({ tests });
  });

  console.log('Replay');
  await page.goto('about:blank');
  const t0 = Date.now();
  const summary = await sw.evaluate(({ tabId }) => self.qa.runTests({ testIds: ['t1'], tabId }), { tabId });
  const run = await sw.evaluate(async () => (await chrome.storage.session.get('run')).run);
  console.log(`        ${summary[0].status} em ${Date.now() - t0} ms`);
  await check('replay passa em todos os passos', async () => {
    const bad = run.results.map((r, i) => ({ ...r, i: i + 1 })).filter((r) => r.status !== 'passed');
    assert.equal(summary[0].status, 'passed', JSON.stringify(bad));
  });
  await check('replay terminou na página de pedidos', async () => assert.match(page.url(), /orders\.html/));

  const failed = await sw.evaluate(({ tabId }) => self.qa.runTests({ testIds: ['t2'], tabId }), { tabId });
  const failRun = await sw.evaluate(async () => (await chrome.storage.session.get('run')).run);
  const hasShot = await sw.evaluate(async () => Boolean((await chrome.storage.local.get('shot:t2'))['shot:t2']));
  await check('teste com texto errado falha no passo certo com mensagem clara', async () => {
    assert.equal(failed[0].status, 'failed');
    assert.equal(failRun.index, 1);
    assert.match(failRun.error, /Texto que não existe/);
  });
  await check('print da tela salvo na falha', async () => assert.ok(hasShot));
  await check('sem erros de JS na página', async () => assert.deepEqual(errors, []));

  console.log('Sessão limpa');
  const plant = () => page.evaluate(() => { document.cookie = 'logado=1; path=/'; localStorage.setItem('mage-cache-storage', '{"customer":{"fullname":"Test Rodrigo"}}'); });
  const leftovers = () => page.evaluate(() => `${document.cookie}|${localStorage.getItem('mage-cache-storage') || ''}`);
  await page.goto(`${base}/orders.html`);
  await plant();
  await sw.evaluate(({ tabId }) => self.qa.runTests({ testIds: ['t2'], tabId }), { tabId });
  const afterClean = await leftovers();
  await check('por padrão apaga cookies e localStorage do site antes de executar', async () => assert.equal(afterClean, '|'));
  await sw.evaluate(async () => {
    const { tests } = await chrome.storage.local.get('tests');
    tests.find((t) => t.id === 't2').cleanSession = false;
    await chrome.storage.local.set({ tests });
  });
  await plant();
  await sw.evaluate(({ tabId }) => self.qa.runTests({ testIds: ['t2'], tabId }), { tabId });
  const afterKeep = await leftovers();
  await check('com a opção desligada mantém a sessão', async () => assert.match(afterKeep, /logado=1\|.*Test Rodrigo/));

  console.log('Diagnóstico de falha (estilo Magento)');
  await sw.evaluate(async () => {
    const { tests } = await chrome.storage.local.get('tests');
    tests.push({ id: 't3', name: 'Login com senha errada', runs: [], steps: [
      { id: 'c1', type: 'navigate', url: '{{baseUrl}}/login.html' },
      { id: 'c2', type: 'type', selectors: [{ css: '#email' }], value: '{{$email}}', label: 'E-mail' },
      { id: 'c3', type: 'type', selectors: [{ css: '#pass' }], value: 'errada', label: 'Senha' },
      { id: 'c4', type: 'click', selectors: [{ tag: 'button', text: 'Entrar' }], label: 'Entrar' },
      { id: 'c5', type: 'assertText', selectors: [{ css: 'h1.welcome' }], value: 'Bem-vindo', label: 'título', timeout: 2000 },
    ] });
    await chrome.storage.local.set({ tests });
  });
  await sw.evaluate(({ tabId }) => self.qa.runTests({ testIds: ['t3'], tabId }), { tabId });
  const t3 = await sw.evaluate(async () => (await chrome.storage.local.get('tests')).tests.find((t) => t.id === 't3'));
  console.log(`        mensagens: ${JSON.stringify(t3.lastRun.diagnostics?.messages)}`);
  console.log(`        logs: ${JSON.stringify(t3.lastRun.logs?.map((l) => `${l.step + 1}:${l.kind}:${l.text.slice(0, 60)}`))}`);
  await check('captura a mensagem de erro do Magento na página', async () => {
    assert.ok(t3.lastRun.diagnostics.messages.includes('O login ou a senha estão incorretos.'));
  });
  await check('captura AJAX com 404 e console.error no passo do clique', async () => {
    const logs = t3.lastRun.logs;
    assert.ok(logs.some((l) => l.kind === 'http' && /^404 GET .*\/customer\/ajax\/login/.test(l.text) && l.step === 3));
    assert.ok(logs.some((l) => l.kind === 'console' && /Falha no login/.test(l.text) && l.step === 3));
  });

  console.log('Auto-correção de seletor');
  await sw.evaluate(async () => {
    const { tests } = await chrome.storage.local.get('tests');
    tests.push({ id: 't4', name: 'Seletores antigos', runs: [], steps: [
      { id: 'h1', type: 'navigate', url: '{{baseUrl}}/login.html' },
      { id: 'h2', type: 'type', selectors: [{ css: '#email-antigo' }], value: 'rodrigo.test@example.com', label: 'E-mail', fp: { tag: 'input', type: 'email', label: 'E-mail' } },
      { id: 'h3', type: 'click', selectors: [{ css: '#botao-entrar-velho' }], label: 'Entrar', fp: { tag: 'button', text: 'Entrar', classes: ['action', 'login'] } },
      { id: 'h4', type: 'assertText', selectors: [{ css: '.page.messages' }], value: 'incorretos', label: 'aviso' },
    ] });
    await chrome.storage.local.set({ tests });
  });
  const [healRun] = await sw.evaluate(({ tabId }) => self.qa.runTests({ testIds: ['t4'], tabId }), { tabId });
  const t4 = await sw.evaluate(async () => (await chrome.storage.local.get('tests')).tests.find((t) => t.id === 't4'));
  console.log(`        ${healRun.status}: ${t4.lastRun.results.map((r) => r.status).join(', ')}`);
  console.log(`        achados: ${t4.lastRun.results.filter((r) => r.healed).map((r) => JSON.stringify(r.healed.selectors[0])).join(' | ')}`);
  await check('passa achando os elementos pelo rótulo e pelo texto', async () => {
    assert.equal(healRun.status, 'passed', t4.lastRun.error);
    assert.deepEqual(t4.lastRun.results.map((r) => r.status), ['passed', 'healed', 'healed', 'passed']);
    assert.equal(t4.lastRun.results[1].healed.selectors[0].css, '#email');
  });
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(settings || {}), autoHeal: false } });
  });
  const [noHeal] = await sw.evaluate(({ tabId }) => self.qa.runTests({ testIds: ['t4'], tabId }), { tabId });
  await check('com a auto-correção desligada, o mesmo teste falha', async () => assert.equal(noHeal.status, 'failed'));
  await sw.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(settings || {}), autoHeal: true } });
  });
  await sw.evaluate(({ tabId }) => self.qa.runTests({ testIds: ['t4'], tabId }), { tabId });

  console.log('Repetição com intervalo');
  await sw.evaluate(async () => {
    const { tests } = await chrome.storage.local.get('tests');
    Object.assign(tests.find((t) => t.id === 't1'), { repeat: 3, interval: 1 });
    await chrome.storage.local.set({ tests });
  });
  const r0 = Date.now();
  const reps = await sw.evaluate(({ tabId }) => self.qa.runTests({ testIds: ['t1'], tabId }), { tabId });
  const repMs = Date.now() - r0;
  const t1 = await sw.evaluate(async () => (await chrome.storage.local.get('tests')).tests.find((t) => t.id === 't1'));
  console.log(`        ${reps.map((r) => r.status).join(', ')} em ${repMs} ms`);
  await check('roda 3 vezes e todas passam', async () => {
    assert.deepEqual(reps.map((r) => `${r.iter}:${r.status}`), ['1:passed', '2:passed', '3:passed']);
    assert.deepEqual(t1.lastBatch && [t1.lastBatch.passed, t1.lastBatch.ran], [3, 3]);
  });
  await check('respeita o intervalo de 1s entre repetições', async () => assert.ok(repMs >= 2000, `${repMs} ms`));
  await check('histórico marca a repetição (3/3, 2/3, 1/3)', async () => {
    assert.deepEqual(t1.runs.slice(0, 3).map((r) => `${r.iter}/${r.of}`), ['3/3', '2/3', '1/3']);
  });

  console.log('Painel');
  const panel = await context.newPage();
  const panelErrors = [];
  panel.on('pageerror', (e) => panelErrors.push(e.message));
  panel.on('console', (m) => m.type() === 'error' && panelErrors.push(m.text()));
  await panel.setViewportSize({ width: 400, height: 860 });
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  await panel.waitForSelector('.card');
  await panel.screenshot({ path: path.join(outDir, 'painel-lista.png') });
  await panel.click('.card >> nth=0');
  await panel.waitForSelector('.steps');
  await panel.screenshot({ path: path.join(outDir, 'painel-teste.png'), fullPage: true });
  await panel.click('[data-action="edit-step"] >> nth=1');
  await panel.waitForSelector('dialog[open]');
  await panel.screenshot({ path: path.join(outDir, 'painel-editar.png') });
  await panel.click('[data-dlg="cancel"]');
  await panel.click('[data-action="back"]');
  await panel.click('.card >> nth=1');
  await panel.waitForSelector('.banner.failed');
  await panel.screenshot({ path: path.join(outDir, 'painel-falha.png'), fullPage: true });
  await panel.click('[data-action="back"]');
  await panel.click('.card:has-text("Login com senha errada")');
  await panel.waitForSelector('.banner.failed .diag');
  await panel.screenshot({ path: path.join(outDir, 'painel-falha-magento.png'), fullPage: true });
  await panel.click('[data-action="back"]');
  await panel.click('.card:has-text("Login e telefone")');
  await panel.waitForSelector('.repeat-row');
  await panel.screenshot({ path: path.join(outDir, 'painel-repeticao.png') });
  await panel.click('[data-action="back"]');
  await panel.click('[data-view="settings"]');
  await panel.screenshot({ path: path.join(outDir, 'painel-config.png') });
  await check('painel renderiza lista, passos, edição, falha, repetição e config sem erros', async () => assert.deepEqual(panelErrors, []));

  const report = await panel.evaluate(async () => {
    const { toReportHtml, toSummaryText } = await import('../lib/report.js');
    const { tests } = await chrome.storage.local.get('tests');
    const t = tests.find((x) => x.id === 't3');
    const shot = (await chrome.storage.local.get('shot:t3'))['shot:t3'];
    return { html: toReportHtml(t, t.lastRun, shot), text: toSummaryText(t, t.lastRun) };
  });
  fs.writeFileSync(path.join(outDir, 'relatorio.html'), report.html);
  fs.writeFileSync(path.join(outDir, 'resumo.txt'), report.text);
  const rp = await context.newPage();
  await rp.setContent(report.html);
  await rp.screenshot({ path: path.join(outDir, 'relatorio.png'), fullPage: true });
  await rp.close();
  await check('relatório traz mensagem do Magento, erros e print', async () => {
    assert.match(report.html, /O login ou a senha estão incorretos/);
    assert.match(report.html, /404 GET/);
    assert.match(report.html, /data:image\/jpeg/);
    assert.match(report.text, /Falhou no passo 5/);
  });

  console.log('Diagnóstico com IA local (TensorFlow.js)');
  const ai = await panel.evaluate(async () => {
    const { diagnose, ensureModel, learn, failureOf, resetModel, backend } = await import('../lib/diagnosis.js');
    await resetModel();
    const t0 = performance.now();
    await ensureModel();
    const trainMs = Math.round(performance.now() - t0);
    const http = (s, u) => ({ kind: 'http', text: `${s} GET ${u}` });
    const cases = [
      ['business', { stepType: 'assertUrl', stepLabel: '', error: 'URL atual "https://loja.test/customer/account/login/" não contém "/customer/account/index".', messages: ['El acceso fue incorrecto o tu cuenta está desactivada temporalmente. Intenta más tarde.'], logs: [] }],
      ['validation', { stepType: 'assertUrl', error: 'URL atual "https://loja.test/customer/account/login/" não contém "/customer/account/index".', messages: ['Email: Este campo es un campo obligatorio.', 'Contraseña: Este campo es un campo obligatorio.'], logs: [] }],
      ['captcha', { stepType: 'assertText', error: 'Elemento não encontrado: título', messages: ['CAPTCHA incorrecto'], logs: [] }],
      ['content', { stepType: 'assertText', error: 'Texto "Texto que não existe" não encontrado. O elemento contém: "Entrar"', messages: [], logs: [] }],
      ['selector', { stepType: 'click', stepLabel: 'Finalizar pedido', error: 'Elemento não encontrado: Finalizar pedido', messages: [], logs: [{ kind: 'net', text: 'net::ERR_BLOCKED_BY_ORB GET https://www.googletagmanager.com/gtag/js' }] }],
      ['session', { stepType: 'click', stepLabel: 'Entrar', error: 'Elemento não encontrado: Entrar', messages: [], logs: [], loggedIn: true }],
      ['server', { stepType: 'assertText', error: 'Texto "Pedido" não encontrado. O elemento contém: "Erro"', messages: [], logs: [http(500, 'https://loja.test/rest/V1/guest-carts/x/payment-information')] }],
      ['duplicate', { stepType: 'assertUrl', error: 'URL atual "https://loja.test/customer/account/create/" não contém "/customer/account/".', messages: ['Ya existe una cuenta con esta dirección de correo electrónico.'], logs: [] }],
      ['jserror', { stepType: 'click', stepLabel: 'Continuar', error: 'Elemento não encontrado: Continuar', messages: [], logs: [{ kind: 'js', text: "Uncaught TypeError: Cannot read properties of null (reading 'shippingAddress') (shipping.js:88)" }] }],
      ['timeout', { stepType: 'click', error: 'A página continuou carregando (loader visível) até o tempo limite.', messages: [], logs: [] }],
      ['navigation', { stepType: 'assertUrl', error: 'URL atual "https://loja.test/checkout/cart/" não contém "/checkout/onepage/success".', messages: [], logs: [] }],
      ['config', { stepType: 'navigate', error: 'Variável {{baseUrl}} não definida. Cadastre em Variáveis.', messages: [], logs: [] }],
    ];
    const results = [];
    for (const [expected, failure] of cases) {
      const r = await diagnose(failure);
      results.push({ expected, got: r.key, p: Math.round(r.confidence * 100) });
    }
    // Falha real gravada pela extensão (login com senha errada no site de teste).
    const { tests } = await chrome.storage.local.get('tests');
    const t3 = tests.find((t) => t.id === 't3');
    const real = await diagnose(failureOf(t3, t3.lastRun));
    // Aprendizado: o QA diz que um caso ambíguo é "content" e o modelo passa a responder isso.
    const odd = { stepType: 'assertVisible', stepLabel: 'selo frete', error: 'Elemento não encontrado: selo frete grátis', messages: [], logs: [] };
    const before = (await diagnose(odd)).key;
    for (let i = 0; i < 3; i++) await learn(odd, 'content');
    const after = (await diagnose(odd)).key;
    return { trainMs, backend: backend(), results, real: { key: real.key, p: Math.round(real.confidence * 100) }, before, after };
  });
  const hits = ai.results.filter((r) => r.expected === r.got).length;
  console.log(`        treino inicial: ${ai.trainMs} ms (${ai.backend}); acertos: ${hits}/${ai.results.length}`);
  for (const r of ai.results) console.log(`          ${r.expected === r.got ? 'ok ' : 'ERR'} esperado ${r.expected.padEnd(10)} -> ${r.got} (${r.p}%)`);
  console.log(`        falha real (senha errada): ${ai.real.key} (${ai.real.p}%); aprendizado: ${ai.before} -> ${ai.after}`);
  await check('modelo acerta pelo menos 10 de 12 casos realistas', async () => assert.ok(hits >= 10, `${hits}/12`));
  await check('falha real de senha errada é classificada como recusa da loja', async () => assert.equal(ai.real.key, 'business'));
  await check('aprende com a correção do QA', async () => assert.equal(ai.after, 'content'));

  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  await panel.click('.card:has-text("Login com senha errada")');
  await panel.waitForSelector('.ai .ai-title');
  await panel.screenshot({ path: path.join(outDir, 'painel-ia.png'), fullPage: true });
  await panel.click('[data-action="back"]');
  await panel.click('.card:has-text("Seletores antigos")');
  await panel.waitForSelector('.step-healed');
  await panel.screenshot({ path: path.join(outDir, 'painel-autocorrecao.png'), fullPage: true });
  await panel.click('[data-action="apply-heal"] >> nth=0');
  await panel.waitForTimeout(400);
  const applied = await sw.evaluate(async () => (await chrome.storage.local.get('tests')).tests.find((t) => t.id === 't4').steps[1].selectors.map((x) => x.css || x.text));
  await check('"Aplicar correção" põe o seletor achado em primeiro e mantém o antigo', async () => {
    assert.equal(applied[0], '#email');
    assert.ok(applied.includes('#email-antigo'));
  });
  await panel.click('[data-action="back"]');
  await panel.click('[data-view="settings"]');
  await panel.click('input[data-setting="aiDiagnosis"]');
  await panel.waitForTimeout(300);
  await panel.screenshot({ path: path.join(outDir, 'painel-config-ia.png'), fullPage: true });
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  await panel.click('.card:has-text("Login com senha errada")');
  await panel.waitForSelector('.banner.failed');
  const aiShown = await panel.locator('.ai').count();
  await check('com a IA desligada nas Configurações, o diagnóstico não aparece', async () => assert.equal(aiShown, 0));
  await check('painel sem erros de JS com a IA (CSP/TensorFlow)', async () => assert.deepEqual(panelErrors, []));

  console.log('Atualização');
  const upd = await panel.evaluate(async (url) => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...(settings || {}), updateUrl: url } });
    return chrome.runtime.sendMessage({ type: 'update:check' });
  }, `${base}/version-test.json`);
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  const pill = await panel.locator('.update-pill').textContent().catch(() => '');
  await panel.click('.update-pill');
  await panel.waitForSelector('dialog[open] .update-steps');
  await panel.screenshot({ path: path.join(outDir, 'painel-atualizacao.png') });
  await panel.click('[data-dlg="cancel"]');
  await check('verifica atualização e mostra o aviso de versão nova', async () => {
    assert.equal(upd.available, true);
    assert.equal(upd.latest, '9.9.9');
    assert.match(pill, /Nova versão 9\.9\.9/);
  });

  console.log('Compartilhar');
  await panel.goto(`chrome-extension://${extId}/sidepanel/index.html`);
  await panel.click('.card:has-text("Login com senha errada")');
  await panel.click('[data-action="share"]');
  await panel.waitForSelector('dialog[open] .share-opt');
  await panel.screenshot({ path: path.join(outDir, 'painel-compartilhar.png') });
  await panel.click('[data-dlg="cancel"]');
  const share = await panel.evaluate(async () => {
    const { encodeShare, decodeShare } = await import('../lib/share.js');
    const { toDevJSON } = await import('../lib/exporters.js');
    const { tests, vars } = await chrome.storage.local.get(['tests', 'vars']);
    const t1 = tests.find((t) => t.id === 't1');
    const code = await encodeShare(t1);
    const back = await decodeShare(`olha esse teste: ${code} valeu`);
    const dev = JSON.parse(toDevJSON(tests.find((t) => t.id === 't3'), vars));
    return { len: code.length, rawLen: JSON.stringify(t1.steps).length, same: JSON.stringify(back.steps) === JSON.stringify(t1.steps.map(({ mergeKey, ...s }) => s)), repeat: back.repeat, dev };
  });
  fs.writeFileSync(path.join(outDir, 'para-dev.json'), JSON.stringify(share.dev, null, 2));
  console.log(`        código: ${share.len} caracteres (JSON cru: ${share.rawLen})`);
  await check('código de compartilhamento ida e volta mantém os passos', async () => {
    assert.ok(share.same);
    assert.equal(share.repeat, 3);
  });
  await check('JSON para o dev traz passo que falhou, mensagem e erros', async () => {
    assert.equal(share.dev.result.failedStep.number, 5);
    assert.deepEqual(share.dev.result.pageMessages, ['O login ou a senha estão incorretos.']);
    assert.ok(share.dev.result.capturedErrors.some((e) => e.kind === 'http'));
    assert.equal(share.dev.tests[0].steps.length, 5);
  });

  console.log('Backup');
  const backup = await panel.evaluate(async () => {
    const res = await chrome.runtime.sendMessage({ type: 'backup:now' });
    const state = (await chrome.storage.local.get('backupState')).backupState;
    const { buildBackup, restoreBackup } = await import('../lib/backup.js');
    const data = await buildBackup();
    const before = (await chrome.storage.local.get('tests')).tests.length;
    await chrome.storage.local.set({ tests: [] });
    const restored = await restoreBackup(JSON.parse(JSON.stringify(data)));
    const after = (await chrome.storage.local.get('tests')).tests;
    return { res, before, restored, after: after.length, runs: after.find((t) => t.id === 't1').runs.length, senha: data.vars.find((v) => v.key === 'senha').value, state };
  });
  console.log(`        ${JSON.stringify({ arquivo: backup.res.filename, bytes: backup.res.size, restaurados: backup.restored })}`);
  await check('backup salva arquivo em Downloads/panda-qa-recorder', async () => {
    assert.match(backup.res.filename, /^panda-qa-recorder\/backup-\d{4}-\d{2}-\d{2}\.json$/);
    assert.ok(backup.state.lastAt > 0 && backup.state.dirty === false);
  });
  await check('restaurar recupera todos os testes com histórico', async () => {
    assert.equal(backup.after, backup.before);
    assert.ok(backup.runs >= 4);
  });
  await check('senha não vai no backup', async () => assert.equal(backup.senha, ''));
  const fullBackup = await panel.evaluate(async () => {
    const { buildFullBackup, restoreFullBackup } = await import('../lib/backup.js');
    const { settings = {} } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, clickupToken: 'pk_backup-secreto', teamKey: 'chave-backup-secreta' } });
    const secret = (await chrome.storage.local.get('vars')).vars.find((v) => v.key === 'senha')?.value;
    const data = await buildFullBackup('senha segura do backup');
    const text = JSON.stringify(data);
    await chrome.storage.local.set({ tests: [], vars: [], settings: { clickupToken: '', teamKey: '' } });
    let wrongPasswordRejected = false;
    try {
      await restoreFullBackup(data, 'senha errada');
    } catch (error) {
      wrongPasswordRejected = /Confira a senha/.test(error.message);
    }
    const restored = await restoreFullBackup(data, 'senha segura do backup');
    const saved = await chrome.storage.local.get(['tests', 'vars', 'settings']);
    return {
      encrypted: !text.includes('pk_backup-secreto') && !text.includes('chave-backup-secreta') && (!secret || !text.includes(secret)),
      wrongPasswordRejected,
      restored,
      tests: saved.tests.length,
      clickupToken: saved.settings.clickupToken,
      teamKey: saved.settings.teamKey,
      secret: saved.vars.find((v) => v.key === 'senha')?.value,
    };
  });
  await check('backup completo protege chaves e restaura tarefas, variáveis e configurações', async () => {
    assert.ok(fullBackup.encrypted);
    assert.ok(fullBackup.wrongPasswordRejected);
    assert.equal(fullBackup.tests, backup.before);
    assert.equal(fullBackup.clickupToken, 'pk_backup-secreto');
    assert.equal(fullBackup.teamKey, 'chave-backup-secreta');
    assert.equal(fullBackup.secret, 'Senha123');
  });

  const md = await panel.evaluate(async () => {
    const { toMarkdown, toPlaywright } = await import('../lib/exporters.js');
    const { tests, vars } = await chrome.storage.local.get(['tests', 'vars']);
    return { md: toMarkdown(tests.find((t) => t.id === 't1')), pw: toPlaywright(tests.find((t) => t.id === 't1'), vars) };
  });
  fs.writeFileSync(path.join(outDir, 'lista-de-passos.md'), md.md);
  fs.writeFileSync(path.join(outDir, 'login.spec.ts'), md.pw);
  await check('exporta lista de passos e Playwright', async () => {
    assert.match(md.md, /^# Login e telefone/);
    assert.match(md.pw, /page\.goto\(`\$\{vars\["baseUrl"\]\}\/login\.html`\)/);
  });
} finally {
  await context.close();
  server.close();
}

console.log(failures ? `\n${failures} verificação(ões) falharam.` : '\nTudo certo.');
process.exit(failures ? 1 : 0);
