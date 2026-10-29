// Execuções enviadas pelas extensões para a seção Testes do painel: só a última de cada teste por QA.
// Cada envio vira dois arquivos: o resumo (leve, lido para montar a lista) e o completo, com passos,
// resultados e prints, lido só quando alguém abre o teste no painel.
import { gravar, lerJSON, lerTodosJSON, listar, apagar } from './armazem.js';
import { limpaNome } from './sinais.js';
import { describeStep } from '../lib/steps.js';

const limpa = (v, n) => String(v ?? '').replace(/[^\w-]/g, '').slice(0, n);
const texto = (v, n) => String(v ?? '').slice(0, n);
const PRINT = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;
const STATUS = ['passed', 'failed', 'healed', 'warning', 'skipped', 'pending'];

export async function receberExecucao(d) {
  const c = limpa(d.cliente, 20);
  const t = limpa(d.t, 16);
  if (!c || !t) throw Object.assign(new Error('Faltou o QA ou o teste.'), { status: 400 });
  const steps = (Array.isArray(d.teste?.steps) ? d.teste.steps : []).slice(0, 300);
  if (!steps.length) throw Object.assign(new Error('Execução sem passos.'), { status: 400 });
  const r = d.run || {};
  const results = (Array.isArray(r.results) ? r.results : []).slice(0, steps.length).map((x) => ({
    status: STATUS.includes(x?.status) ? x.status : 'pending',
    ...(x?.ms != null ? { ms: Math.max(0, Number(x.ms) || 0) } : {}),
    ...(x?.error ? { error: texto(x.error, 500) } : {}),
  }));
  const shots = {};
  for (const [i, s] of Object.entries(d.shots && typeof d.shots === 'object' ? d.shots : {})) {
    if (Number(i) >= 0 && Number(i) < steps.length && typeof s === 'string' && PRINT.test(s)) shots[Number(i)] = s;
  }
  const at = Math.min(Date.now(), Number(r.at) || Date.now());
  const resumo = {
    id: `${c}-${t}`,
    c,
    q: limpaNome(d.nome),
    s: limpa(d.s, 16),
    nome: texto(d.teste?.name, 200) || 'Teste',
    status: r.status === 'failed' ? 'failed' : 'passed',
    at,
    ms: Math.max(0, Number(r.ms) || 0),
    passos: steps.length,
    falhou: Number.isInteger(r.failedIndex) && r.failedIndex >= 0 ? r.failedIndex : -1,
    erro: texto(r.error, 300),
    prints: Object.keys(shots).length,
  };
  const messages = (Array.isArray(r.diagnostics?.messages) ? r.diagnostics.messages : []).slice(0, 20).map((m) => texto(m, 300));
  await gravar(`execucoes/completo/${resumo.id}.json`, { ...resumo, steps, descs: steps.map((s) => texto(describeStep(s), 300)), results, messages, shots });
  await gravar(`execucoes/resumo/${resumo.id}.json`, resumo);
  return { ok: true, id: resumo.id, prints: resumo.prints };
}

/** Resumos de todas as execuções, a mais recente primeiro (uma por teste e QA). */
export async function listarExecucoes() {
  const porId = new Map();
  for (const { dados } of await lerTodosJSON('execucoes/resumo/')) {
    if (!dados?.id) continue;
    const atual = porId.get(dados.id);
    if (!atual || dados.at > atual.at) porId.set(dados.id, dados);
  }
  return [...porId.values()].sort((a, b) => b.at - a.at);
}

export const lerExecucao = (id) => lerJSON(`execucoes/completo/${limpa(id, 40)}.json`);

export async function apagarExecucao(id) {
  const limpo = limpa(id, 40);
  await apagar([`execucoes/resumo/${limpo}.json`, `execucoes/completo/${limpo}.json`]);
}

export async function apagarTodasExecucoes() {
  const itens = await listar('execucoes/');
  await apagar(itens.map((i) => i.chave));
  return new Set(itens.filter((i) => i.chave.startsWith('execucoes/resumo/')).map((i) => i.chave)).size;
}
