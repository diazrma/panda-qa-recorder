/**
 * Conexão com o servidor do time (Vercel): baixa o modelo do time, manda a contribuição do
 * aprendizado federado (só a diferença de pesos) e os sinais do radar das lojas.
 */
import { getSettings, uid } from './store.js';
import { TEAM_MODEL_URL, invalidateModel } from './diagnosis.js';

export async function teamConfig() {
  const s = await getSettings();
  const server = String(s.teamServer || '').trim().replace(/\/+$/, '');
  return { server, key: String(s.teamKey || '').trim(), name: String(s.teamName || '').trim().slice(0, 40), learn: s.teamLearn !== false, radar: s.teamRadar !== false, runs: s.teamRuns === true, on: Boolean(server && s.teamKey) };
}

export async function clientId() {
  let { clienteId } = await chrome.storage.local.get('clienteId');
  if (!clienteId) await chrome.storage.local.set({ clienteId: clienteId = uid() });
  return clienteId;
}

async function call(cfg, path, body) {
  const res = await fetch(cfg.server + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-equipe': cfg.key },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.erro || `Servidor do time respondeu ${res.status}`);
  return data;
}

/**
 * Baixa o modelo do time quando há versão nova. Roda no painel (precisa de window.tf).
 * Devolve true quando trocou de modelo.
 */
export async function pullModel(tf) {
  const cfg = await teamConfig();
  if (!cfg.on || !cfg.learn) return false;
  const atual = await call(cfg, '/api/modelo');
  const { teamModel } = await chrome.storage.local.get('teamModel');
  await chrome.storage.local.set({ teamCheck: { at: Date.now(), versao: atual.versao, error: null } });
  if (teamModel && teamModel.versao === atual.versao) return false;
  const model = await tf.loadLayersModel(cfg.server + atual.url, { requestInit: { headers: { 'x-equipe': cfg.key } } });
  await model.save(TEAM_MODEL_URL);
  await chrome.storage.local.set({ teamModel: { versao: atual.versao, acuracia: atual.acuracia, at: Date.now() } });
  invalidateModel();
  return true;
}

/** Manda a diferença de pesos calculada em diagnosis.js, uma vez por versão do modelo e conjunto de correções. */
export async function pushContribution() {
  const cfg = await teamConfig();
  if (!cfg.on || !cfg.learn) return null;
  const { teamDelta, teamSent } = await chrome.storage.local.get(['teamDelta', 'teamSent']);
  if (!teamDelta || teamSent?.sig === teamDelta.sig) return null;
  const res = await call(cfg, '/api/contribuir', { cliente: await clientId(), base: teamDelta.base, n: teamDelta.n, delta: teamDelta.delta });
  await chrome.storage.local.set({ teamSent: { sig: teamDelta.sig, at: Date.now(), total: (teamSent?.total || 0) + 1 } });
  return res;
}

export async function syncTeam(tf) {
  try {
    const changed = await pullModel(tf);
    await pushContribution();
    return changed;
  } catch (e) {
    await chrome.storage.local.set({ teamCheck: { at: Date.now(), error: e.message } });
    throw e;
  }
}

// ---------- radar (service worker) ----------

const MAX_QUEUE = 300;

export async function queueSignal(signal) {
  const cfg = await teamConfig();
  if (!cfg.on || !cfg.radar) return;
  const { radarFila = [] } = await chrome.storage.local.get('radarFila');
  radarFila.push(signal);
  await chrome.storage.local.set({ radarFila: radarFila.slice(-MAX_QUEUE) });
  if (radarFila.length >= 20) await flushSignals().catch(() => {});
}

export async function flushSignals() {
  const cfg = await teamConfig();
  const { radarFila = [] } = await chrome.storage.local.get('radarFila');
  if (!cfg.on || !radarFila.length) return 0;
  await call(cfg, '/api/sinal', { cliente: await clientId(), nome: cfg.name, sinais: radarFila });
  // Tira só o que foi enviado: sinais novos podem ter entrado durante o envio.
  const now = (await chrome.storage.local.get('radarFila')).radarFila || [];
  await chrome.storage.local.set({ radarFila: now.slice(radarFila.length) });
  return radarFila.length;
}

// ---------- relatório por link ----------

/** Publica o relatório da execução no servidor do time e devolve o link individual (/relatorio/<id>). */
export async function uploadReport(test, run, shot, diag, stepShots = null) {
  const cfg = await teamConfig();
  if (!cfg.on) throw new Error('Configure o servidor do time em Configurações > Time para gerar links.');
  const d = diag ? { label: diag.label, explain: diag.explain, fix: diag.fix, confidence: diag.confidence } : null;
  const res = await call(cfg, '/api/relatorio', { test: { name: test.name, steps: test.steps }, run, shot: shot || null, diag: d, stepShots: stepShots ? fitShots(stepShots, run.failedIndex) : null });
  return res.url;
}

// ---------- execuções no painel do time ----------

// A Vercel recusa corpo acima de 4,5 MB; sobra folga para passos e resultados.
const MAX_SHOTS_BYTES = 3_500_000;

/** Tira prints de passos que passaram (do começo para o fim) até caber no envio; o da falha fica sempre. */
export function fitShots(shots, failedIndex = -1) {
  const out = { ...shots };
  const size = () => Object.values(out).reduce((n, s) => n + (s ? s.length : 0), 0);
  const removable = Object.keys(out).map(Number).filter((i) => i !== failedIndex).sort((a, b) => a - b);
  while (size() > MAX_SHOTS_BYTES && removable.length) delete out[removable.shift()];
  return out;
}

/** Manda a última execução do teste (passos, resultado e prints) para a seção Testes do painel. */
export async function uploadRun({ test, run, site, testAlias, shots }) {
  const cfg = await teamConfig();
  if (!cfg.on || !cfg.runs || !run) return null;
  const { email, ...semEmail } = run;
  return call(cfg, '/api/execucao', {
    cliente: await clientId(),
    nome: cfg.name,
    s: site,
    t: testAlias,
    teste: { name: test.name, steps: test.steps },
    run: semEmail,
    shots: fitShots(shots, run.failedIndex),
  });
}
