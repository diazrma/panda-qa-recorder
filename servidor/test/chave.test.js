import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DADOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'panda-qa-chave-'));
process.env.EQUIPE_CHAVE = 'chave-da-vercel-123';
process.env.ADMIN_SENHA = 'senha-admin-123456';
delete process.env.BLOB_READ_WRITE_TOKEN;

const { criarServidor } = await import('../dev.js');
const srv = criarServidor();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
const modelo = (chave) => fetch(`${base}/api/modelo`, { headers: { 'x-equipe': chave } }).then((r) => r.status);
const admin = (acao) => fetch(`${base}/api/admin`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-senha': process.env.ADMIN_SENHA }, body: JSON.stringify({ acao }) }).then((r) => r.json());
const entrar = (id, chave) => fetch(`${base}/relatorio/${id}`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `chave=${chave}` });

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
  srv.close();
});
