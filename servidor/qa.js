// Painel do QA: com a chave do time, cada QA vê só as lojas em que testou. As lojas dele são os
// sites em que mandou sinal do radar ou execução, mais os outros sites dos mesmos projetos
// (testou no staging da MetLife, vê também o local e a produção da MetLife).
import { lerSinais, painelRadar, projetoDosSites } from './sinais.js';
import { listarExecucoes, lerExecucao } from './execucoes.js';

export const limpaCliente = (v) => String(v ?? '').replace(/[^\w-]/g, '').slice(0, 20);

/** Apelidos dos sites que o QA pode ver. */
export async function lojasDoQa(cliente, cfg, agora = Date.now()) {
  if (!cliente) return new Set();
  const [sinais, execucoes] = await Promise.all([lerSinais(8, agora), listarExecucoes()]);
  const proprias = new Set([...sinais, ...execucoes].filter((x) => x.c === cliente && x.s).map((x) => x.s));
  const lojas = new Set(proprias);
  for (const p of Object.values(cfg.projetos || {})) {
    if ((p.sites || []).some((s) => proprias.has(s))) for (const s of p.sites) lojas.add(s);
  }
  return lojas;
}

/** O que a tela mostra para o QA: radar, execuções e nomes só das lojas dele, sem nada de admin. */
export async function painelDoQa(cliente, cfg, filtro = {}, agora = Date.now()) {
  const lojas = await lojasDoQa(cliente, cfg, agora);
  const radar = await painelRadar(cfg, agora, filtro, lojas);
  const doSite = projetoDosSites(cfg.projetos);
  const execucoes = (await listarExecucoes())
    .filter((e) => lojas.has(e.s))
    .map((e) => ({ ...e, projeto: doSite[e.s] || null }))
    .filter((e) => (!filtro.projeto || (e.projeto || '-') === filtro.projeto) && (!filtro.qa || e.c === filtro.qa))
    .slice(0, 200);
  const projetos = Object.fromEntries(Object.entries(cfg.projetos || {})
    .filter(([, p]) => (p.sites || []).some((s) => lojas.has(s)))
    .map(([id, p]) => [id, { nome: p.nome, sites: p.sites.filter((s) => lojas.has(s)) }]));
  const sites = Object.fromEntries(Object.entries(cfg.sites || {}).filter(([s]) => lojas.has(s)));
  return { qa: true, eu: cliente, lojas: lojas.size, radar, execucoes, config: { janelaHoras: cfg.janelaHoras, sites, projetos } };
}

/** Execução completa, só se for de uma loja do QA. */
export async function execucaoDoQa(cliente, cfg, id) {
  const ex = await lerExecucao(String(id || ''));
  if (!ex || !(await lojasDoQa(cliente, cfg)).has(ex.s)) throw Object.assign(new Error('Execução não encontrada.'), { status: 404 });
  return ex;
}
