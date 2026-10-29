// Projeto automático: a extensão manda o endereço do site (só origem, sem caminho) junto com o
// apelido. O servidor confere que o endereço gera o mesmo apelido, dá ao site o nome do host e o
// coloca no projeto do cliente, tirado do domínio (qa.metlife.cl e metlife.test -> "Metlife").
// Cada site passa por aqui uma vez só: depois disso, nome e projeto ficam com o que o admin decidir.
import { randomUUID } from 'node:crypto';
import { siteAlias } from '../lib/anon.js';
import { config, salvarConfig } from './federado.js';

// Domínios de hospedagem: o nome do cliente está no primeiro rótulo, não no domínio.
const HOSPEDAGEM = ['magentosite.cloud', 'magento.cloud', 'vercel.app', 'netlify.app', 'ngrok-free.app', 'ngrok.io', 'herokuapp.com', 'github.io', 'pages.dev'];
// Pedaços do nome que indicam ambiente, não cliente.
const AMBIENTE = new Set(('www www2 m mcstaging mcprod mcdev prod production producao staging stg stage qa dev develop desenvolvimento '
  + 'hml homolog homologacao local localhost integration integracao int test teste testes uat preprod pre sandbox demo admin loja store shop').split(' '));
const SEGUNDO_NIVEL = new Set(['com', 'net', 'org', 'gov', 'edu', 'co', 'ind', 'gob']);

/** Nome do projeto a partir do host, ou null quando não dá para saber o cliente (IP, localhost, hash de nuvem). */
export function projetoDoHost(host) {
  const h = String(host || '').toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '');
  if (!h || !h.includes('.') || /^[\d.]+$/.test(h) || h.includes(':')) return null;
  let rotulos = h.split('.');
  let candidato;
  const hospedagem = HOSPEDAGEM.find((d) => h === d || h.endsWith('.' + d));
  if (hospedagem) {
    candidato = rotulos[0];
  } else {
    const n = rotulos.length;
    const sufixo = n >= 3 && rotulos[n - 1].length === 2 && SEGUNDO_NIVEL.has(rotulos[n - 2]) ? 2 : 1;
    rotulos = rotulos.slice(0, n - sufixo);
    candidato = rotulos[rotulos.length - 1];
  }
  const partes = String(candidato || '').split(/[-_]/).filter((p) => p && !AMBIENTE.has(p) && !(/\d/.test(p) && p.length >= 6));
  const nome = partes.join(' ').trim();
  if (nome.length < 2) return null;
  return nome.replace(/(^|\s)\p{L}/gu, (l) => l.toUpperCase()).slice(0, 60);
}

const normal = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

/** Projeto existente que corresponde ao nome: mesmo nome, ou o nome do domínio começa pelo do projeto (MetLife -> metlifesegurosonline). */
export function acharProjeto(projetos, nome) {
  const chave = normal(nome);
  const lista = Object.entries(projetos || {});
  return (lista.find(([, p]) => normal(p.nome) === chave)
    || lista.find(([, p]) => normal(p.nome).length >= 4 && chave.startsWith(normal(p.nome))) || [])[0] || null;
}

/**
 * Recebe { apelido: origem } das extensões e, para cada site ainda não visto, dá o nome do host e
 * coloca no projeto. Origem que não bate com o apelido é ignorada. Só grava a config quando muda algo.
 */
export async function registrarSites(origens) {
  if (!origens || typeof origens !== 'object') return 0;
  const novos = [];
  for (const [alias, origem] of Object.entries(origens).slice(0, 50)) {
    let u;
    try {
      u = new URL(String(origem));
    } catch {
      continue;
    }
    if (!/^https?:$/.test(u.protocol) || siteAlias(u.origin) !== alias) continue;
    novos.push([alias, u]);
  }
  if (!novos.length) return 0;
  const cfg = await config();
  const vistos = { ...cfg.sitesAuto };
  const pendentes = novos.filter(([alias]) => !vistos[alias]);
  if (!pendentes.length) return 0;
  const sites = { ...cfg.sites };
  const projetos = Object.fromEntries(Object.entries(cfg.projetos || {}).map(([id, p]) => [id, { ...p, sites: [...(p.sites || [])] }]));
  const emProjeto = new Set(Object.values(projetos).flatMap((p) => p.sites));
  for (const [alias, u] of pendentes) {
    vistos[alias] = Date.now();
    if (!sites[alias]) sites[alias] = u.host.slice(0, 60);
    if (emProjeto.has(alias)) continue;
    const nome = projetoDoHost(u.hostname);
    if (!nome) continue;
    const id = acharProjeto(projetos, nome) || `p${randomUUID().slice(0, 8)}`;
    projetos[id] ||= { nome, sites: [] };
    projetos[id].sites.push(alias);
    emProjeto.add(alias);
  }
  await salvarConfig({ ...cfg, sites, projetos, sitesAuto: vistos });
  return pendentes.length;
}
