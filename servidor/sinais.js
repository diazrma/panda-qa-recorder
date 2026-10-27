// Sinais do radar: cada envio de uma extensão vira um arquivo em sinais/<dia>/.
import { randomUUID } from 'node:crypto';
import { gravar, lerTodosJSON, lerJSON } from './armazem.js';
import { analisar, textoDoBug } from './radar.js';
import { config, modeloAtual, classificar, deEsparso } from './federado.js';
import { criarTarefa } from './clickup.js';

const limpa = (v, n) => String(v ?? '').replace(/[^\w/#*?.-]/g, '').slice(0, n);
const dias = (n, agora) => Array.from({ length: n }, (_, i) => new Date(agora - i * 864e5).toISOString().slice(0, 10));

export async function receberSinais({ cliente, sinais }) {
  if (!Array.isArray(sinais) || !sinais.length) return { ok: true, recebidos: 0 };
  const agora = Date.now();
  const lista = sinais.slice(0, 300).map((s) => ({
    c: limpa(cliente, 20),
    s: limpa(s.s, 16),
    f: limpa(s.f, 80) || '/',
    t: limpa(s.t, 16),
    st: ['passed', 'failed'].includes(s.st) ? s.st : 'failed',
    ms: Math.max(0, Math.min(36e5, Number(s.ms) || 0)),
    at: Math.min(agora, Math.max(agora - 7 * 864e5, Number(s.at) || agora)),
    v: s.st === 'failed' && s.v && typeof s.v === 'object' ? s.v : null,
  }));
  // O servidor classifica as falhas com o modelo do time (a extensão manda só os números).
  const falhas = lista.filter((s) => s.v);
  if (falhas.length) {
    const { model } = await modeloAtual();
    classificar(model, falhas.map((s) => Array.from(deEsparso(s.v)))).forEach((r, i) => { falhas[i].cat = r.categoria; });
  }
  for (const s of lista) delete s.v;
  await gravar(`sinais/${new Date(agora).toISOString().slice(0, 10)}/${agora}-${randomUUID().slice(0, 8)}.json`, lista);
  const cfg = await config();
  if (cfg.autoBug && falhas.length) await abrirBugsNovos(cfg).catch((e) => console.error('auto bug', e));
  return { ok: true, recebidos: lista.length };
}

export async function lerSinais(nDias = 8, agora = Date.now()) {
  const arquivos = (await Promise.all(dias(nDias, agora).map((d) => lerTodosJSON(`sinais/${d}/`)))).flat();
  return arquivos.flatMap((a) => (Array.isArray(a.dados) ? a.dados : []));
}

export async function painelRadar(cfg, agora = Date.now()) {
  const r = analisar(await lerSinais(8, agora), { agora, janelaHoras: cfg.janelaHoras, minClientes: Math.min(2, cfg.minClientes), sites: cfg.sites });
  const bugs = await lerJSON('estado/bugs.json', {});
  r.alertas = r.alertas.map((a) => ({ ...a, bug: bugs[a.chave] || null }));
  return r;
}

export async function abrirBug(chave, cfg) {
  const r = await painelRadar(cfg);
  const alerta = r.alertas.find((a) => a.chave === chave);
  if (!alerta) throw Object.assign(new Error('Esse alerta não está mais ativo.'), { status: 404 });
  if (alerta.bug) return alerta.bug;
  const tarefa = await criarTarefa(textoDoBug(alerta));
  const bugs = await lerJSON('estado/bugs.json', {});
  bugs[chave] = { url: tarefa.url, id: tarefa.id, at: Date.now() };
  await gravar('estado/bugs.json', bugs);
  return bugs[chave];
}

async function abrirBugsNovos(cfg) {
  const r = await painelRadar(cfg);
  for (const a of r.alertas.filter((x) => !x.bug)) await abrirBug(a.chave, cfg);
}
