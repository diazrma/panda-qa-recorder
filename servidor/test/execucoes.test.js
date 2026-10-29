import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DADOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'panda-qa-execucoes-'));
process.env.EQUIPE_CHAVE = 'chave-do-time-123';
process.env.ADMIN_SENHA = 'senha-admin-123456';
delete process.env.BLOB_READ_WRITE_TOKEN;

const { criarServidor } = await import('../dev.js');
const { fitShots } = await import('../../lib/team.js');
const srv = criarServidor();
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${srv.address().port}`;
after(() => new Promise((resolve, reject) => srv.close((error) => error ? reject(error) : resolve())));

const PRINT = 'data:image/jpeg;base64,' + Buffer.from('jpeg-de-teste').toString('base64');
const admin = (acao, extra = {}) => fetch(`${base}/api/admin`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-senha': process.env.ADMIN_SENHA }, body: JSON.stringify({ acao, ...extra }) }).then((r) => r.json());
const enviar = (corpo, chave = process.env.EQUIPE_CHAVE) => fetch(`${base}/api/execucao`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-equipe': chave }, body: JSON.stringify(corpo) });
const execucao = (cliente, nome, s, extra = {}) => ({
  cliente, nome, s, t: 'tLogin',
  teste: { name: 'Login do cliente', steps: [{ type: 'navigate', url: '{{baseUrl}}/customer/account/login' }, { type: 'click', label: 'Entrar', selectors: [{ css: '#send2' }] }, { type: 'assertText', label: 'título', selectors: [{ css: 'h1' }], value: 'Bem-vindo' }] },
  run: { status: 'failed', at: Date.now(), ms: 4200, failedIndex: 2, error: 'Texto não encontrado: Bem-vindo', results: [{ status: 'passed', ms: 900 }, { status: 'passed', ms: 700 }, { status: 'failed', ms: 2600, error: 'Texto não encontrado: Bem-vindo' }], diagnostics: { messages: ['O login ou a senha estão incorretos.'] } },
  shots: { 0: PRINT, 1: PRINT, 2: PRINT, 7: PRINT, 3: '<script>' },
  ...extra,
});

test('sem a chave do time a execução é recusada', async () => {
  assert.equal((await enviar(execucao('qa1', 'Ana', 'sMet'), 'errada-errada')).status, 401);
});

test('guarda a última execução por teste e QA, com prints válidos e a descrição dos passos', async () => {
  const r = await enviar(execucao('qa1', 'Ana', 'sMet')).then((x) => x.json());
  assert.deepEqual(r, { ok: true, id: 'qa1-tLogin', prints: 3 }, 'print fora dos passos e texto que não é imagem são descartados');
  await enviar(execucao('qa2', 'Bruno', 'sMue', { shots: {} }));

  const painel = await admin('painel');
  assert.equal(painel.execucoes.length, 2);
  const ana = painel.execucoes.find((e) => e.c === 'qa1');
  assert.equal(ana.q, 'Ana');
  assert.equal(ana.status, 'failed');
  assert.equal(ana.falhou, 2);
  assert.equal(ana.prints, 3);
  assert.equal(ana.shots, undefined, 'a lista não carrega os prints');

  const completo = await admin('execucao', { id: 'qa1-tLogin' });
  assert.deepEqual(Object.keys(completo.shots), ['0', '1', '2']);
  assert.equal(completo.descs[1], 'Clicar em "Entrar"');
  assert.deepEqual(completo.messages, ['O login ou a senha estão incorretos.']);
});

test('reenviar o mesmo teste troca a execução em vez de acumular', async () => {
  const passou = execucao('qa1', 'Ana', 'sMet');
  passou.run = { ...passou.run, status: 'passed', failedIndex: -1, error: null, at: Date.now() + 1 };
  await enviar(passou);
  const painel = await admin('painel');
  assert.equal(painel.execucoes.filter((e) => e.c === 'qa1').length, 1);
  assert.equal(painel.execucoes.find((e) => e.c === 'qa1').status, 'passed');
});

test('a seção Testes respeita o filtro de projeto e de QA', async () => {
  const { id } = await admin('projeto', { nome: 'MetLife', sites: ['sMet'] });
  assert.deepEqual((await admin('painel', { filtro: { projeto: id } })).execucoes.map((e) => e.c), ['qa1']);
  assert.deepEqual((await admin('painel', { filtro: { projeto: '-' } })).execucoes.map((e) => e.c), ['qa2']);
  assert.deepEqual((await admin('painel', { filtro: { qa: 'qa2' } })).execucoes.map((e) => e.q), ['Bruno']);
  assert.ok((await admin('painel', { filtro: { qa: 'qa2' } })).radar.qas.length === 0, 'QA só com execuções não precisa de sinal do radar');
});

test('remover tira a execução do painel e o reset apaga todas', async () => {
  await admin('execucaoDel', { id: 'qa2-tLogin' });
  assert.deepEqual((await admin('painel')).execucoes.map((e) => e.c), ['qa1']);
  const reset = await admin('resetar');
  assert.equal(reset.execucoesRemovidas, 1);
  assert.equal((await admin('painel')).execucoes.length, 0);
});

test('fitShots corta prints de passos que passaram até caber, e mantém o da falha', () => {
  const grande = 'x'.repeat(1_000_000);
  const out = fitShots({ 0: grande, 1: grande, 2: grande, 3: grande, 4: grande }, 0);
  assert.deepEqual(Object.keys(out), ['0', '3', '4']);
  assert.deepEqual(Object.keys(fitShots({ 0: 'a', 1: 'b' }, -1)), ['0', '1']);
});
