/**
 * Panda QA Recorder - service worker.
 * Recebe os passos gravados pelo content script e conduz o replay aba a aba.
 */
import { getTest, updateTest, getVars, saveVars, getSettings, uid } from './lib/store.js';
import { newRunContext, resolveStep } from './lib/vars.js';
import { buildBackup } from './lib/backup.js';
import { failureOf } from './lib/diagnosis.js';
import { siteAlias, fluxoDe, sparseVector } from './lib/anon.js';
import { queueSignal, flushSignals } from './lib/team.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Escritas em sequência: os passos chegam rápido e cada um é um read-modify-write.
let queue = Promise.resolve();
function enqueue(fn) {
  const next = queue.then(fn);
  queue = next.catch((e) => console.error(e));
  return next;
}

async function getSession(key) {
  return (await chrome.storage.session.get(key))[key] ?? null;
}

const setSession = (key, value) => chrome.storage.session.set({ [key]: value });

// ---------- Gravação ----------

async function toBaseUrl(url) {
  const base = (await getVars()).find((v) => v.key === 'baseUrl')?.value?.replace(/\/+$/, '');
  return base && url.startsWith(base) ? '{{baseUrl}}' + url.slice(base.length) : url;
}

async function appendStep(testId, step, mergeKey) {
  if (step.secret !== undefined) {
    // Cada tecla manda o valor parcial; a variável fica com o último (a senha completa).
    const vars = await getVars();
    let senha = vars.find((v) => v.key === 'senha');
    if (!senha) vars.push(senha = { key: 'senha', value: '', secret: true });
    if (senha.value !== step.secret) {
      senha.value = step.secret;
      await saveVars(vars);
    }
    delete step.secret;
  }
  await updateTest(testId, (test) => {
    const last = test.steps[test.steps.length - 1];
    if (mergeKey && last && last.mergeKey === mergeKey) {
      test.steps[test.steps.length - 1] = { ...last, ...step };
    } else {
      test.steps.push({ id: uid(), ...step, ...(mergeKey ? { mergeKey } : {}) });
    }
  });
}

async function startRecording({ testId, tabId }) {
  const run = await getSession('run');
  if (run && run.status === 'running') throw new Error('Pare a execução antes de gravar.');
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/.test(tab.url || '')) throw new Error('Abra a página da loja (http/https) nesta aba antes de gravar.');

  await setSession('rec', { testId, tabId });
  const test = await getTest(testId);
  await enqueue(() => updateTest(testId, (t) => {
    if (!t.site) t.site = new URL(tab.url).origin;
    if (!t.qaSince) t.qaSince = Date.now();
  }));
  if (!test.steps.length) {
    await enqueue(async () => appendStep(testId, { type: 'navigate', url: await toBaseUrl(tab.url) }));
  }
  await ensureContent(tabId);
  await chrome.tabs.sendMessage(tabId, { type: 'rec:on' }, { frameId: 0 });
}

async function stopRecording() {
  const rec = await getSession('rec');
  await setSession('rec', null);
  if (rec) chrome.tabs.sendMessage(rec.tabId, { type: 'rec:off' }, { frameId: 0 }).catch(() => {});
}

async function startPick({ testId, tabId }) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:/.test(tab.url || '')) throw new Error('Abra a página da loja nesta aba para escolher o elemento.');
  await setSession('pick', { testId, tabId });
  await ensureContent(tabId);
  await chrome.tabs.sendMessage(tabId, { type: 'pick:on' }, { frameId: 0 });
}

// Digitar na barra de endereço durante a gravação vira um passo "Abrir URL".
chrome.webNavigation.onCommitted.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const rec = await getSession('rec');
  if (!rec || rec.tabId !== details.tabId) return;
  const typed = ['typed', 'auto_bookmark', 'generated'].includes(details.transitionType)
    || details.transitionQualifiers.includes('from_address_bar');
  if (!typed) return;
  enqueue(async () => appendStep(rec.testId, { type: 'navigate', url: await toBaseUrl(details.url) }));
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const rec = await getSession('rec');
  if (rec && rec.tabId === tabId) await setSession('rec', null);
});

// ---------- Execução ----------

let abortRequested = false;

async function waitForLoad(tabId, timeout = 45000) {
  const end = Date.now() + timeout;
  for (;;) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return tab;
    if (Date.now() > end) throw new Error('A página não terminou de carregar no tempo limite.');
    await sleep(150);
  }
}

async function ensureContent(tabId) {
  for (let i = 0; i < 4; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'ping' }, { frameId: 0 });
      if (res && res.pong) return;
    } catch {
      // ainda não injetado (aba aberta antes da instalação) ou página trocando
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    } catch {
      // página restrita ou em navegação; tenta de novo
    }
    await sleep(250);
  }
  throw new Error('Não foi possível conectar à página (chrome://, loja do Chrome e PDFs não são suportados).');
}

async function execInPage(tabId, step, settings) {
  const timeout = Number(step.timeout) || settings.timeout;
  const end = Date.now() + timeout + 10000;
  for (;;) {
    await waitForLoad(tabId);
    await ensureContent(tabId);
    try {
      const res = await chrome.tabs.sendMessage(
        tabId,
        { type: 'exec', step, timeout, loaderSelector: settings.loaderSelector, autoHeal: settings.autoHeal },
        { frameId: 0 },
      );
      if (!res) throw new Error('port');
      if (!res.ok) throw Object.assign(new Error(res.error), { fromPage: true });
      return res;
    } catch (e) {
      // Página navegou enquanto esperava o elemento: tenta de novo na página nova.
      if (e.fromPage || Date.now() > end) throw e.fromPage ? e : new Error('A página não respondeu (navegou ou travou).');
      await sleep(300);
    }
  }
}

async function execStep(tabId, step, settings) {
  switch (step.type) {
    case 'navigate':
      await chrome.tabs.update(tabId, { url: step.url });
      await sleep(300);
      await waitForLoad(tabId);
      return;
    case 'wait':
      await sleep(Number(step.value) || 1000);
      return;
    case 'assertUrl': {
      const timeout = Number(step.timeout) || settings.timeout;
      const end = Date.now() + timeout;
      for (;;) {
        const tab = await chrome.tabs.get(tabId);
        if ((tab.pendingUrl || tab.url || '').includes(step.value) && tab.status === 'complete') return;
        if (Date.now() > end) throw new Error(`URL atual "${tab.url}" não contém "${step.value}".`);
        await sleep(150);
      }
    }
    default: {
      const res = await execInPage(tabId, step, settings);
      await sleep(settings.stepDelay);
      await waitForLoad(tabId);
      return res;
    }
  }
}

async function screenshot(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
  } catch {
    return null;
  }
}

// ---------- Logs da execução (erros de JS, requisições com erro) ----------

const MAX_LOGS = 100;
let active = null;

function pushLog(tabId, entry) {
  if (!active || active.tabId !== tabId || active.run.index < 0) return;
  const logs = active.run.logs;
  const last = logs[logs.length - 1];
  if (last && last.text === entry.text && last.step === active.run.index) {
    last.count = (last.count || 1) + 1;
    return;
  }
  if (logs.length >= MAX_LOGS) return;
  logs.push({ step: active.run.index, at: Date.now(), ...entry });
}

const LOGGED_TYPES = ['main_frame', 'sub_frame', 'xmlhttprequest', 'script'];

chrome.webRequest.onCompleted.addListener((d) => {
  if (d.statusCode < 400) return;
  pushLog(d.tabId, { kind: 'http', text: `${d.statusCode} ${d.method} ${d.url}`.slice(0, 400) });
}, { urls: ['<all_urls>'], types: LOGGED_TYPES });

chrome.webRequest.onErrorOccurred.addListener((d) => {
  // ERR_ABORTED é a requisição cancelada por uma navegação; não é falha.
  if (d.error === 'net::ERR_ABORTED') return;
  pushLog(d.tabId, { kind: 'net', text: `${d.error} ${d.method} ${d.url}`.slice(0, 400) });
}, { urls: ['<all_urls>'], types: LOGGED_TYPES });

async function diagnose(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'diagnose' }, { frameId: 0 });
  } catch {
    try {
      const tab = await chrome.tabs.get(tabId);
      return { messages: [], url: tab.url, title: tab.title };
    } catch {
      return null;
    }
  }
}

/**
 * Apaga cookies e dados (localStorage, IndexedDB, cache) só do site do teste, para cada
 * execução começar deslogada e sem carrinho, independente do que foi feito antes.
 */
async function cleanSiteData(test, tabId, ctx) {
  let url = null;
  const first = test.steps.find((s) => !s.disabled);
  if (first && first.type === 'navigate') {
    try {
      url = resolveStep(first, ctx).url;
    } catch {
      url = null;
    }
  }
  if (!url) url = (await chrome.tabs.get(tabId)).url;
  let origin;
  try {
    origin = new URL(url).origin;
  } catch {
    return;
  }
  if (!/^https?:/.test(origin)) return;
  await chrome.browsingData.remove(
    { origins: [origin] },
    { cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true },
  );
}

async function runTest(testId, tabId, startIndex = 0, job = null) {
  const test = await getTest(testId);
  if (!test) throw new Error('Teste não encontrado.');
  const settings = await getSettings();
  const ctx = newRunContext(await getVars());
  const results = test.steps.map((s, i) => ({ status: s.disabled || i < startIndex ? 'skipped' : 'pending' }));
  const run = { testId, status: 'running', index: -1, results, logs: [], startedAt: Date.now(), vars: { $email: ctx.$email }, iter: job?.iter || 1, of: job?.of || 1 };
  active = { tabId, run };
  await setSession('run', run);
  if (test.cleanSession !== false) await cleanSiteData(test, tabId, ctx);

  let error = null;
  let failedIndex = -1;
  for (let i = startIndex; i < test.steps.length; i++) {
    const step = test.steps[i];
    if (step.disabled) continue;
    if (abortRequested) break;
    run.index = i;
    results[i] = { status: 'running' };
    await setSession('run', run);
    const t0 = Date.now();
    try {
      const res = await execStep(tabId, resolveStep(step, ctx), settings);
      results[i] = res && res.healed
        ? { status: 'healed', ms: Date.now() - t0, healed: res.healed }
        : { status: 'passed', ms: Date.now() - t0 };
    } catch (e) {
      results[i] = { status: step.optional ? 'warning' : 'failed', ms: Date.now() - t0, error: e.message };
      if (!step.optional) {
        error = e.message;
        failedIndex = i;
        break;
      }
    }
    await setSession('run', run);
  }

  if (error) {
    // Espera um pouco: a mensagem de erro do Magento costuma chegar via AJAX logo depois.
    await sleep(500);
    run.diagnostics = await diagnose(tabId);
  }
  active = null;
  chrome.tabs.sendMessage(tabId, { type: 'run:off' }, { frameId: 0 }).catch(() => {});

  run.status = abortRequested ? 'stopped' : error ? 'failed' : 'passed';
  run.finishedAt = Date.now();
  run.index = failedIndex;
  run.error = error;
  // O print fica até o próximo lote, mesmo que repetições seguintes passem.
  if (run.status === 'failed') {
    const shot = await screenshot(tabId);
    if (shot) await chrome.storage.local.set({ ['shot:' + testId]: shot });
  }
  await setSession('run', run);
  await enqueue(() => updateTest(testId, (t) => {
    t.lastRun = {
      status: run.status, at: run.finishedAt, ms: run.finishedAt - run.startedAt, failedIndex, error, results,
      logs: run.logs, diagnostics: run.diagnostics || null, email: ctx.$email, iter: run.iter, of: run.of,
    };
    if (run.status === 'failed') t.lastFailure = t.lastRun;
    t.runs = [
      { status: run.status, at: run.finishedAt, ms: run.finishedAt - run.startedAt, error, iter: run.iter, of: run.of },
      ...(t.runs || []),
    ].slice(0, 50);
    // Relógio da sessão de QA para lançar horas no ClickUp: começa na primeira execução ou gravação.
    if (!t.qaSince) t.qaSince = run.startedAt;
  }));
  if (run.status !== 'stopped') await radarSignal(testId, tabId, run).catch((e) => console.warn('radar', e));
  return run.status;
}

// Sinal do radar das lojas: só apelido do site, trecho da URL, resultado e o vetor de números da falha.
async function radarSignal(testId, tabId, run) {
  const test = await getTest(testId);
  let url = run.diagnostics?.url;
  if (!url) url = await chrome.tabs.get(tabId).then((t) => t.url, () => null);
  const origin = test.site || (url && /^https?:/.test(url) ? new URL(url).origin : null);
  if (!origin) return;
  const signal = { s: siteAlias(origin), f: fluxoDe(url || origin), t: siteAlias(testId), st: run.status, ms: run.finishedAt - run.startedAt, at: run.finishedAt };
  if (run.status === 'failed') signal.v = sparseVector(failureOf(test, test.lastRun));
  await queueSignal(signal);
}

async function abortableSleep(ms) {
  const end = Date.now() + ms;
  let ping = Date.now();
  while (Date.now() < end && !abortRequested) {
    await sleep(Math.min(250, end - Date.now()));
    // Chamada de API a cada 10s: sem isso o Chrome encerra o service worker ocioso (~30s).
    if (Date.now() - ping > 10000) {
      ping = Date.now();
      await chrome.runtime.getPlatformInfo();
    }
  }
}

async function runTests({ testIds, tabId, startIndex, repeat, interval }) {
  const running = await getSession('run');
  if (running && running.status === 'running') throw new Error('Já existe uma execução em andamento.');
  if (await getSession('rec')) throw new Error('Pare a gravação antes de executar.');
  abortRequested = false;
  await chrome.tabs.update(tabId, { active: true });

  // Cada teste roda "repeat" vezes (do pedido ou o configurado no próprio teste).
  const jobs = [];
  for (const testId of testIds) {
    const test = await getTest(testId);
    if (!test) continue;
    const times = Math.min(Math.max(Number(repeat || test.repeat) || 1, 1), 500);
    const waitMs = Math.max(Number(interval ?? test.interval) || 0, 0) * 1000;
    for (let k = 1; k <= times; k++) jobs.push({ testId, iter: k, of: times, waitMs });
  }
  const batch = { jobs, done: [], startedAt: Date.now() };
  await setSession('suite', jobs.length > 1 ? batch : null);
  for (const testId of testIds) {
    await chrome.storage.local.remove('shot:' + testId);
    await enqueue(() => updateTest(testId, (t) => {
      delete t.lastFailure;
      t.lastBatch = null;
    }).catch(() => {}));
  }

  for (const [n, job] of jobs.entries()) {
    if (abortRequested) break;
    // Intervalo só entre repetições do mesmo teste.
    if (n > 0 && job.iter > 1 && job.waitMs) {
      batch.nextAt = Date.now() + job.waitMs;
      await setSession('suite', batch);
      await abortableSleep(job.waitMs);
      batch.nextAt = null;
      if (abortRequested) break;
    }
    let status;
    try {
      status = await runTest(job.testId, tabId, jobs.length === 1 ? startIndex || 0 : 0, job);
    } catch (e) {
      status = 'failed';
      await setSession('run', { testId: job.testId, status: 'failed', error: e.message, results: [], index: -1 });
    }
    batch.done.push({ testId: job.testId, iter: job.iter, status });
    if (jobs.length > 1) await setSession('suite', batch);
  }

  for (const testId of testIds) {
    const mine = batch.done.filter((d) => d.testId === testId);
    if (mine.length < 2) continue;
    await enqueue(() => updateTest(testId, (t) => {
      t.lastBatch = {
        total: jobs.filter((j) => j.testId === testId).length,
        ran: mine.length,
        passed: mine.filter((d) => d.status === 'passed').length,
        at: Date.now(),
      };
    }));
  }
  return batch.done;
}

// ---------- Backup automático em Downloads/panda-qa-recorder ----------

const BACKUP_DIR = 'panda-qa-recorder';

async function backupState() {
  return (await chrome.storage.local.get('backupState')).backupState || { dirty: false, lastAt: 0 };
}

async function writeBackup() {
  const data = JSON.stringify(await buildBackup(), null, 1);
  // Service worker não tem URL.createObjectURL; data URL em base64 (UTF-8) resolve.
  const bytes = new TextEncoder().encode(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const day = new Date().toLocaleDateString('sv-SE');
  const filename = `${BACKUP_DIR}/backup-${day}.json`;
  const id = await chrome.downloads.download({
    url: 'data:application/json;base64,' + btoa(bin),
    filename,
    conflictAction: 'overwrite',
    saveAs: false,
  });
  pendingBackupDownloads.add(id);
  await chrome.storage.local.set({ backupState: { dirty: false, lastAt: Date.now(), lastFile: filename, size: bytes.length } });
  return { filename, size: bytes.length };
}

// Tira o backup da lista de downloads do Chrome (o arquivo continua no disco).
const pendingBackupDownloads = new Set();
chrome.downloads.onChanged.addListener((d) => {
  if (!pendingBackupDownloads.has(d.id) || !d.state || d.state.current === 'in_progress') return;
  pendingBackupDownloads.delete(d.id);
  if (d.state.current === 'complete') chrome.downloads.erase({ id: d.id });
});

async function maybeBackup() {
  const { backupHours } = await getSettings();
  if (!Number(backupHours)) return;
  const st = await backupState();
  if (!st.dirty || Date.now() - st.lastAt < backupHours * 3600 * 1000) return;
  if (active) return; // não atrapalha uma execução em andamento
  await writeBackup();
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.tests) return;
  const st = await backupState();
  if (!st.dirty) await chrome.storage.local.set({ backupState: { ...st, dirty: true } });
  clearTimeout(maybeBackup.t);
  maybeBackup.t = setTimeout(() => maybeBackup().catch(console.error), 5000);
});

chrome.alarms.create('backup', { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'backup') maybeBackup().catch(console.error);
});

// ---------- Atualização ----------

function newerThan(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

/**
 * Consulta o version.json publicado. A extensão instalada pela pasta não consegue trocar
 * os próprios arquivos; aqui só avisamos e passamos o link do zip novo.
 */
async function checkUpdate() {
  const { updateUrl } = await getSettings();
  const current = chrome.runtime.getManifest().version;
  const info = { current, checkedAt: Date.now(), available: false };
  try {
    if (!updateUrl) throw new Error('Endereço de atualização não configurado.');
    // Parâmetro único por consulta: o raw.githubusercontent.com guarda a resposta por 5 min.
    const bust = `${updateUrl}${updateUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
    const res = await fetch(bust, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    Object.assign(info, { latest: data.version, notes: data.notes || '', download: data.download || '', available: newerThan(data.version, current) });
  } catch (e) {
    info.error = `Não foi possível verificar (${e.message}). Confira a internet e se o repositório é público.`;
  }
  await chrome.storage.local.set({ updateInfo: info });
  return info;
}

chrome.alarms.create('update', { periodInMinutes: 720 });
chrome.alarms.create('radar', { periodInMinutes: 2 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'radar') flushSignals().catch(() => {});
});
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'update') checkUpdate().catch(console.error);
});
chrome.runtime.onStartup.addListener(() => checkUpdate().catch(console.error));
chrome.runtime.onInstalled.addListener(() => checkUpdate().catch(console.error));

// ---------- Mensagens ----------

const handlers = {
  async hello(_msg, sender) {
    const rec = await getSession('rec');
    return {
      recording: Boolean(rec && sender.tab && rec.tabId === sender.tab.id && sender.frameId === 0),
      running: Boolean(active && sender.tab && active.tabId === sender.tab.id),
    };
  },
  pagelog(msg, sender) {
    if (sender.tab) pushLog(sender.tab.id, { kind: msg.kind, text: String(msg.text).slice(0, 500) });
    return { ok: true };
  },
  async step(msg, sender) {
    const rec = await getSession('rec');
    if (!rec || !sender.tab || rec.tabId !== sender.tab.id) return { ok: false };
    await enqueue(() => appendStep(rec.testId, msg.step, msg.mergeKey));
    return { ok: true };
  },
  async picked(msg, sender) {
    const pick = await getSession('pick');
    if (!pick || !sender.tab || pick.tabId !== sender.tab.id) return { ok: false };
    await setSession('pick', null);
    await enqueue(() => appendStep(pick.testId, msg.step));
    return { ok: true };
  },
  'rec:start': (msg) => startRecording(msg),
  'rec:stop': () => stopRecording(),
  'pick:start': (msg) => startPick(msg),
  'run:start': (msg) => {
    // Não espera terminar: o painel acompanha pelo storage.session.
    runTests(msg).catch((e) => setSession('run', { status: 'failed', error: e.message, results: [], index: -1 }));
    return { ok: true };
  },
  'run:stop': async () => {
    abortRequested = true;
    return { ok: true };
  },
  'backup:now': () => writeBackup(),
  'radar:flush': () => flushSignals(),
  'update:check': () => checkUpdate(),
  'ext:reload': () => {
    setTimeout(() => chrome.runtime.reload(), 100);
    return { ok: true };
  },
  async highlight(msg) {
    await ensureContent(msg.tabId);
    return chrome.tabs.sendMessage(msg.tabId, { type: 'highlight', step: msg.step }, { frameId: 0 });
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg && msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then((res) => sendResponse(res ?? { ok: true }), (e) => sendResponse({ error: e.message }));
  return true;
});

// Exposto para os testes automatizados da própria extensão.
self.qa = { runTests, startRecording, stopRecording, startPick };
