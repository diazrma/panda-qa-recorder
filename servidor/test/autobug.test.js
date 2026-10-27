import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DADOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'panda-qa-bug-'));
process.env.CLICKUP_TOKEN = 'pk_x';
process.env.CLICKUP_LISTA = '123';
delete process.env.BLOB_READ_WRITE_TOKEN;

const criadas = [];
const fetchReal = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith('https://api.clickup.com/')) {
    criadas.push(JSON.parse(opts.body).name);
    return new Response(JSON.stringify({ id: 't' + criadas.length, url: 'https://app.clickup.com/t/x' }), { status: 200 });
  }
  return fetchReal(url, opts);
};

const { receberSinais } = await import('../sinais.js');
const { salvarConfig, config } = await import('../federado.js');
const { sparseVector } = await import('../../lib/anon.js');

const v = sparseVector({ stepType: 'click', error: 'Elemento não encontrado: Comprar', messages: [], logs: [{ kind: 'http', text: '500 POST https://x/rest/V1/carts/mine' }] });
const quebra = (site) => ['qa1', 'qa2', 'qa3'].map((c, i) => ({ cliente: c, sinais: [{ s: site, f: '/checkout', t: 't1', st: 'failed', ms: 1, at: Date.now() - (i + 1) * 60e3, v }] }));

test('com o bug automático desligado (padrão) nenhuma tarefa é criada', async () => {
  assert.equal((await config()).autoBug, false);
  for (const lote of quebra('sA')) await receberSinais(lote);
  assert.deepEqual(criadas, []);
});

test('ligado, cria uma tarefa por quebra nova, uma vez só', async () => {
  await salvarConfig({ ...(await config()), autoBug: true });
  for (const lote of quebra('sB')) await receberSinais(lote);
  for (const lote of quebra('sB')) await receberSinais(lote);
  assert.equal(criadas.length, 2); // sA (que ficou sem bug) e sB, cada uma uma vez
  assert.equal(new Set(criadas).size, 2);
});
