// Radar das lojas: junta os sinais de execução de todos os QAs e acha quebra nova.
// Um alerta sai quando um fluxo de um site (ex.: s1x2 /checkout) passa a falhar na janela recente
// (padrão 2 h) para mais de um QA, sendo que antes passava. Estatística simples de propósito: com
// poucos dados ela é mais confiável e explicável que um modelo.
import { CATEGORIES } from '../lib/diagnosis.js';

const HORA = 3600e3;
const label = (cat) => CATEGORIES.find((c) => c.key === cat)?.label || cat || 'Sem diagnóstico';
const origem = (cat) => CATEGORIES.find((c) => c.key === cat)?.origin || null;

function dominante(lista) {
  const n = {};
  for (const s of lista) if (s.cat) n[s.cat] = (n[s.cat] || 0) + 1;
  const [cat] = Object.entries(n).sort((a, b) => b[1] - a[1])[0] || [];
  return cat || null;
}

export function analisar(sinais, { agora = Date.now(), janelaHoras = 2, minClientes = 2, sites = {} } = {}) {
  const janela = janelaHoras * HORA;
  const dia = sinais.filter((s) => s.at >= agora - 24 * HORA);
  const grupos = new Map();
  for (const s of sinais) {
    const k = `${s.s}|${s.f}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(s);
  }

  const mapa = [];
  const alertas = [];
  for (const [k, lista] of grupos) {
    const [site, fluxo] = k.split('|');
    const hoje = lista.filter((s) => s.at >= agora - 24 * HORA);
    if (hoje.length) {
      const falhas = hoje.filter((s) => s.st === 'failed');
      mapa.push({ site, nome: sites[site] || site, fluxo, total: hoje.length, falhas: falhas.length, taxa: falhas.length / hoje.length, categoria: dominante(falhas), testes: new Set(hoje.map((s) => s.t)).size });
    }
    const recentes = lista.filter((s) => s.at >= agora - janela);
    const antes = lista.filter((s) => s.at < agora - janela && s.at >= agora - 7 * 24 * HORA);
    const rf = recentes.filter((s) => s.st === 'failed');
    const quem = [...new Set(rf.map((s) => s.c))];
    const clientes = quem.length;
    const taxaAntes = antes.length ? antes.filter((s) => s.st === 'failed').length / antes.length : null;
    const quebrouAgora = taxaAntes === null ? rf.length === recentes.length : taxaAntes <= 0.25;
    if (recentes.length >= 3 && rf.length / recentes.length >= 0.5 && clientes >= minClientes && quebrouAgora) {
      const cat = dominante(rf);
      const desde = Math.min(...rf.map((s) => s.at));
      alertas.push({
        chave: `${site}|${fluxo}|${new Date(desde).toISOString().slice(0, 10)}`,
        site, nome: sites[site] || site, fluxo, falhas: rf.length, total: recentes.length, clientes, qas: quem, taxaAntes,
        execucoesAntes: antes.length, desde, categoria: cat, rotulo: label(cat), origem: origem(cat),
      });
    }
  }

  const linha = [];
  for (let h = 47; h >= 0; h--) {
    const ini = agora - (h + 1) * HORA;
    const fim = agora - h * HORA;
    const daHora = sinais.filter((s) => s.at >= ini && s.at < fim);
    linha.push({ at: fim, total: daHora.length, falhas: daHora.filter((s) => s.st === 'failed').length });
  }

  const cats = {};
  for (const s of dia) if (s.st === 'failed') cats[s.cat || 'nenhuma'] = (cats[s.cat || 'nenhuma'] || 0) + 1;

  return {
    resumo: {
      execucoes: dia.length,
      falhas: dia.filter((s) => s.st === 'failed').length,
      qas: new Set(dia.map((s) => s.c)).size,
      sites: new Set(dia.map((s) => s.s)).size,
      tempoMedio: dia.length ? Math.round(dia.reduce((n, s) => n + (s.ms || 0), 0) / dia.length) : 0,
    },
    mapa: mapa.sort((a, b) => b.taxa - a.taxa || b.total - a.total),
    alertas: alertas.sort((a, b) => b.falhas - a.falhas),
    linha,
    categorias: Object.entries(cats).map(([cat, n]) => ({ cat, rotulo: label(cat), origem: origem(cat), n })).sort((a, b) => b.n - a.n),
  };
}

export function textoDoBug(a) {
  const antes = a.taxaAntes === null ? 'Sem execuções nos 7 dias anteriores.' : `Nos 7 dias anteriores falhava em ${Math.round(a.taxaAntes * 100)}% de ${a.execucoesAntes} execuções.`;
  return {
    name: `[Radar QA] ${a.nome} ${a.fluxo}: ${a.rotulo}`,
    markdown_description: [
      `O radar do Panda QA Recorder detectou uma quebra nova em **${a.nome}**, no trecho \`${a.fluxo}\`.`,
      '',
      `- ${a.falhas} de ${a.total} execuções falharam desde ${new Date(a.desde).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}, com ${a.clientes} QAs diferentes.`,
      `- ${antes}`,
      `- Diagnóstico mais comum: ${a.rotulo}${a.origem ? ` (origem provável: ${a.origem})` : ''}.`,
      '',
      'Para reproduzir, peça a um dos QAs o JSON da falha (Compartilhar > Para o dev).',
    ].join('\n'),
  };
}
