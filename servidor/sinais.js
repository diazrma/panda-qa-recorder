// Sinais do radar: cada envio de uma extensão vira um arquivo em sinais/<dia>/.
import { randomUUID } from 'node:crypto';
import { gravar, lerTodosJSON, lerJSON } from './armazem.js';
import { analisar, textoDoBug } from './radar.js';
import { config, modeloAtual, classificar, deEsparso } from './federado.js';
import { criarTarefa } from './clickup.js';
import { registrarSites } from './projetos.js';

const limpa = (v, n) => String(v ?? '').replace(/[^\w/#*?.-]/g, '').slice(0, n);
export const limpaNome = (v) => String(v ?? '').replace(/[^\p{L}\p{N} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
const dias = (n, agora) => Array.from({ length: n }, (_, i) => new Date(agora - i * 864e5).toISOString().slice(0, 10));

export async function receberSinais({ cliente, nome, sinais, sites }) {
  await registrarSites(sites).catch((e) => console.error('projeto automático', e));
  if (!Array.isArray(sinais) || !sinais.length) return { ok: true, recebidos: 0 };
  const agora = Date.now();
  const q = limpaNome(nome);
  const lista = sinais.slice(0, 300).map((s) => ({
    c: limpa(cliente, 20),
    ...(q ? { q } : {}),
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

/** Projeto de cada site (apelido -> id do projeto), a partir de cfg.projetos. */
export function projetoDosSites(projetos = {}) {
  const mapa = {};
  for (const [id, p] of Object.entries(projetos)) for (const s of p.sites || []) mapa[s] = id;
  return mapa;
}

/** QAs que mandaram sinal na janela lida, com o último nome informado e os números das últimas 24 h. */
export function listarQas(sinais, agora = Date.now()) {
  const qas = new Map();
  for (const s of [...sinais].sort((a, b) => a.at - b.at)) {
    const qa = qas.get(s.c) || { id: s.c, nome: '', ultimo: 0, execucoes: 0, falhas: 0 };
    if (s.q) qa.nome = s.q;
    qa.ultimo = Math.max(qa.ultimo, s.at);
    if (s.at >= agora - 864e5) {
      qa.execucoes++;
      if (s.st === 'failed') qa.falhas++;
    }
    qas.set(s.c, qa);
  }
  return [...qas.values()].sort((a, b) => !a.nome - !b.nome || a.nome.localeCompare(b.nome, 'pt-BR') || b.ultimo - a.ultimo);
}

export async function painelRadar(cfg, agora = Date.now(), filtro = {}) {
  const todos = await lerSinais(8, agora);
  const doSite = projetoDosSites(cfg.projetos);
  const projeto = filtro.projeto || '';
  const noProjeto = projeto ? todos.filter((s) => (doSite[s.s] || '-') === projeto) : todos;
  const qa = filtro.qa || '';
  const filtrados = qa ? noProjeto.filter((s) => s.c === qa) : noProjeto;
  const opcoes = { agora, janelaHoras: cfg.janelaHoras, minClientes: Math.min(2, cfg.minClientes), sites: cfg.sites };
  const r = analisar(filtrados, opcoes);
  // Quebra nova depende de mais de um QA: com filtro de QA, vale a do projeto em que ele está entre os que falharam.
  if (qa) r.alertas = analisar(noProjeto, opcoes).alertas.filter((a) => a.qas.includes(qa));
  const bugs = await lerJSON('estado/bugs.json', {});
  r.alertas = r.alertas.map((a) => ({ ...a, projeto: doSite[a.site] || null, bug: bugs[a.chave] || null }));
  r.mapa = r.mapa.map((m) => ({ ...m, projeto: doSite[m.site] || null }));
  r.qas = listarQas(todos, agora);
  r.sitesVistos = [...new Set(todos.map((s) => s.s))];
  r.filtro = { projeto, qa };
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
