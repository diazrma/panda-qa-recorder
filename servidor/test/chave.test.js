import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DADOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'panda-qa-chave-'));
process.env.EQUIPE_CHAVE = 'chave-da-vercel-123';
process.env.ADMIN_SENHA = 'senha-admin-123456';
delete process.env.BLOB_READ_WRITE_TOKEN;

const { criarServidor } = await import('../dev.js');
const { gravar, listar, lerJSON } = await import('../armazem.js');
const fed = await import('../federado.js');
const srv = criarServidor();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const modelo = (chave) => fetch(`${base}/api/modelo`, { headers: { 'x-equipe': chave } }).then((r) => r.status);
const admin = (acao, extra = {}) => fetch(`${base}/api/admin`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-senha': process.env.ADMIN_SENHA }, body: JSON.stringify({ acao, ...extra }) }).then((r) => r.json());
const entrar = (id, chave) => fetch(`${base}/relatorio/${id}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `chave=${chave}` });
after(() => new Promise((resolve, reject) => srv.close((error) => error ? reject(error) : resolve())));

test('sem chave gerada no admin vale a da Vercel', async () => {
  assert.equal((await admin('chave')).origem, 'vercel');
  assert.equal(await modelo('chave-da-vercel-123'), 200);
});

test('gerar nova chave no admin troca na hora e derruba a antiga (API e links de relatório)', async () => {
  const up = await fetch(`${base}/api/relatorio`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-equipe': 'chave-da-vercel-123' }, body: JSON.stringify({ test: { name: 't', steps: [{ type: 'navigate', url: 'https://x.test/' }] }, run: { status: 'passed', results: [] } }) }).then((r) => r.json());
  const cookieVelho = (await entrar(up.id, 'chave-da-vercel-123')).headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${base}/relatorio/${up.id}`, { headers: { cookie: cookieVelho } })).status, 200);

  const nova = await admin('trocarChave');
  assert.match(nova.chave, /^pqa-[0-9a-f]{24}$/);
  assert.equal((await admin('chave')).chave, nova.chave);
  assert.equal(await modelo('chave-da-vercel-123'), 401);
  assert.equal(await modelo(nova.chave), 200);
  assert.equal((await fetch(`${base}/relatorio/${up.id}`, { headers: { cookie: cookieVelho } })).status, 401);
  assert.equal((await entrar(up.id, nova.chave)).status, 303);
  const painel = await admin('painel');
  assert.equal(painel.chave.origem, 'admin');
  assert.equal(painel.chave.chave, undefined); // o painel não manda a chave; só o "Mostrar"
});

test('reset admin limpa aprendizado e radar, mas mantém a chave e regras do time', async () => {
  const inicial = await fed.garantirInicial();
  await admin('site', { alias: 'site123', nome: 'Loja de teste' });
  await gravar('contrib/1/1-qa.json', { id: '1-qa', cliente: 'qa', base: 1 });
  await gravar('estado/rodadas.json', [{ n: 1, at: Date.now() }]);
  await gravar('sinais/2026-10-27/1-teste.json', [{ s: 'site123', st: 'failed' }]);
  await gravar('estado/bugs.json', { erro: { id: '1', url: 'https://clickup.test/task' } });

  const reset = await admin('resetar');
  assert.equal(reset.ok, true);
  assert.ok(reset.aprendizado.versao > inicial.versao);
  assert.equal(reset.aprendizado.versoesRemovidas, 1);
  assert.equal(reset.aprendizado.contribuicoesRemovidas, 1);
  assert.equal(reset.aprendizado.rodadasRemovidas, 1);
  assert.equal(reset.sinaisRemovidos, 1);
  assert.equal(reset.bugsRemovidos, 1);
  assert.equal(reset.sitesRemovidos, 1);
  assert.deepEqual((await fed.listarVersoes()).map((v) => v.versao), [reset.aprendizado.versao]);
  assert.equal((await fed.listarVersoes())[0].origem, 'modelo base após reset do aprendizado');
  assert.deepEqual(await listar('contrib/'), []);
  assert.deepEqual(await listar('sinais/'), []);
  assert.deepEqual(await lerJSON('estado/rodadas.json', []), []);
  assert.deepEqual(await lerJSON('estado/bugs.json', {}), {});
  const painel = await admin('painel');
  assert.deepEqual(painel.config.sites, {});
  assert.equal(painel.config.minClientes, 2);
  assert.equal(painel.chave.chave, undefined);
});
