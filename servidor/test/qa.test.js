import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DADOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'panda-qa-painel-qa-'));
process.env.EQUIPE_CHAVE = 'chave-do-time-123';
process.env.ADMIN_SENHA = 'senha-admin-123456';
delete process.env.BLOB_READ_WRITE_TOKEN;

const { criarServidor } = await import('../dev.js');
const srv = criarServidor();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
after(() => new Promise((resolve, reject) => srv.close((error) => error ? reject(error) : resolve())));

const post = (rota, corpo, headers = { 'x-equipe': process.env.EQUIPE_CHAVE }) => fetch(`${base}${rota}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(corpo) });
const json = (r) => r.then((x) => x.json());
const admin = (acao, extra = {}) => json(post('/api/admin', { acao, ...extra }, { 'x-senha': process.env.ADMIN_SENHA }));
const doQa = (cliente, acao, extra = {}) => json(post('/api/qa', { acao, cliente, ...extra }));
const sinal = (s) => ({ s, f: '/checkout', t: 't1', st: 'passed', ms: 3000, at: Date.now() - 60e3 });
const execucao = (cliente, s, t) => post('/api/execucao', { cliente, nome: cliente, s, t, teste: { name: `Teste ${t}`, steps: [{ type: 'navigate', url: 'https://x.test/' }] }, run: { status: 'passed', results: [{ status: 'passed' }] } });

test('QA vê só as lojas em que testou, mais as do mesmo projeto, com as execuções do time nelas', async () => {
  await post('/api/sinal', { cliente: 'qa1', nome: 'Ana', sinais: [sinal('sMetStg')] });
  await post('/api/sinal', { cliente: 'qa2', nome: 'Bruno', sinais: [sinal('sMetLocal'), sinal('sMue')] });
  await execucao('qa2', 'sMetLocal', 'tA');
  await execucao('qa2', 'sMue', 'tB');
  await admin('projeto', { nome: 'MetLife', sites: ['sMetStg', 'sMetLocal'] });
  await admin('projeto', { nome: 'Mueller', sites: ['sMue'] });

  const p = await doQa('qa1', 'painel');
  assert.equal(p.qa, true);
  assert.equal(p.lojas, 2);
  assert.deepEqual(Object.values(p.config.projetos).map((x) => x.nome), ['MetLife']);
  assert.equal(p.radar.resumo.execucoes, 2, 'sinais do staging (Ana) e do local (Bruno) da MetLife');
  assert.deepEqual(p.execucoes.map((e) => e.s), ['sMetLocal']);
  assert.equal(p.atual, undefined, 'nada de admin no painel do QA');
  assert.equal(p.config.minClientes, undefined);

  const ex = await doQa('qa1', 'execucao', { id: 'qa2-tA' });
  assert.equal(ex.s, 'sMetLocal');
  const outra = await post('/api/qa', { acao: 'execucao', cliente: 'qa1', id: 'qa2-tB' });
  assert.equal(outra.status, 404, 'execução de loja de outro projeto não abre');
});

test('QA sem lojas vê painel vazio; sem chave ou sem id não entra', async () => {
  const vazio = await doQa('qaNovo', 'painel');
  assert.equal(vazio.lojas, 0);
  assert.equal(vazio.radar.resumo.execucoes, 0);
  assert.deepEqual(vazio.execucoes, []);
  assert.equal((await post('/api/qa', { acao: 'painel', cliente: 'qa1' }, { 'x-equipe': 'errada-errada' })).status, 401);
  assert.equal((await post('/api/qa', { acao: 'painel' })).status, 400);
  assert.equal((await post('/api/qa', { acao: 'projeto', cliente: 'qa1', nome: 'X' })).status, 400, 'ações de admin não existem aqui');
});
