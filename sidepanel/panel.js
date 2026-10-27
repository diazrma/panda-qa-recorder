/**
 * Panda QA Recorder - painel lateral: biblioteca de testes, editor de passos, variáveis e configurações.
 */
import {
  getTests, saveTests, updateTest, createTest, deleteTest, getVars, saveVars, getSettings, saveSettings, uid,
} from '../lib/store.js';
import { STEP_TYPES, describeStep, selectorToString, parseSelector, isAssert } from '../lib/steps.js';
import { toJSON, toDevJSON, toMarkdown, toPlaywright, parseImport } from '../lib/exporters.js';
import { encodeShare, decodeShare } from '../lib/share.js';
import { CATEGORIES, diagnose, learn, failureOf, learnedCount } from '../lib/diagnosis.js';
import { BUILTINS } from '../lib/vars.js';
import { toReportHtml, toSummaryText, LOG_KIND } from '../lib/report.js';
import { isBackup, restoreBackup } from '../lib/backup.js';
import { parseTaskRef, getTask, searchTasks, logTime, comment, attach, setStatus, taskTimes, fmtDuration } from '../lib/clickup.js';
import { syncTeam, pushContribution, teamConfig, uploadReport } from '../lib/team.js';

const ICON = {
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3.2v9.6a.6.6 0 0 0 .9.5l7.4-4.8a.6.6 0 0 0 0-1L5.9 2.7a.6.6 0 0 0-.9.5z"/></svg>',
  stop: '<svg viewBox="0 0 16 16" fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1.5"/></svg>',
  plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></svg>',
  more: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3.5" cy="8" r="1.3"/><circle cx="8" cy="8" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/></svg>',
  back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 3 5 8l5 5"/></svg>',
  edit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M10.5 2.5l3 3L6 13H3v-3z"/></svg>',
  trash: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg>',
  eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
  eyeOff: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M2 2l12 12M6.6 6.6a2 2 0 0 0 2.8 2.8M4.2 4.7C2.5 5.9 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.3 0 2.4-.4 3.4-1M7 3.6c.3 0 .7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.5 1-1.5 2"/></svg>',
  grip: '<svg viewBox="0 0 16 16" fill="currentColor" style="width:12px"><circle cx="5" cy="4" r="1.1"/><circle cx="11" cy="4" r="1.1"/><circle cx="5" cy="8" r="1.1"/><circle cx="11" cy="8" r="1.1"/><circle cx="5" cy="12" r="1.1"/><circle cx="11" cy="12" r="1.1"/></svg>',
  gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="2.2"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/></svg>',
  braces: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5.5 2.5C4 2.5 4 3.5 4 5s-.5 3-1.5 3C3.5 8 4 9.5 4 11s0 2.5 1.5 2.5M10.5 2.5C12 2.5 12 3.5 12 5s.5 3 1.5 3c-1 0-1.5 1.5-1.5 3s0 2.5-1.5 2.5"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  target: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="2"/></svg>',
  download: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/></svg>',
  share: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="3.5" r="1.8"/><circle cx="4" cy="8" r="1.8"/><circle cx="12" cy="12.5" r="1.8"/><path d="M5.6 7.1l4.8-2.7M5.6 8.9l4.8 2.7"/></svg>',
  upload: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 10.5v-8M4.5 6 8 2.5 11.5 6M3 13.5h10"/></svg>',
  copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3 10.5V3.5A1 1 0 0 1 4 2.5h6.5"/></svg>',
};

const STATUS_LABEL = { passed: 'Passou', failed: 'Falhou', running: 'Executando', stopped: 'Interrompido', warning: 'Aviso' };

const app = document.getElementById('app');
const dlg = document.getElementById('dlg');
const menuEl = document.getElementById('menu');
const toastEl = document.getElementById('toast');
const fileInput = document.getElementById('file-import');

const state = {
  view: 'list',
  testId: null,
  filter: '',
  tests: [],
  vars: [],
  settings: {},
  rec: null,
  run: null,
  suite: null,
  pick: null,
  shot: null,
  backup: null,
  update: null,
  site: '',
  siteOpen: false,
  sites: {},
  team: {},
  cu: {},
  cuSearch: null,
};

// ---------- utilitários ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function ago(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return new Date(ts).toLocaleDateString('pt-BR');
}

const secs = (ms) => `${(ms / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}s`;

function toast(text, isError = false) {
  toastEl.textContent = text;
  toastEl.className = 'toast' + (isError ? ' error' : '');
  toastEl.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { toastEl.hidden = true; }, isError ? 6000 : 2500);
}

async function send(type, payload = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...payload });
  // Sem resposta: o service worker é de uma versão anterior (comum depois de trocar os
  // arquivos da pasta sem recarregar a extensão) ou não subiu.
  if (res === undefined) throw new Error('A extensão não respondeu. Abra Configurações e clique em "Recarregar extensão".');
  if (res && res.error) throw new Error(res.error);
  return res;
}

// Recarrega direto pelo painel: funciona mesmo quando o service worker ainda é o antigo.
const reloadExtension = () => chrome.runtime.reload();

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) throw new Error('Nenhuma aba ativa.');
  return tab.id;
}

function download(name, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'teste';

const currentTest = () => state.tests.find((t) => t.id === state.testId) || null;
const isRunning = () => state.run && state.run.status === 'running';
const isBusy = () => Boolean(state.rec) || isRunning();

// ---------- sites ----------

const NO_SITE = '-';

// Testes antigos não guardam o site: vem da primeira URL gravada ou, se ela usa {{baseUrl}}, da variável.
function siteOf(test) {
  if (test.site) return test.site;
  const url = test.steps.find((s) => s.type === 'navigate')?.url || '';
  const base = state.vars.find((v) => v.key === 'baseUrl')?.value || '';
  const raw = url.startsWith('{{baseUrl}}') ? base : url;
  try {
    const o = new URL(raw).origin;
    return /^https?:/.test(o) ? o : NO_SITE;
  } catch {
    return NO_SITE;
  }
}

const siteHost = (origin) => origin.replace(/^https?:\/\//, '');
const siteLabel = (origin) => (origin === NO_SITE ? 'Sem site' : state.sites[origin]?.label || siteHost(origin));
const SITE_COLORS = ['#e11d48', '#0ea5e9', '#16a34a', '#a855f7', '#f59e0b', '#14b8a6', '#6366f1', '#db2777'];

function siteFav(origin) {
  if (!origin) return '<span class="fav" style="background:#64748b">✱</span>';
  if (origin === NO_SITE) return '<span class="fav" style="background:#a1a1aa">?</span>';
  let h = 0;
  for (const c of origin) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `<span class="fav" style="background:${SITE_COLORS[h % SITE_COLORS.length]}">${esc(siteLabel(origin).trim()[0]?.toUpperCase() || 'S')}</span>`;
}

function knownSites() {
  const counts = new Map(Object.keys(state.sites).map((o) => [o, 0]));
  for (const t of state.tests) {
    const o = siteOf(t);
    counts.set(o, (counts.get(o) || 0) + 1);
  }
  return [...counts].filter(([o, n]) => o !== NO_SITE || n)
    .sort((a, b) => (a[0] === NO_SITE) - (b[0] === NO_SITE) || siteLabel(a[0]).localeCompare(siteLabel(b[0])));
}

const visibleTests = () => state.tests.filter((t) => !state.site || siteOf(t) === state.site);

async function setSite(site) {
  state.site = site;
  state.siteOpen = false;
  const { ui = {} } = await chrome.storage.local.get('ui');
  await chrome.storage.local.set({ ui: { ...ui, site } });
  render();
}

// ---------- previsão de instabilidade ----------

/** Teste que alterna entre passar e falhar nas últimas execuções: falha provavelmente intermitente. */
function flakiness(test) {
  const runs = (test.runs || []).filter((r) => r.status === 'passed' || r.status === 'failed').slice(0, 10);
  if (runs.length < 4) return null;
  const failed = runs.filter((r) => r.status === 'failed').length;
  let flips = 0;
  for (let i = 1; i < runs.length; i++) if (runs[i].status !== runs[i - 1].status) flips++;
  if (!failed || failed === runs.length || flips < 2) return null;
  return { failed, total: runs.length, pct: Math.round((failed / runs.length) * 100) };
}

// ---------- carga e render ----------

async function load() {
  state.tests = await getTests();
  state.vars = await getVars();
  state.settings = await getSettings();
  state.backup = (await chrome.storage.local.get('backupState')).backupState || null;
  state.update = (await chrome.storage.local.get('updateInfo')).updateInfo || null;
  const extra = await chrome.storage.local.get(['sites', 'ui', 'teamModel', 'teamCheck', 'teamSent']);
  state.sites = extra.sites || {};
  state.site = extra.ui?.site ?? '';
  state.team = { model: extra.teamModel || null, check: extra.teamCheck || null, sent: extra.teamSent || null };
  const s = await chrome.storage.session.get(['rec', 'run', 'suite', 'pick']);
  state.rec = s.rec ?? null;
  state.run = s.run ?? null;
  state.suite = s.suite ?? null;
  state.pick = s.pick ?? null;
  if (state.testId) {
    const key = 'shot:' + state.testId;
    state.shot = (await chrome.storage.local.get(key))[key] || null;
    if (!currentTest()) state.view = 'list';
  }
  render();
}

let loadTimer;
chrome.storage.onChanged.addListener(() => {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(load, 40);
});

function render() {
  const active = document.activeElement;
  const focus = active && active.id && app.contains(active)
    ? { id: active.id, start: active.selectionStart, end: active.selectionEnd }
    : null;

  const views = { list: renderList, test: renderTest, vars: renderVars, settings: renderSettings };
  app.innerHTML = (views[state.view] || renderList)();

  if (focus) {
    const el = document.getElementById(focus.id);
    if (el) {
      el.focus();
      if (focus.start != null && el.setSelectionRange) el.setSelectionRange(focus.start, focus.end);
    }
  }
}

function statusBadge(status, extra = '') {
  if (!status) return '<span class="badge">Nunca executado</span>';
  const icon = status === 'passed' ? ICON.check : status === 'failed' ? ICON.x : '';
  return `<span class="badge ${status}">${icon}${STATUS_LABEL[status] || status}${extra}</span>`;
}

function renderList() {
  const f = state.filter.toLowerCase();
  const inSite = visibleTests();
  const tests = inSite.filter((t) => !f || t.name.toLowerCase().includes(f));
  const runningId = isRunning() ? state.run.testId : null;

  const cards = tests.map((t) => {
    const last = runningId === t.id ? { status: 'running' } : t.lastRun;
    const fl = flakiness(t);
    const meta = [
      `${t.steps.length} passo${t.steps.length === 1 ? '' : 's'}`,
      statusBadge(last?.status),
      t.lastBatch && t.lastBatch.ran > 1 ? `${t.lastBatch.passed}/${t.lastBatch.ran} passaram` : '',
      last?.at ? `${ago(last.at)} · ${secs(last.ms)}` : '',
      t.repeat > 1 ? `× ${t.repeat}` : '',
      fl ? `<span class="badge warning" title="Alterna entre passar e falhar">Instável · ${fl.failed}/${fl.total}</span>` : '',
      !state.site && siteOf(t) !== NO_SITE ? `<span class="site-tag">${esc(siteLabel(siteOf(t)))}</span>` : '',
    ].filter(Boolean).join(' · ');
    return `
      <li class="card" data-action="open" data-id="${t.id}">
        <div class="card-main">
          <div class="card-title">${esc(t.name)}</div>
          <div class="card-meta">${meta}</div>
        </div>
        <button class="icon run" data-action="run" data-id="${t.id}" title="Executar" ${isBusy() ? 'disabled' : ''}>${ICON.play}</button>
        <button class="icon" data-action="menu-test" data-id="${t.id}" title="Mais opções">${ICON.more}</button>
      </li>`;
  }).join('');

  return `
    <header class="top">
      <div class="brand"><img src="../icons/icon32.png" alt="">Panda QA Recorder</div>
      ${state.update?.available ? `<button class="btn small update-pill" data-action="update-show">Nova versão ${esc(state.update.latest)}</button>` : ''}
      <div class="top-actions">
        <button class="icon" data-action="view" data-view="vars" title="Variáveis">${ICON.braces}</button>
        <button class="icon" data-action="view" data-view="settings" title="Configurações">${ICON.gear}</button>
        <button class="icon" data-action="menu-list" title="Importar / exportar">${ICON.more}</button>
      </div>
    </header>
    <div class="toolbar">
      <button class="btn primary" data-action="new" ${isBusy() ? 'disabled' : ''}><span class="dot" style="width:8px;height:8px;border-radius:50%;background:currentColor"></span>Gravar novo teste</button>
      ${isRunning()
        ? `<button class="btn" data-action="run-stop">${ICON.stop}Parar execução</button>`
        : `<button class="btn" data-action="run-all" ${!inSite.length || isBusy() ? 'disabled' : ''}>${ICON.play}Executar todos${state.site ? ` (${inSite.length})` : ''}</button>`}
    </div>
    ${renderSuiteBanner()}
    ${state.tests.length || Object.keys(state.sites).length ? renderSitePicker() : ''}
    ${state.tests.length ? `<input id="filter" class="search" placeholder="Buscar teste…" value="${esc(state.filter)}">` : ''}
    ${state.tests.length
      ? `<ul class="tests">${cards || `<li class="empty">${inSite.length ? 'Nenhum teste com esse nome.' : 'Nenhum teste neste site ainda. Abra a loja na aba e clique em <b>Gravar novo teste</b>.'}</li>`}</ul>`
      : `<div class="empty"><strong>Nenhum teste gravado ainda</strong>Abra a página da loja nesta aba e clique em <b>Gravar novo teste</b>. Faça o fluxo (login, cadastro, checkout) normalmente; cada ação vira um passo da lista.</div>`}
  `;
}

function renderSitePicker() {
  const cur = state.site;
  const sub = (o) => (o && o !== NO_SITE && siteLabel(o) !== siteHost(o) ? siteHost(o) : '');
  const opt = (origin, n) => `
    <button class="site-opt ${cur === origin ? 'sel' : ''}" data-action="site-pick" data-site="${esc(origin)}">
      ${siteFav(origin)}<span class="site-name">${esc(origin ? siteLabel(origin) : 'Todos os sites')}${sub(origin) ? `<small>${esc(sub(origin))}</small>` : ''}</span>
      <span class="site-n">${n}</span>
    </button>`;
  return `
    <div class="sitebar">
      <button class="site-btn ${state.siteOpen ? 'open' : ''}" data-action="site-toggle" title="Escolher o site">
        ${siteFav(cur)}<span class="site-name">${esc(cur ? siteLabel(cur) : 'Todos os sites')}</span>
        ${sub(cur) ? `<span class="site-tag">${esc(sub(cur))}</span>` : ''}
        <span class="caret">▾</span>
      </button>
      ${state.siteOpen ? `
      <div class="site-dd">
        ${opt('', state.tests.length)}
        <hr>
        ${knownSites().map(([o, n]) => opt(o, n)).join('')}
        <hr>
        <button class="site-opt add" data-action="site-current">${ICON.plus}Usar o site da aba atual</button>
        ${cur && cur !== NO_SITE ? `<button class="site-opt add" data-action="site-rename">${ICON.edit}Renomear "${esc(siteLabel(cur))}"</button>` : ''}
      </div>` : ''}
    </div>`;
}

function suiteProgress(testId) {
  const suite = state.suite;
  if (!suite || !suite.jobs) return null;
  const jobs = testId ? suite.jobs.filter((j) => j.testId === testId) : suite.jobs;
  const done = testId ? suite.done.filter((d) => d.testId === testId) : suite.done;
  if (jobs.length < 2) return null;
  return {
    total: jobs.length,
    done: done.length,
    passed: done.filter((d) => d.status === 'passed').length,
    failed: done.filter((d) => d.status !== 'passed').length,
    nextIn: suite.nextAt ? Math.max(0, Math.ceil((suite.nextAt - Date.now()) / 1000)) : null,
    finished: !isRunning() && !suite.nextAt && done.length >= jobs.length,
  };
}

function countdown(p) {
  return p.nextIn != null ? `<div class="banner-text">Próxima repetição em ${p.nextIn}s</div>` : '';
}

function renderSuiteBanner() {
  const p = suiteProgress(null);
  if (!p) return '';
  if (p.finished || (!isRunning() && !state.suite.nextAt)) {
    return `<div class="banner ${p.failed ? 'failed' : 'passed'}"><div class="banner-title">${p.failed
      ? `${p.failed} de ${p.done} execuções falharam`
      : `Todas as ${p.done} execuções passaram`}</div></div>`;
  }
  return `
    <div class="banner running">
      <div class="banner-title">Executando ${p.done + 1} de ${p.total} · ${p.passed} passaram${p.failed ? ` · ${p.failed} falharam` : ''}</div>
      ${countdown(p)}
      <div class="progress"><div style="width:${(p.done / p.total) * 100}%"></div></div>
    </div>`;
}

function shownRun(test) {
  if (state.run && state.run.testId === test.id && state.run.results?.length) return state.run;
  return test.lastRun || null;
}

function stepStatus(test, i) {
  return shownRun(test)?.results?.[i] || null;
}

function stepLogs(test, i) {
  return (shownRun(test)?.logs || []).filter((l) => l.step === i);
}

function logText(l) {
  return `${LOG_KIND[l.kind] || l.kind}: ${l.text}${l.count > 1 ? ` (${l.count}x)` : ''}`;
}

// ---------- diagnóstico local (TensorFlow.js) ----------

const aiCache = new Map();
let learnedTotal = 0;

const runKey = (test, run) => `${test.id}:${run.at || run.finishedAt}:${learnedTotal}`;

async function diagFor(test, run) {
  if (state.settings.aiDiagnosis === false) return null;
  const key = runKey(test, run);
  const cached = aiCache.get(key);
  if (cached && cached !== 'loading' && !cached.error) return cached;
  const res = await diagnose(failureOf(test, run));
  aiCache.set(key, res);
  return res;
}

function aiBox(test, run, which) {
  const key = runKey(test, run);
  const res = aiCache.get(key);
  if (!res) {
    aiCache.set(key, 'loading');
    diagnose(failureOf(test, run)).then(
      (r) => { aiCache.set(key, r); render(); },
      (e) => { aiCache.set(key, { error: e.message }); render(); },
    );
  }
  if (!res || res === 'loading') {
    return '<div class="ai"><div class="ai-head">Diagnóstico (IA local)</div><div class="ai-text">Analisando a falha…</div></div>';
  }
  if (res.error) return `<div class="ai"><div class="ai-head">Diagnóstico (IA local)</div><div class="ai-text">Não foi possível analisar: ${esc(res.error)}</div></div>`;
  const pct = Math.round(res.confidence * 100);
  const unsure = res.confidence < 0.5;
  const alt = res.top.slice(1).filter((t) => t.p > 0.15).map((t) => CATEGORIES.find((c) => c.key === t.key).label);
  const origin = { teste: 'Ajustar o teste', site: 'Problema no site', ambiente: 'Ambiente' }[res.origin];
  return `
    <div class="ai">
      <div class="ai-head">Diagnóstico (IA local)<span class="badge ai-${res.origin}">${origin}</span><span class="ai-conf" title="Confiança do modelo">${pct}%</span></div>
      <div class="ai-title">${unsure ? 'Talvez: ' : ''}${esc(res.label)}</div>
      ${alt.length ? `<div class="ai-text small">Outras possibilidades: ${esc(alt.join(', '))}</div>` : ''}
      <div class="ai-text">${esc(res.explain)}</div>
      <div class="ai-fix"><b>O que fazer:</b> ${esc(res.fix)}</div>
      <div class="ai-actions">
        <button class="btn small ghost" data-action="ai-ok" data-which="${which}" data-cat="${res.key}">${ICON.check}Está certo</button>
        <button class="btn small ghost" data-action="ai-fix" data-which="${which}">${ICON.edit}Corrigir</button>
      </div>
    </div>`;
}

function failureDetails(run, withShot) {
  const messages = run.diagnostics?.messages || [];
  const logs = run.logs || [];
  const test = currentTest();
  const which = run === test?.lastFailure ? 'failure' : 'last';
  return `
    <div class="banner-text">${esc(run.error || '')}</div>
    ${test && run.error && state.settings.aiDiagnosis !== false ? aiBox(test, run, which) : ''}
    ${messages.length ? `<div class="diag"><div class="diag-title">Mensagens na página</div><ul>${messages.map((m) => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
    ${logs.length ? `<div class="diag"><div class="diag-title">Erros capturados (${logs.length})</div><ul class="mono">${logs.slice(0, 6).map((l) => `<li>Passo ${l.step + 1} · ${esc(logText(l))}</li>`).join('')}${logs.length > 6 ? `<li>e mais ${logs.length - 6}…</li>` : ''}</ul></div>` : ''}
    ${run.diagnostics?.url ? `<div class="banner-text small">Página: ${esc(run.diagnostics.url)}</div>` : ''}
    ${withShot && state.shot ? `<img class="shot" src="${state.shot}" alt="Tela no momento da falha" data-action="shot">` : ''}
    <div class="banner-actions">
      <button class="btn small" data-action="report" data-which="${run === currentTest()?.lastFailure ? 'failure' : 'last'}">${ICON.download}Baixar relatório</button>
      <button class="btn small ghost" data-action="copy-summary" data-which="${run === currentTest()?.lastFailure ? 'failure' : 'last'}">${ICON.copy}Copiar resumo</button>
      ${teamOn() ? `<button class="btn small ghost" data-action="report-link" data-which="${run === currentTest()?.lastFailure ? 'failure' : 'last'}">${ICON.share}Copiar link do relatório</button>` : ''}
    </div>`;
}

const teamOn = () => Boolean(state.settings.teamServer && state.settings.teamKey);

async function reportLink(test, run) {
  const diag = run.error ? await diagFor(test, run).catch(() => null) : null;
  return uploadReport(test, run, run.status === 'failed' ? state.shot : null, diag);
}

function renderBanner(test) {
  if (state.rec && state.rec.testId === test.id) {
    return `<div class="banner rec"><div class="banner-title"><span class="pulse"></span>Gravando</div>
      <div class="banner-text">Faça o fluxo na página. Cada clique e campo preenchido vira um passo. Use <b>+ Verificação</b> para conferir textos na tela.</div></div>`;
  }
  if (state.pick && state.pick.testId === test.id) {
    return `<div class="banner running"><div class="banner-title">${ICON.target}Escolha o elemento</div>
      <div class="banner-text">Clique na página no texto ou elemento que deve aparecer. Esc cancela.</div></div>`;
  }
  const run = state.run && state.run.testId === test.id ? state.run : null;
  const p = suiteProgress(test.id);
  const waiting = p && p.nextIn != null;
  if ((run && run.status === 'running') || waiting) {
    const total = test.steps.filter((s) => !s.disabled).length || 1;
    const done = run && run.status === 'running' ? run.results.filter((r) => ['passed', 'warning', 'healed'].includes(r.status)).length : 0;
    const rep = p ? `<div class="banner-text">Repetição ${Math.min(p.done + 1, p.total)} de ${p.total} · ${p.passed} passaram${p.failed ? ` · ${p.failed} falharam` : ''}</div>` : '';
    return `<div class="banner running"><div class="banner-title">${waiting ? 'Aguardando intervalo' : `Executando passo ${run.index + 1} de ${test.steps.length}`}</div>
      ${rep}${p ? countdown(p) : ''}
      ${waiting ? '' : `<div class="progress"><div style="width:${(done / total) * 100}%"></div></div>`}</div>`;
  }

  const batch = test.lastBatch;
  if (batch && batch.ran > 1) {
    const ok = batch.passed === batch.ran;
    const fail = test.lastFailure;
    return `<div class="banner ${ok ? 'passed' : 'failed'}">
      <div class="banner-title">${ok ? ICON.check : ICON.x}${batch.passed} de ${batch.ran} execuções passaram${batch.ran < batch.total ? ` (interrompido, ${batch.total} previstas)` : ''}</div>
      ${fail ? `<div class="banner-text"><b>Última falha:</b> repetição ${fail.iter} no passo ${fail.failedIndex + 1}</div>${failureDetails(fail, true)}` : ''}
    </div>`;
  }

  const last = run || test.lastRun;
  if (!last || !last.status) return '';
  const ms = last.finishedAt ? last.finishedAt - last.startedAt : last.ms;
  if (last.status === 'passed') {
    const healedCount = (last.results || []).filter((r) => r.status === 'healed').length;
    return `<div class="banner passed"><div class="banner-title">${ICON.check}Passou${ms ? ` em ${secs(ms)}` : ''}</div>
      ${healedCount ? `<div class="banner-text">${healedCount} passo(s) passaram com auto-correção de seletor. Confira e aplique a correção nos passos marcados em amarelo.</div>` : ''}
      ${last.logs?.length ? `<div class="banner-text">Passou, mas com ${last.logs.length} erro(s) capturado(s) na página. Veja nos passos.</div>` : ''}</div>`;
  }
  if (last.status === 'stopped') {
    return `<div class="banner stopped"><div class="banner-title">Execução interrompida</div></div>`;
  }
  const idx = last.failedIndex ?? last.index;
  return `<div class="banner failed"><div class="banner-title">${ICON.x}Falhou${idx >= 0 ? ` no passo ${idx + 1}` : ''}</div>
    ${failureDetails(test.lastRun && test.lastRun.status === 'failed' ? test.lastRun : last, true)}</div>`;
}

function renderTest() {
  const test = currentTest();
  if (!test) return renderList();
  const recThis = state.rec && state.rec.testId === test.id;
  const runThis = isRunning() && state.run.testId === test.id;
  const busy = isBusy();

  const steps = test.steps.map((step, i) => {
    const st = stepStatus(test, i);
    const cls = ['step', step.disabled && 'disabled', st && st.status].filter(Boolean).join(' ');
    const sel = step.selectors?.[0] ? selectorToString(step.selectors[0]) : step.type === 'navigate' ? '' : '';
    const kind = STEP_TYPES[step.type]?.label || step.type;
    return `
      <li class="${cls}" draggable="${!busy}" data-index="${i}">
        <span class="grip">${ICON.grip}</span>
        <span class="num">${i + 1}</span>
        <div class="step-body">
          <div class="step-desc">${esc(describeStep(step))}</div>
          <div class="step-sub"><span class="kind ${isAssert(step) ? 'assert' : ''}">${esc(kind)}</span>${sel ? `<code title="${esc(sel)}">${esc(sel)}</code>` : ''}${step.optional ? '<span class="kind">opcional</span>' : ''}${st && st.ms != null ? `<span>${secs(st.ms)}</span>` : ''}</div>
          ${st && st.error ? `<div class="step-error">${esc(st.error)}</div>` : ''}
          ${st && st.healed ? `<div class="step-healed">Seletor não encontrado: a auto-correção achou "${esc(st.healed.text || selectorToString(st.healed.selectors[0] || {}))}" e seguiu.
            <button class="btn small" data-action="apply-heal" data-index="${i}">${ICON.check}Aplicar correção</button></div>` : ''}
          ${stepLogs(test, i).slice(0, 3).map((l) => `<div class="step-log" title="${esc(l.text)}">${esc(logText(l))}</div>`).join('')}
        </div>
        <div class="step-actions">
          <button class="icon" data-action="run-from" data-index="${i}" title="Executar a partir deste passo">${ICON.play}</button>
          <button class="icon" data-action="edit-step" data-index="${i}" title="Editar">${ICON.edit}</button>
          <button class="icon" data-action="toggle-step" data-index="${i}" title="${step.disabled ? 'Ativar' : 'Desativar'}">${step.disabled ? ICON.eyeOff : ICON.eye}</button>
          <button class="icon" data-action="delete-step" data-index="${i}" title="Excluir">${ICON.trash}</button>
        </div>
      </li>`;
  }).join('');

  const runs = (test.runs || []).map((r) => `<li>${statusBadge(r.status)}<span>${new Date(r.at).toLocaleString('pt-BR')}</span><span>${secs(r.ms)}</span>${r.of > 1 ? `<span>${r.iter}/${r.of}</span>` : ''}</li>`).join('');

  return `
    <header class="top">
      <button class="icon" data-action="back" title="Voltar">${ICON.back}</button>
      <input id="test-name" class="title-input" value="${esc(test.name)}" aria-label="Nome do teste">
      <button class="icon" data-action="menu-test" data-id="${test.id}" title="Mais opções">${ICON.more}</button>
    </header>
    <div class="toolbar">
      ${recThis
        ? `<button class="btn danger" data-action="rec-stop">${ICON.stop}Parar gravação</button>`
        : `<button class="btn rec" data-action="rec-start" ${busy ? 'disabled' : ''}><span class="dot"></span>${test.steps.length ? 'Continuar gravando' : 'Gravar'}</button>`}
      ${runThis
        ? `<button class="btn" data-action="run-stop">${ICON.stop}Parar</button>`
        : `<button class="btn primary" data-action="run" data-id="${test.id}" ${busy || !test.steps.length ? 'disabled' : ''}>${ICON.play}Executar</button>`}
      <button class="btn" data-action="pick" ${runThis ? 'disabled' : ''} title="Clique num elemento da página para verificar que ele aparece">${ICON.target}Verificação</button>
      <button class="btn ghost" data-action="menu-add" ${runThis ? 'disabled' : ''}>${ICON.plus}Passo</button>
      <button class="btn ghost" data-action="share" ${!test.steps.length ? 'disabled' : ''}>${ICON.share}Compartilhar</button>
    </div>
    <div class="repeat-row">
      <label>Repetir <input id="repeat" type="number" min="1" max="500" value="${test.repeat || 1}" ${busy ? 'disabled' : ''}> vez(es)</label>
      <label>intervalo <input id="interval" type="number" min="0" max="86400" value="${test.interval || 0}" ${busy ? 'disabled' : ''}> s</label>
      <label title="Antes de cada execução, apaga cookies e dados só deste site: começa deslogado e com carrinho vazio"><input id="clean-session" type="checkbox" ${test.cleanSession !== false ? 'checked' : ''} ${busy ? 'disabled' : ''}> Começar com sessão limpa</label>
    </div>
    <div class="test-site">
      <label>Site <select id="test-site" ${busy ? 'disabled' : ''}>
        ${knownSites().map(([o]) => `<option value="${esc(o)}" ${siteOf(test) === o ? 'selected' : ''}>${esc(siteLabel(o))}</option>`).join('')}
        ${siteOf(test) === NO_SITE ? '' : `<option value="${NO_SITE}">Sem site</option>`}
      </select></label>
    </div>
    ${renderForecast(test)}
    ${renderBanner(test)}
    ${renderClickUp(test)}
    <div class="section-title"><span>Passos (${test.steps.length})</span></div>
    ${test.steps.length
      ? `<ol class="steps ${busy ? 'locked' : ''}">${steps}</ol>`
      : `<div class="empty"><strong>Sem passos</strong>Clique em <b>Gravar</b> e faça o fluxo na página.</div>`}
    ${runs ? `<details class="history"><summary>Histórico de execuções (${test.runs.length})</summary><ul class="history-list">${runs}</ul></details>` : ''}
  `;
}

function renderForecast(test) {
  const fl = flakiness(test);
  if (!fl || isBusy()) return '';
  return `<div class="banner stopped"><div class="banner-title">Teste instável: falhou ${fl.failed} das últimas ${fl.total} execuções</div>
    <div class="banner-text">Ele alterna entre passar e falhar. Chance de falhar na próxima: cerca de ${fl.pct}%. Se falhar, rode de novo antes de abrir bug e veja se o diagnóstico aponta lentidão ou sessão.</div></div>`;
}

// ---------- ClickUp ----------

const cuLogo = () => '<span class="cu-logo">C</span>';

function qaElapsed(test) {
  return test.qaSince ? Math.min(Date.now() - test.qaSince, 8 * 3600e3) : 0;
}

function renderClickUp(test) {
  if (!state.settings.clickupToken) {
    return test.steps.length ? `<div class="cu cu-off">${cuLogo()}<span>Lançar as horas deste teste numa tarefa do ClickUp</span><button class="btn small ghost" data-action="view" data-view="settings">Configurar</button></div>` : '';
  }
  const task = test.clickup;
  if (!task) {
    const search = state.cuSearch?.testId === test.id ? state.cuSearch : null;
    return `<div class="cu">
      <div class="cu-head">${cuLogo()}Lançar horas no ClickUp</div>
      <label>Pesquisar tarefa no ClickUp</label>
      <div class="cu-link"><input id="cu-search" value="${esc(search?.query || '')}" placeholder="Nome ou ID da tarefa"><button class="btn small primary" data-action="cu-search" ${search?.loading ? 'disabled' : ''}>${search?.loading ? 'Buscando…' : 'Pesquisar'}</button></div>
      ${search?.error ? `<div class="banner-text small">${esc(search.error)}</div>` : ''}
      ${search?.results?.length ? `<div class="cu-results">${search.results.map((result, index) => `<button class="cu-result" data-action="cu-pick" data-index="${index}"><span class="cu-status" style="background:${esc(result.color || '#64748b')}">${esc(result.status || '?')}</span><span class="cu-name"><b>${esc(result.name)}</b><small>${esc(result.list || '')}</small></span></button>`).join('')}</div>` : ''}
      ${search && !search.loading && !search.error && !search.results.length ? '<div class="banner-text small">Nenhuma tarefa encontrada.</div>' : ''}
      <div class="cu-manual"><span>Ou vincule pelo link/ID</span><div class="cu-link"><input id="cu-ref" placeholder="Ex.: https://app.clickup.com/t/86ajthyru"><button class="btn small" data-action="cu-link">Vincular</button></div></div>
    </div>`;
  }
  const info = state.cu[task.id];
  if (!info) loadTaskTimes(test);
  const last = test.lastBatch && test.lastBatch.ran > 1
    ? `${test.lastBatch.ran} execuções, ${test.lastBatch.passed} passaram`
    : test.lastRun ? ({ passed: 'passou', failed: `falhou no passo ${test.lastRun.failedIndex + 1}` }[test.lastRun.status] || 'interrompido') : 'sem execução';
  const minutes = Math.max(1, Math.round(qaElapsed(test) / 60000));
  const desc = `QA: ${test.name} (${siteLabel(siteOf(test))}), ${last}.`;
  const passed = test.lastRun?.status === 'passed';
  const done = state.settings.clickupDoneStatus;
  return `<div class="cu">
    <div class="cu-head">${cuLogo()}Lançar horas no ClickUp</div>
    <div class="cu-task">
      <span class="cu-status" style="background:${esc(task.color || '#64748b')}">${esc(task.status || '?')}</span>
      <div class="cu-name"><a href="${esc(task.url)}" target="_blank">${esc(task.name)}</a><small>${esc(task.list || '')}</small></div>
      <button class="icon" data-action="cu-unlink" title="Trocar tarefa">${ICON.x}</button>
    </div>
    <label class="cu-status-picker">Status da tarefa
      <select id="cu-task-status" ${task.statuses?.length ? '' : 'disabled'}>
        ${task.statuses?.length
          ? [...new Map([...task.statuses, { status: task.status, color: task.color }].filter((s) => s.status).map((s) => [s.status, s])).values()]
            .map((s) => `<option value="${esc(s.status)}" ${s.status === task.status ? 'selected' : ''}>${esc(s.status)}</option>`).join('')
          : `<option>${esc(task.status || 'Status indisponível')}</option>`}
      </select>
    </label>
    <div class="cu-row">
      <label>Início<input value="${test.qaSince ? new Date(test.qaSince).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'agora'}" disabled></label>
      <label>Duração (min)<input id="cu-min" type="number" min="1" max="720" value="${minutes}"></label>
    </div>
    <textarea id="cu-desc" rows="2">${esc(desc)}</textarea>
    <label class="check"><input type="checkbox" id="cu-comment" checked><span>Comentar na tarefa com o resumo${test.lastRun ? (teamOn() ? ' e o link do relatório' : ' e anexar o relatório HTML') : ''}</span></label>
    ${done ? `<label class="check"><input type="checkbox" id="cu-status" ${passed ? '' : 'disabled'}><span>Mover para "${esc(done)}"${passed ? '' : ' (só quando o teste passa)'}</span></label>` : ''}
    <div class="banner-actions"><button class="btn small primary" data-action="cu-launch">Lançar horas</button>
      ${test.qaSince ? '<button class="btn small ghost" data-action="cu-reset" title="Recomeça a contar a sessão de QA agora">Zerar relógio</button>' : ''}</div>
    ${info?.times?.length ? `<div class="cu-hist"><b>Já lançado nesta tarefa</b>${info.times.map((t) => `<div><span>${esc(new Date(t.start).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }))} · ${esc(t.user)}</span><span>${fmtDuration(t.ms)}</span></div>`).join('')}</div>` : ''}
    ${info?.error ? `<div class="banner-text small">${esc(info.error)}</div>` : ''}
  </div>`;
}

function loadTaskTimes(test) {
  const id = test.clickup.id;
  state.cu[id] = { loading: true };
  taskTimes(state.settings.clickupToken, id).then(
    (times) => { state.cu[id] = { times }; render(); },
    (e) => { state.cu[id] = { error: e.message }; render(); },
  );
}

function renderVars() {
  const rows = state.vars.map((v, i) => `
    <tr>
      <td class="key"><input type="text" id="var-key-${i}" data-var="key" data-index="${i}" value="${esc(v.key)}" placeholder="nome"></td>
      <td><input type="${v.secret ? 'password' : 'text'}" id="var-val-${i}" data-var="value" data-index="${i}" value="${esc(v.value)}" placeholder="valor"></td>
      <td class="chk"><input type="checkbox" data-var="secret" data-index="${i}" ${v.secret ? 'checked' : ''} title="Valor secreto (não vai no export)"></td>
      <td class="chk"><button class="icon" data-action="var-del" data-index="${i}" title="Excluir">${ICON.trash}</button></td>
    </tr>`).join('');
  return `
    <header class="top">
      <button class="icon" data-action="back" title="Voltar">${ICON.back}</button>
      <div class="brand">Variáveis</div>
    </header>
    <div class="pane">
      <p class="help">Use <span class="chip">{{nome}}</span> em URLs e valores dos passos. A senha digitada na gravação vira <span class="chip">{{senha}}</span> e o valor fica só aqui, fora do teste exportado. Com <span class="chip">baseUrl</span> preenchida, o mesmo teste roda em local, staging ou produção.</p>
      <table class="vars">
        <thead><tr><th>Nome</th><th>Valor</th><th title="Secreto">🔒</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="toolbar" style="padding:8px 0"><button class="btn" data-action="var-add">${ICON.plus}Adicionar variável</button></div>
      <div class="section-title" style="padding:8px 0 0">Geradas a cada execução</div>
      <ul class="builtins">${BUILTINS.map((b) => `<li><code>{{${b.key}}}</code> ${esc(b.help)}</li>`).join('')}</ul>
      <p class="help" style="margin-top:10px">Dica: no cadastro, troque o e-mail gravado por <span class="chip">{{$email}}</span> para não dar "e-mail já cadastrado" na próxima execução. O domínio sai da variável <span class="chip">emailDomain</span> (padrão example.com).</p>
    </div>`;
}

function renderSettings() {
  const s = state.settings;
  return `
    <header class="top">
      <button class="icon" data-action="back" title="Voltar">${ICON.back}</button>
      <div class="brand">Configurações</div>
    </header>
    <div class="pane settings">
      <label>Tempo limite por passo (ms)
        <input type="number" id="set-timeout" data-setting="timeout" min="1000" step="500" value="${s.timeout}">
        <small>Quanto esperar um elemento aparecer antes de falhar.</small></label>
      <label>Pausa entre passos (ms)
        <input type="number" id="set-delay" data-setting="stepDelay" min="0" step="50" value="${s.stepDelay}">
        <small>Aumente se a loja for lenta para reagir aos cliques.</small></label>
      <label>Seletor de carregamento
        <input type="text" id="set-loader" data-setting="loaderSelector" value="${esc(s.loaderSelector)}">
        <small>Enquanto algum desses elementos estiver visível, o passo espera. O padrão cobre o loader do Magento.</small></label>
      <div class="section-title" style="padding:8px 0 0">Atualização</div>
      <div class="banner-text">Versão instalada: <b>${esc(chrome.runtime.getManifest().version)}</b>${state.update?.checkedAt ? ` · verificado em ${new Date(state.update.checkedAt).toLocaleString('pt-BR')}` : ''}${state.update?.available ? ` · <b>nova versão ${esc(state.update.latest)} disponível</b>` : state.update && !state.update.error ? ' · você está na versão mais recente' : ''}${state.update?.error ? `<br>${esc(state.update.error)}` : ''}</div>
      <div class="banner-actions" style="margin-top:0">
        <button class="btn small" data-action="update-check">${ICON.download}Verificar atualização</button>
        ${state.update?.available ? `<button class="btn small primary" data-action="update-show">Como atualizar</button>` : ''}
        <button class="btn small ghost" data-action="ext-reload" title="Use depois de trocar os arquivos da pasta">Recarregar extensão</button>
      </div>
      <div class="section-title" style="padding:8px 0 0">Inteligência</div>
      <label class="check"><input type="checkbox" data-setting="aiDiagnosis" ${s.aiDiagnosis !== false ? 'checked' : ''}>
        <span>Diagnóstico com IA local<br><small>Quando um teste falha, um modelo TensorFlow que roda dentro da extensão diz o tipo provável da falha e o que fazer. Nada é enviado para fora do navegador. Aprendeu com ${learnedTotal} correção(ões).</small></span></label>
      <label class="check"><input type="checkbox" data-setting="autoHeal" ${s.autoHeal !== false ? 'checked' : ''}>
        <span>Auto-correção de seletores<br><small>Se o elemento gravado não for encontrado, procura o mais parecido (mesmo texto, rótulo, id ou name) e segue. O passo fica marcado para você aplicar ou não a correção.</small></span></label>
      <div class="banner-actions" style="margin-top:0"><button class="btn small ghost" data-action="ai-reset">${ICON.trash}Apagar aprendizado da IA</button></div>
      <div class="section-title" style="padding:8px 0 0">Time (aprendizado federado e radar)</div>
      <label>Servidor do time
        <input type="url" data-setting="teamServer" value="${esc(s.teamServer)}" placeholder="https://panda-qa.vercel.app"></label>
      <label>Chave do time
        <input type="password" data-setting="teamKey" value="${esc(s.teamKey)}" autocomplete="off">
        <small>Quem administra o servidor passa essa chave. Ela não vai no backup nem no export.</small></label>
      <label class="check"><input type="checkbox" data-setting="teamLearn" ${s.teamLearn !== false ? 'checked' : ''}>
        <span>Aprender com o time<br><small>Baixa o modelo do time e manda só a diferença de pesos que suas correções geraram. Nenhum texto, URL ou print sai do navegador.</small></span></label>
      <label class="check"><input type="checkbox" data-setting="teamRadar" ${s.teamRadar !== false ? 'checked' : ''}>
        <span>Radar das lojas<br><small>A cada execução manda o apelido do site (não o endereço), o trecho da URL (ex.: /checkout), se passou ou falhou, o tempo e os números da falha.</small></span></label>
      <div class="banner-text">${teamStatus()}</div>
      <div class="banner-actions" style="margin-top:0"><button class="btn small" data-action="team-sync" ${s.teamServer && s.teamKey ? '' : 'disabled'}>Sincronizar agora</button></div>
      <div class="section-title" style="padding:8px 0 0">ClickUp</div>
      <label>Token pessoal do ClickUp
        <input type="password" data-setting="clickupToken" value="${esc(s.clickupToken)}" placeholder="pk_..." autocomplete="off">
        <small>No ClickUp: avatar > Settings > Apps > API Token. As horas saem no seu nome. Fica só neste navegador.</small></label>
      <label>Status quando o teste passa (opcional)
        <input type="text" data-setting="clickupDoneStatus" value="${esc(s.clickupDoneStatus)}" placeholder="ex.: qa aprovado">
        <small>Nome exato do status na lista. Vazio: não oferece mudar o status.</small></label>
      <div class="section-title" style="padding:8px 0 0">Backup</div>
      <label>Backup automático
        <select id="set-backup" data-setting="backupHours">
          ${[[0, 'Desligado'], [1, 'A cada 1 hora'], [6, 'A cada 6 horas'], [24, 'Uma vez por dia']].map(([v, l]) => `<option value="${v}" ${Number(s.backupHours) === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>
        <small>Quando algum teste muda, salva em <b>Downloads/panda-qa-recorder/backup-AAAA-MM-DD.json</b> (um arquivo por dia). Fica fora do Chrome: sobrevive a limpar dados ou reinstalar a extensão. Senhas não vão no backup.</small></label>
      <div class="banner-text">${state.backup && state.backup.lastAt
        ? `Último backup: ${new Date(state.backup.lastAt).toLocaleString('pt-BR')}${state.backup.dirty ? ' (há alterações depois dele)' : ''}`
        : 'Nenhum backup feito ainda.'}</div>
      <div class="banner-actions" style="margin-top:0">
        <button class="btn" data-action="backup-now">${ICON.download}Fazer backup agora</button>
        <button class="btn" data-action="restore">${ICON.upload}Restaurar backup</button>
      </div>
    </div>`;
}

function teamStatus() {
  const { model, check, sent } = state.team;
  if (!state.settings.teamServer || !state.settings.teamKey) return 'Desligado: preencha o servidor e a chave do time.';
  const parts = [model
    ? `Modelo do time <b>v${model.versao}</b>${model.acuracia != null ? ` (acerta ${Math.round(model.acuracia * 100)}% nos casos de referência)` : ''}`
    : 'Ainda sem o modelo do time'];
  if (sent?.total) parts.push(`${sent.total} contribuição(ões) enviada(s)`);
  if (check?.at) parts.push(`sincronizado ${ago(check.at)}`);
  return parts.join(' · ') + (check?.error ? `<br>Erro: ${esc(check.error)}` : '');
}

// ---------- menus ----------

function openMenu(anchor, items) {
  menuEl.innerHTML = items.map((it, i) => (it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon || ''}${esc(it.label)}</button>`)).join('');
  menuEl.hidden = false;
  const r = anchor.getBoundingClientRect();
  const w = menuEl.offsetWidth;
  menuEl.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  const h = menuEl.offsetHeight;
  menuEl.style.top = (r.bottom + h + 8 > innerHeight ? r.top - h - 4 : r.bottom + 4) + 'px';
  menuEl.onclick = (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    closeMenu();
    Promise.resolve(items[b.dataset.i].run()).catch((err) => toast(err.message, true));
  };
}

function closeMenu() {
  menuEl.hidden = true;
}

document.addEventListener('mousedown', (e) => {
  if (state.siteOpen && !e.target.closest('.sitebar')) {
    state.siteOpen = false;
    render();
  }
  if (!menuEl.hidden && !menuEl.contains(e.target) && !e.target.closest('[data-action^="menu-"]')) closeMenu();
});

function testMenuItems(test) {
  return [
    { label: 'Exportar lista de passos (.md)', icon: ICON.download, run: () => download(`${slug(test.name)}.md`, toMarkdown(test), 'text/markdown') },
    { label: 'Copiar lista de passos', icon: ICON.copy, run: async () => { await navigator.clipboard.writeText(toMarkdown(test)); toast('Lista de passos copiada.'); } },
    { label: 'Compartilhar…', icon: ICON.share, run: () => shareTest(test) },
    { label: 'Exportar teste (.json)', icon: ICON.download, run: () => download(`${slug(test.name)}.json`, toJSON([test])) },
    { label: 'Exportar Playwright (.spec.ts)', icon: ICON.download, run: () => download(`${slug(test.name)}.spec.ts`, toPlaywright(test, state.vars), 'text/plain') },
    '-',
    { label: 'Duplicar', icon: ICON.copy, run: async () => {
      const copy = await createTest(`${test.name} (cópia)`, structuredClone(test.steps).map((s) => ({ ...s, id: uid() })));
      toast('Teste duplicado.');
      state.testId = copy.id;
      state.view = 'test';
    } },
    { label: 'Limpar resultados', icon: ICON.x, run: async () => {
      await updateTest(test.id, (t) => { delete t.lastRun; t.runs = []; });
      await chrome.storage.local.remove('shot:' + test.id);
      if (state.run && state.run.testId === test.id) await chrome.storage.session.set({ run: null });
    } },
    { label: 'Excluir teste', icon: ICON.trash, danger: true, run: async () => {
      if (!confirm(`Excluir o teste "${test.name}"?`)) return;
      await deleteTest(test.id);
      state.view = 'list';
      state.testId = null;
      toast('Teste excluído.');
    } },
  ];
}

function addStepMenu(test) {
  const make = (type, extra = {}) => ({ id: uid(), type, ...extra });
  const items = [
    ['Abrir URL', make('navigate', { url: '{{baseUrl}}/' })],
    ['Clicar', make('click', { selectors: [] })],
    ['Preencher campo', make('type', { selectors: [], value: '' })],
    ['Esperar', make('wait', { value: '1000' })],
    ['Verificar URL contém', make('assertUrl', { value: '' })],
    ['Verificar texto', make('assertText', { selectors: [{ css: 'body' }], value: '', label: 'página' })],
    ['Verificar elemento ausente', make('assertNotVisible', { selectors: [] })],
  ];
  return items.map(([label, step]) => ({ label, run: () => editStep(test, -1, step) }));
}

// ---------- edição de passo ----------

function editStep(test, index, draft) {
  const step = structuredClone(draft || test.steps[index]);
  const isNew = index < 0;
  const typeOptions = Object.entries(STEP_TYPES).map(([k, v]) => `<option value="${k}" ${k === step.type ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  const varChips = [...state.vars.map((v) => v.key).filter(Boolean), ...BUILTINS.map((b) => b.key)]
    .map((k) => `<button type="button" class="chip" data-insert="{{${esc(k)}}}">{{${esc(k)}}}</button>`).join('');

  dlg.innerHTML = `
    <form method="dialog" id="step-form">
      <div class="dlg-head">${isNew ? 'Novo passo' : `Editar passo ${index + 1}`}</div>
      <div class="dlg-body">
        <label class="field"><span>Tipo</span><select name="type">${typeOptions}</select></label>
        <label class="field" data-f="label"><span>Descrição do elemento</span><input name="label" value="${esc(step.label)}" placeholder="Ex.: botão Entrar"></label>
        <label class="field" data-f="url"><span>URL</span><input name="url" value="${esc(step.url)}" placeholder="{{baseUrl}}/customer/account/login"></label>
        <label class="field" data-f="value"><span data-value-label>Valor</span><input name="value" value="${esc(step.value)}"></label>
        <div class="field" data-f="vars"><small>Inserir variável:</small><div class="chips">${varChips}</div></div>
        <label class="field" data-f="key"><span>Tecla</span><select name="key">${['Enter', 'Tab', 'Escape'].map((k) => `<option ${k === (step.key || 'Enter') ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <label class="field" data-f="selectors"><span>Seletores (um por linha, tentados em ordem)</span>
          <textarea name="selectors" spellcheck="false">${esc((step.selectors || []).map(selectorToString).join('\n'))}</textarea>
          <small>CSS (<code>#email</code>, <code>button[type=submit]</code>) ou texto (<code>button:text=Entrar</code>).</small></label>
        <label class="field"><span>Tempo limite deste passo (ms)</span><input name="timeout" type="number" min="0" step="500" value="${esc(step.timeout || '')}" placeholder="padrão: ${state.settings.timeout}"></label>
        <label class="check"><input type="checkbox" name="optional" ${step.optional ? 'checked' : ''}> Opcional (se falhar, continua o teste)</label>
      </div>
      <div class="dlg-foot">
        <button type="button" class="btn ghost" data-dlg="highlight" data-f="selectors">${ICON.target}Testar na página</button>
        <span class="spacer"></span>
        <button type="button" class="btn" data-dlg="cancel">Cancelar</button>
        <button type="submit" class="btn primary">Salvar</button>
      </div>
    </form>`;

  const form = dlg.querySelector('form');
  let lastValueInput = form.value;

  const sync = () => {
    const type = form.type.value;
    const fields = STEP_TYPES[type].fields;
    const show = (f, on) => dlg.querySelectorAll(`[data-f="${f}"]`).forEach((el) => { el.hidden = !on; });
    show('url', fields.includes('url'));
    show('value', fields.includes('value'));
    show('vars', fields.includes('value') || fields.includes('url'));
    show('key', fields.includes('key'));
    show('selectors', fields.includes('selectors'));
    show('label', fields.includes('selectors'));
    const labels = { type: 'Texto a digitar', select: 'Valor ou texto da opção', wait: 'Milissegundos', assertText: 'Texto esperado', assertUrl: 'Trecho da URL' };
    dlg.querySelector('[data-value-label]').textContent = labels[type] || 'Valor';
  };
  form.type.addEventListener('change', sync);
  form.url.addEventListener('focus', () => { lastValueInput = form.url; });
  form.value.addEventListener('focus', () => { lastValueInput = form.value; });
  sync();

  const collect = () => {
    const out = { ...step, type: form.type.value, label: form.label.value.trim() };
    const fields = STEP_TYPES[out.type].fields;
    out.url = fields.includes('url') ? form.url.value.trim() : undefined;
    out.value = fields.includes('value') ? form.value.value : undefined;
    out.key = fields.includes('key') ? form.key.value : undefined;
    out.selectors = fields.includes('selectors')
      ? form.selectors.value.split('\n').map((l) => l.trim()).filter(Boolean).map(parseSelector)
      : undefined;
    if (out.type === 'select' && out.value !== step.value) delete out.optionText;
    out.timeout = Number(form.timeout.value) || undefined;
    out.optional = form.optional.checked || undefined;
    delete out.mergeKey;
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
  };

  dlg.onclick = async (e) => {
    const chip = e.target.closest('[data-insert]');
    if (chip) {
      const input = lastValueInput.closest('[hidden]') ? form.value : lastValueInput;
      const pos = input.selectionStart ?? input.value.length;
      input.value = input.value.slice(0, pos) + chip.dataset.insert + input.value.slice(input.selectionEnd ?? pos);
      input.focus();
      return;
    }
    const btn = e.target.closest('[data-dlg]');
    if (!btn) return;
    if (btn.dataset.dlg === 'cancel') dlg.close();
    if (btn.dataset.dlg === 'highlight') {
      try {
        const res = await send('highlight', { tabId: await activeTabId(), step: collect() });
        toast(res && res.found ? 'Elemento encontrado e destacado na página.' : 'Nenhum seletor encontrou um elemento visível nesta página.', !(res && res.found));
      } catch (err) {
        toast(err.message, true);
      }
    }
  };

  form.onsubmit = async (e) => {
    e.preventDefault();
    const out = collect();
    if (STEP_TYPES[out.type].fields.includes('selectors') && !out.selectors.length) {
      toast('Informe ao menos um seletor.', true);
      return;
    }
    await updateTest(test.id, (t) => {
      if (isNew) t.steps.push(out);
      else t.steps[index] = out;
    });
    dlg.close();
  };

  dlg.showModal();
}

function showShot() {
  dlg.innerHTML = `<div class="dlg-head">Tela no momento da falha</div><img class="shot-full" src="${state.shot}" alt=""><div class="dlg-foot"><button class="btn" data-dlg="cancel">Fechar</button></div>`;
  dlg.onclick = (e) => { if (e.target.closest('[data-dlg="cancel"]')) dlg.close(); };
  dlg.showModal();
}

// ---------- compartilhar ----------

async function shareTest(test) {
  const code = await encodeShare(test);
  const run = test.lastFailure || test.lastRun;
  dlg.innerHTML = `
    <div class="dlg-head">Compartilhar "${esc(test.name)}"</div>
    <div class="dlg-body">
      <div class="share-opt">
        <div><b>Para outro QA</b><small>Código para colar no chat ou na tarefa. Quem recebe usa ⋯ > Colar teste compartilhado.</small></div>
        <button class="btn primary small" data-share="code">${ICON.copy}Copiar código</button>
      </div>
      <div class="share-opt">
        <div><b>Para o dev</b><small>JSON com o teste${run ? ' e o último resultado: passo que falhou, erro, mensagens da página, erros de JS e requisições' : ''}. Também pode ser importado na extensão.</small></div>
        <div class="share-btns">
          <button class="btn small" data-share="dev-file">${ICON.download}Baixar JSON</button>
          <button class="btn small ghost" data-share="dev-copy">${ICON.copy}Copiar JSON</button>
        </div>
      </div>
      ${run ? `<div class="share-opt">
        <div><b>Relatório da execução</b><small>HTML com os passos, os erros e o print, para anexar na tarefa.</small></div>
        <button class="btn small" data-share="report">${ICON.download}Baixar relatório</button>
      </div>` : ''}
      ${run && teamOn() ? `<div class="share-opt">
        <div><b>Link do relatório</b><small>Página no servidor do time, com botão para baixar em PDF. Só abre com a chave do time (a mesma da extensão).</small></div>
        <button class="btn small" data-share="link">${ICON.copy}Copiar link</button>
      </div>` : ''}
      <div class="share-opt">
        <div><b>Lista de passos</b><small>Texto numerado para o plano de teste.</small></div>
        <button class="btn small ghost" data-share="steps">${ICON.copy}Copiar lista</button>
      </div>
    </div>
    <div class="dlg-foot"><button class="btn" data-dlg="cancel">Fechar</button></div>`;

  dlg.onclick = async (e) => {
    if (e.target.closest('[data-dlg="cancel"]')) return dlg.close();
    const b = e.target.closest('[data-share]');
    if (!b) return;
    try {
      const kind = b.dataset.share;
      if (kind === 'code') {
        await navigator.clipboard.writeText(`Teste "${test.name}" (Panda QA Recorder):\n${code}`);
        toast('Código copiado. Cole no chat ou na tarefa.');
      } else if (kind === 'dev-file') {
        const diag = run?.error ? await diagFor(test, run).catch(() => null) : null;
        download(`${slug(test.name)}-para-dev.json`, toDevJSON(test, state.vars, diag));
      } else if (kind === 'dev-copy') {
        const diag = run?.error ? await diagFor(test, run).catch(() => null) : null;
        await navigator.clipboard.writeText(toDevJSON(test, state.vars, diag));
        toast('JSON copiado.');
      } else if (kind === 'report') {
        const stamp = new Date(run.at).toISOString().slice(0, 16).replace(/[:T]/g, '-');
        const diag = run.error ? await diagFor(test, run).catch(() => null) : null;
        download(`relatorio-${slug(test.name)}-${stamp}.html`, toReportHtml(test, run, run.status === 'failed' ? state.shot : null, diag), 'text/html');
      } else if (kind === 'link') {
        b.disabled = true;
        const url = await reportLink(test, run);
        await navigator.clipboard.writeText(url);
        toast('Link do relatório copiado.');
        b.disabled = false;
      } else if (kind === 'steps') {
        await navigator.clipboard.writeText(toMarkdown(test));
        toast('Lista de passos copiada.');
      }
    } catch (err) {
      toast(err.message, true);
    }
  };
  dlg.showModal();
}

function pasteShared() {
  dlg.innerHTML = `
    <form method="dialog">
      <div class="dlg-head">Colar teste compartilhado</div>
      <div class="dlg-body">
        <label class="field"><span>Código ou JSON</span>
          <textarea name="code" rows="6" placeholder="PANDAQA1.…" spellcheck="false"></textarea>
          <small>Pode colar a mensagem inteira do chat; o código é encontrado sozinho.</small></label>
      </div>
      <div class="dlg-foot"><button type="button" class="btn" data-dlg="cancel">Cancelar</button><button type="submit" class="btn primary">Adicionar teste</button></div>
    </form>`;
  const form = dlg.querySelector('form');
  dlg.onclick = (e) => { if (e.target.closest('[data-dlg="cancel"]')) dlg.close(); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const text = form.code.value.trim();
      const items = text.startsWith('{') || text.startsWith('[') ? parseImport(text) : [await decodeShare(text)];
      for (const t of items.reverse()) {
        const created = await createTest(t.name || 'Teste compartilhado', t.steps.map((s) => ({ ...s, id: uid() })));
        if (t.repeat || t.interval) await updateTest(created.id, (x) => { x.repeat = t.repeat; x.interval = t.interval; });
      }
      dlg.close();
      toast(`${items.length} teste(s) adicionado(s).`);
    } catch (err) {
      toast(err.message, true);
    }
  };
  dlg.showModal();
  form.code.focus();
}

// ---------- ações ----------

async function startRecording(testId) {
  await send('rec:start', { testId, tabId: await activeTabId() });
}

const actions = {
  async new() {
    const n = state.tests.length + 1;
    const test = await createTest(`Teste ${n} - ${new Date().toLocaleDateString('pt-BR')}`);
    state.testId = test.id;
    state.view = 'test';
    await load();
    try {
      await startRecording(test.id);
    } catch (e) {
      toast(e.message, true);
    }
    const name = document.getElementById('test-name');
    if (name) name.select();
  },
  open(el) {
    state.testId = el.dataset.id;
    state.view = 'test';
    load();
  },
  back() {
    state.view = state.view === 'test' || !state.testId ? 'list' : 'test';
    if (state.view === 'list') state.testId = null;
    render();
  },
  view(el) {
    state.view = el.dataset.view;
    state.testId = null;
    render();
  },
  async run(el) {
    await send('run:start', { testIds: [el.dataset.id], tabId: await activeTabId() });
  },
  async 'run-from'(el) {
    await send('run:start', { testIds: [state.testId], tabId: await activeTabId(), startIndex: Number(el.dataset.index) });
  },
  async 'run-all'() {
    await send('run:start', { testIds: visibleTests().map((t) => t.id), tabId: await activeTabId() });
  },
  'site-toggle'() {
    state.siteOpen = !state.siteOpen;
    render();
  },
  'site-pick'(el) {
    return setSite(el.dataset.site);
  },
  async 'site-current'() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    let origin = null;
    try {
      origin = new URL(tab?.url || '').origin;
    } catch {
      // sem URL
    }
    if (!origin || !/^https?:/.test(origin)) throw new Error('Abra a página da loja (http/https) na aba atual.');
    if (!state.sites[origin]) await chrome.storage.local.set({ sites: { ...state.sites, [origin]: { label: siteHost(origin) } } });
    await setSite(origin);
  },
  async 'site-rename'() {
    const origin = state.site;
    const label = prompt(`Nome para ${siteHost(origin)} (ex.: Mueller · staging)`, siteLabel(origin));
    if (label == null) return;
    state.siteOpen = false;
    await chrome.storage.local.set({ sites: { ...state.sites, [origin]: { label: label.trim() || siteHost(origin) } } });
  },
  async 'cu-link'() {
    const ref = parseTaskRef(document.getElementById('cu-ref').value);
    const task = await getTask(state.settings.clickupToken, ref);
    await updateTest(state.testId, (t) => { t.clickup = task; });
    state.cuSearch = null;
    toast(`Vinculado a "${task.name}".`);
  },
  async 'cu-search'() {
    const query = document.getElementById('cu-search').value.trim();
    state.cuSearch = { testId: state.testId, query, loading: true, results: [] };
    render();
    try {
      state.cuSearch.results = await searchTasks(state.settings.clickupToken, query);
      state.cuSearch.loading = false;
      render();
    } catch (err) {
      state.cuSearch.loading = false;
      state.cuSearch.error = err.message;
      render();
    }
  },
  async 'cu-pick'(el) {
    const result = state.cuSearch?.results?.[Number(el.dataset.index)];
    if (!result) throw new Error('Tarefa não encontrada na pesquisa.');
    const task = await getTask(state.settings.clickupToken, { id: result.id });
    await updateTest(state.testId, (t) => { t.clickup = task; });
    state.cuSearch = null;
    toast(`Vinculado a "${task.name}".`);
  },
  async 'cu-unlink'() {
    await updateTest(state.testId, (t) => { delete t.clickup; });
  },
  async 'cu-reset'() {
    await updateTest(state.testId, (t) => { t.qaSince = Date.now(); });
  },
  async 'cu-launch'(el) {
    const test = currentTest();
    const token = state.settings.clickupToken;
    const minutes = Math.min(720, Math.max(1, Math.round(Number(document.getElementById('cu-min').value) || 0)));
    const description = document.getElementById('cu-desc').value.trim();
    const withComment = document.getElementById('cu-comment')?.checked;
    const withStatus = document.getElementById('cu-status')?.checked;
    el.disabled = true;
    try {
      const task = await getTask(token, { id: test.clickup.id });
      const duration = minutes * 60000;
      await logTime(token, task, { start: Date.now() - duration, duration, description });
      if (withComment) {
        const run = test.lastRun?.status === 'failed' && test.lastFailure ? test.lastFailure : test.lastRun;
        const diag = run?.error ? await diagFor(test, run).catch(() => null) : null;
        // Com o servidor do time, o comentário leva o link do relatório (com PDF) em vez do arquivo.
        const link = run && teamOn() ? await reportLink(test, run).catch(() => null) : null;
        await comment(token, task.id, `${description}\nTempo lançado: ${fmtDuration(duration)}.${link ? `\nRelatório: ${link}` : ''}${run ? `\n\n${toSummaryText(test, run, diag)}` : ''}`);
        if (run && !link) {
          const stamp = new Date(run.at).toISOString().slice(0, 16).replace(/[:T]/g, '-');
          await attach(token, task.id, `relatorio-${slug(test.name)}-${stamp}.html`, toReportHtml(test, run, run.status === 'failed' ? state.shot : null, diag));
        }
      }
      if (withStatus && state.settings.clickupDoneStatus) await setStatus(token, task.id, state.settings.clickupDoneStatus);
      delete state.cu[task.id];
      await updateTest(test.id, (t) => {
        t.clickup = withStatus ? { ...task, status: state.settings.clickupDoneStatus } : task;
        t.qaSince = null;
      });
      toast(`${fmtDuration(duration)} lançados em "${task.name}".`);
    } finally {
      el.disabled = false;
    }
  },
  async 'team-sync'() {
    await syncTeam(globalThis.tf);
    await send('radar:flush').catch(() => {});
    aiCache.clear();
    toast('Sincronizado com o servidor do time.');
  },
  async 'run-stop'() {
    await send('run:stop');
  },
  async 'rec-start'() {
    await startRecording(state.testId);
  },
  async 'rec-stop'() {
    await send('rec:stop');
    const test = currentTest();
    if (test) toast(`Gravação salva: ${test.steps.length} passos.`);
  },
  async pick() {
    await send('pick:start', { testId: state.testId, tabId: await activeTabId() });
  },
  'menu-add'(el) {
    openMenu(el, addStepMenu(currentTest()));
  },
  'menu-test'(el) {
    const test = state.tests.find((t) => t.id === el.dataset.id);
    if (test) openMenu(el, testMenuItems(test));
  },
  'menu-list'(el) {
    openMenu(el, [
      { label: 'Importar testes ou backup (.json)', icon: ICON.upload, run: () => fileInput.click() },
      { label: 'Colar teste compartilhado', icon: ICON.copy, run: () => pasteShared() },
      { label: 'Fazer backup agora', icon: ICON.download, run: () => actions['backup-now']() },
      { label: 'Exportar todos (.json)', icon: ICON.download, run: () => {
        if (!state.tests.length) throw new Error('Nenhum teste para exportar.');
        download(`panda-qa-recorder-${new Date().toISOString().slice(0, 10)}.json`, toJSON(state.tests));
      } },
    ]);
  },
  'edit-step'(el) {
    editStep(currentTest(), Number(el.dataset.index));
  },
  async 'toggle-step'(el) {
    const i = Number(el.dataset.index);
    await updateTest(state.testId, (t) => { t.steps[i].disabled = !t.steps[i].disabled || undefined; });
  },
  async 'delete-step'(el) {
    const i = Number(el.dataset.index);
    await updateTest(state.testId, (t) => { t.steps.splice(i, 1); delete t.lastRun; });
  },
  shot() {
    showShot();
  },
  async 'backup-now'() {
    const res = await send('backup:now');
    toast(`Backup salvo em Downloads/${res.filename}`);
  },
  restore() {
    fileInput.click();
  },
  share() {
    return shareTest(currentTest());
  },
  async report(el) {
    const test = currentTest();
    const run = el.dataset.which === 'failure' ? test.lastFailure : test.lastRun;
    const stamp = new Date(run.at).toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const diag = run.error ? await diagFor(test, run).catch(() => null) : null;
    download(`relatorio-${slug(test.name)}-${stamp}.html`, toReportHtml(test, run, run.status === 'failed' ? state.shot : null, diag), 'text/html');
  },
  async 'report-link'(el) {
    const test = currentTest();
    const run = el.dataset.which === 'failure' ? test.lastFailure : test.lastRun;
    el.disabled = true;
    try {
      const url = await reportLink(test, run);
      await navigator.clipboard.writeText(url);
      toast('Link do relatório copiado.');
    } finally {
      el.disabled = false;
    }
  },
  async 'copy-summary'(el) {
    const test = currentTest();
    const run = el.dataset.which === 'failure' ? test.lastFailure : test.lastRun;
    const diag = run.error ? await diagFor(test, run).catch(() => null) : null;
    await navigator.clipboard.writeText(toSummaryText(test, run, diag));
    toast('Resumo copiado. Cole na tarefa.');
  },
  async 'update-check'() {
    const info = await send('update:check');
    if (info.error) toast(info.error, true);
    else toast(info.available ? `Nova versão ${info.latest} disponível.` : `Você está na versão mais recente (${info.current}).`);
    if (info.available) actions['update-show']();
  },
  'update-show'() {
    const u = state.update;
    if (!u || !u.available) return;
    dlg.innerHTML = `
      <div class="dlg-head">Nova versão ${esc(u.latest)} (você tem a ${esc(u.current)})</div>
      <div class="dlg-body">
        ${u.notes ? `<div class="field"><span>O que mudou</span><div class="banner-text" style="white-space:pre-line">${esc(u.notes)}</div></div>` : ''}
        <ol class="update-steps">
          <li>Baixe o zip novo pelo botão abaixo.</li>
          <li>Descompacte <b>por cima</b> da pasta onde a extensão está instalada (substitua os arquivos).</li>
          <li>Clique em <b>Recarregar extensão</b>. Os testes continuam salvos.</li>
        </ol>
      </div>
      <div class="dlg-foot">
        <button class="btn" data-dlg="cancel">Fechar</button>
        <button class="btn" data-dlg="reload">Recarregar extensão</button>
        ${u.download ? `<button class="btn primary" data-dlg="download">${ICON.download}Baixar versão ${esc(u.latest)}</button>` : ''}
      </div>`;
    dlg.onclick = (e) => {
      const b = e.target.closest('[data-dlg]');
      if (!b) return;
      if (b.dataset.dlg === 'cancel') dlg.close();
      if (b.dataset.dlg === 'download') chrome.tabs.create({ url: u.download });
      if (b.dataset.dlg === 'reload') reloadExtension();
    };
    dlg.showModal();
  },
  'ext-reload'() {
    reloadExtension();
  },
  async 'apply-heal'(el) {
    const i = Number(el.dataset.index);
    const test = currentTest();
    const healed = stepStatus(test, i)?.healed;
    if (!healed) return;
    await updateTest(test.id, (t) => {
      const step = t.steps[i];
      const keep = (step.selectors || []).filter((s) => !healed.selectors.some((h) => JSON.stringify(h) === JSON.stringify(s)));
      // Novos seletores primeiro; os antigos ficam no fim, caso o site volte ao layout anterior.
      step.selectors = [...healed.selectors, ...keep].slice(0, 7);
      if (t.lastRun?.results?.[i]) t.lastRun.results[i] = { status: 'passed', ms: t.lastRun.results[i].ms };
    });
    if (state.run && state.run.testId === test.id && state.run.results?.[i]) {
      state.run.results[i] = { status: 'passed', ms: state.run.results[i].ms };
      await chrome.storage.session.set({ run: state.run });
    }
    toast('Seletores do passo atualizados.');
  },
  async 'ai-reset'() {
    if (!confirm('Apagar tudo o que a IA aprendeu com as correções? Ela volta ao treino inicial.')) return;
    await chrome.storage.local.remove(['diagExamples', 'diagModelSig', 'teamDelta']);
    learnedTotal = 0;
    aiCache.clear();
    toast('Aprendizado apagado. O modelo será treinado de novo na próxima análise.');
    render();
  },
  async 'ai-ok'(el) {
    const test = currentTest();
    const run = el.dataset.which === 'failure' ? test.lastFailure : test.lastRun;
    await learn(failureOf(test, run), el.dataset.cat);
    learnedTotal = await learnedCount();
    pushContribution().catch(() => {});
    toast('Obrigado! O modelo aprendeu com essa confirmação.');
    render();
  },
  'ai-fix'(el) {
    const test = currentTest();
    const run = el.dataset.which === 'failure' ? test.lastFailure : test.lastRun;
    dlg.innerHTML = `
      <form method="dialog">
        <div class="dlg-head">Qual é o motivo real da falha?</div>
        <div class="dlg-body">
          ${CATEGORIES.map((c, i) => `<label class="check ai-opt"><input type="radio" name="cat" value="${c.key}" ${i === 0 ? 'required' : ''}><span><b>${esc(c.label)}</b><small>${esc(c.explain)}</small></span></label>`).join('')}
        </div>
        <div class="dlg-foot"><button type="button" class="btn" data-dlg="cancel">Cancelar</button><button type="submit" class="btn primary">Ensinar</button></div>
      </form>`;
    const form = dlg.querySelector('form');
    dlg.onclick = (e) => { if (e.target.closest('[data-dlg="cancel"]')) dlg.close(); };
    form.onsubmit = async (e) => {
      e.preventDefault();
      dlg.close();
      toast('Treinando o modelo com a correção…');
      await learn(failureOf(test, run), form.cat.value);
      learnedTotal = await learnedCount();
      pushContribution().catch(() => {});
      toast('Pronto: o modelo aprendeu com a correção.');
      render();
    };
    dlg.showModal();
  },
  async 'var-add'() {
    await saveVars([...state.vars, { key: '', value: '', secret: false }]);
  },
  async 'var-del'(el) {
    await saveVars(state.vars.filter((_, i) => i !== Number(el.dataset.index)));
  },
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.disabled) return;
  e.stopPropagation();
  const fn = actions[el.dataset.action];
  if (fn) Promise.resolve(fn(el)).catch((err) => toast(err.message, true));
});

app.addEventListener('input', (e) => {
  if (e.target.id === 'filter') {
    state.filter = e.target.value;
    render();
  }
});

app.addEventListener('change', async (e) => {
  const t = e.target;
  try {
    if (t.id === 'cu-task-status') {
      const test = currentTest();
      const status = test.clickup?.statuses?.find((item) => item.status === t.value);
      if (!test.clickup || !status) throw new Error('Status inválido para esta tarefa.');
      await setStatus(state.settings.clickupToken, test.clickup.id, status.status);
      await updateTest(state.testId, (item) => {
        item.clickup = { ...item.clickup, status: status.status, color: status.color || item.clickup.color };
      });
      toast(`Status atualizado para "${status.status}".`);
    } else if (t.id === 'test-site') {
      await updateTest(state.testId, (test) => {
        if (t.value === NO_SITE) delete test.site;
        else test.site = t.value;
      });
    } else if (t.id === 'clean-session') {
      await updateTest(state.testId, (test) => { test.cleanSession = t.checked; });
    } else if (t.id === 'repeat' || t.id === 'interval') {
      const max = t.id === 'repeat' ? 500 : 86400;
      const value = Math.min(Math.max(Math.round(Number(t.value) || 0), t.id === 'repeat' ? 1 : 0), max);
      await updateTest(state.testId, (test) => { test[t.id] = value; });
    } else if (t.id === 'test-name') {
      const name = t.value.trim() || 'Sem nome';
      await updateTest(state.testId, (test) => { test.name = name; });
    } else if (t.dataset.var) {
      const vars = structuredClone(state.vars);
      const v = vars[Number(t.dataset.index)];
      v[t.dataset.var] = t.type === 'checkbox' ? t.checked : t.value.trim();
      await saveVars(vars);
    } else if (t.dataset.setting) {
      const value = t.type === 'checkbox' ? t.checked
        : t.type === 'number' || t.tagName === 'SELECT' ? Math.max(0, Number(t.value) || 0) : t.value;
      await saveSettings({ ...state.settings, [t.dataset.setting]: value });
    }
  } catch (err) {
    toast(err.message, true);
  }
});

app.addEventListener('keydown', (e) => {
  if (e.target.id === 'test-name' && e.key === 'Enter') e.target.blur();
});

// Reordenação dos passos por arrastar e soltar.
let dragFrom = null;
app.addEventListener('dragstart', (e) => {
  const li = e.target.closest('.step');
  if (!li) return;
  dragFrom = Number(li.dataset.index);
  li.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
});
app.addEventListener('dragover', (e) => {
  const li = e.target.closest('.step');
  if (dragFrom == null || !li) return;
  e.preventDefault();
  app.querySelectorAll('.drop-before,.drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'));
  const r = li.getBoundingClientRect();
  li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
});
app.addEventListener('drop', async (e) => {
  const li = e.target.closest('.step');
  if (dragFrom == null || !li) return;
  e.preventDefault();
  let to = Number(li.dataset.index) + (li.classList.contains('drop-after') ? 1 : 0);
  const from = dragFrom;
  dragFrom = null;
  if (to > from) to -= 1;
  if (to === from) return render();
  await updateTest(state.testId, (t) => {
    const [moved] = t.steps.splice(from, 1);
    t.steps.splice(to, 0, moved);
    delete t.lastRun;
  });
});
app.addEventListener('dragend', () => {
  dragFrom = null;
  render();
});

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (isBackup(data)) {
      const r = await restoreBackup(data);
      toast(`Backup restaurado: ${r.added} teste(s) novo(s), ${r.updated} atualizado(s).`);
      return;
    }
    const imported = parseImport(text);
    const tests = await getTests();
    for (const t of imported.reverse()) {
      tests.unshift({ id: uid(), name: t.name, steps: t.steps.map((s) => ({ ...s, id: uid() })), createdAt: Date.now(), updatedAt: Date.now(), runs: [] });
    }
    await saveTests(tests);
    toast(`${imported.length} teste(s) importado(s).`);
  } catch (e) {
    toast(`Arquivo inválido: ${e.message}`, true);
  }
});

// Atualiza a contagem regressiva do intervalo entre repetições.
setInterval(() => {
  if (state.suite && state.suite.nextAt) render();
}, 1000);

learnedCount().then((n) => { learnedTotal = n; }).catch(() => {});
load();

// Modelo do time: confere ao abrir o painel e a cada 15 minutos com ele aberto.
async function teamTick() {
  if (!(await teamConfig()).on) return;
  if (await syncTeam(globalThis.tf).catch(() => false)) aiCache.clear();
}
teamTick();
setInterval(teamTick, 15 * 60 * 1000);
