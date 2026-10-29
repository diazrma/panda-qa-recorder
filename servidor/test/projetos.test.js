import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DADOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'panda-qa-projetos-'));
process.env.EQUIPE_CHAVE = 'chave-do-time-123';
process.env.ADMIN_SENHA = 'senha-admin-123456';
delete process.env.BLOB_READ_WRITE_TOKEN;

const { criarServidor } = await import('../dev.js');
const { limpaNome, listarQas, projetoDosSites } = await import('../sinais.js');
const srv = criarServidor();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
after(() => new Promise((resolve, reject) => srv.close((error) => error ? reject(error) : resolve())));

const H = 3600e3;
const admin = (acao, extra = {}) => fetch(`${base}/api/admin`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-senha': process.env.ADMIN_SENHA }, body: JSON.stringify({ acao, ...extra }) }).then((r) => r.json());
const enviar = (cliente, nome, sinais) => fetch(`${base}/api/sinal`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-equipe': process.env.EQUIPE_CHAVE }, body: JSON.stringify({ cliente, nome, sinais }) }).then((r) => r.json());
const sinal = (s, st, horasAtras) => ({ s, f: '/checkout', t: 't1', st, ms: 5000, at: Date.now() - horasAtras * H });

test('limpaNome tira caracteres estranhos e limita o tamanho', () => {
  assert.equal(limpaNome('  Ana   Souza <script> '), 'Ana Souza script');
  assert.equal(limpaNome('José D\'Ávila-Lima'), 'José D\'Ávila-Lima');
  assert.equal(limpaNome('x'.repeat(80)).length, 40);
  assert.equal(limpaNome(undefined), '');
});

test('listarQas usa o nome mais recente e conta só as últimas 24 h', () => {
  const agora = Date.now();
  const qas = listarQas([
    { c: 'a1', q: 'Ana', st: 'failed', at: agora - 30 * H },
    { c: 'a1', q: 'Ana Souza', st: 'passed', at: agora - H },
    { c: 'b2', st: 'failed', at: agora - 2 * H },
  ], agora);
  assert.deepEqual(qas.map((q) => [q.id, q.nome, q.execucoes, q.falhas]), [['a1', 'Ana Souza', 1, 0], ['b2', '', 1, 1]]);
});

test('projetoDosSites mapeia cada apelido de site para o projeto', () => {
  assert.deepEqual(projetoDosSites({ p1: { nome: 'MetLife', sites: ['sA', 'sB'] }, p2: { nome: 'Mueller', sites: ['sC'] } }), { sA: 'p1', sB: 'p1', sC: 'p2' });
});

test('painel separa por projeto e por QA, com o nome que veio da extensão', async () => {
  for (const [c, nome] of [['qa1', 'Ana'], ['qa2', 'Bruno']]) {
    await enviar(c, nome, [
      ...Array.from({ length: 4 }, (_, i) => sinal('sMet', 'passed', 10 + i)),
      sinal('sMet', 'failed', 0.5),
      sinal('sMet', 'failed', 0.3),
    ]);
  }
  await enviar('qa3', '', [sinal('sMue', 'passed', 1), sinal('sMue', 'failed', 0.2)]);

  const criado = await admin('projeto', { nome: 'MetLife', sites: ['sMet'] });
  assert.match(criado.id, /^p[0-9a-f]{8}$/);
  await admin('projeto', { nome: 'Mueller', sites: ['sMue'] });

  const geral = await admin('painel');
  assert.deepEqual(geral.radar.qas.map((q) => q.nome), ['Ana', 'Bruno', '']);
  assert.equal(geral.radar.resumo.execucoes, 14);
  assert.equal(geral.radar.alertas.length, 1);
  assert.equal(geral.radar.alertas[0].projeto, criado.id);
  assert.deepEqual(geral.radar.alertas[0].qas.sort(), ['qa1', 'qa2']);

  const met = await admin('painel', { filtro: { projeto: criado.id } });
  assert.equal(met.radar.resumo.execucoes, 12);
  assert.equal(met.radar.resumo.sites, 1);
  assert.ok(met.radar.mapa.every((m) => m.projeto === criado.id));

  const ana = await admin('painel', { filtro: { qa: 'qa1' } });
  assert.equal(ana.radar.resumo.execucoes, 6);
  assert.equal(ana.radar.resumo.qas, 1);
  assert.equal(ana.radar.alertas.length, 1, 'a quebra em que a Ana está entre os que falharam continua aparecendo');
  assert.equal(ana.radar.qas.length, 3, 'a lista de QAs do filtro não é recortada pelo próprio filtro');

  const qa3 = await admin('painel', { filtro: { qa: 'qa3' } });
  assert.equal(qa3.radar.alertas.length, 0);
});

test('um site fica em um projeto só e remover o projeto deixa o site sem projeto', async () => {
  const { id } = await admin('projeto', { nome: 'MetLife staging', sites: ['sMet'] });
  let painel = await admin('painel');
  const projetos = Object.values(painel.config.projetos);
  assert.equal(projetos.filter((p) => p.sites.includes('sMet')).length, 1);
  assert.deepEqual(painel.config.projetos[id].sites, ['sMet']);

  await admin('projeto', { id, nome: '' });
  painel = await admin('painel', { filtro: { projeto: '-' } });
  assert.equal(painel.config.projetos[id], undefined);
  assert.equal(painel.radar.resumo.execucoes, 12, 'os sinais do site sem projeto aparecem em "Sites sem projeto"');
});
