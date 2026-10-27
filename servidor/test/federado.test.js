import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DADOS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'panda-qa-'));
delete process.env.BLOB_READ_WRITE_TOKEN;

const fed = await import('../federado.js');
const { tf } = fed;
const { fineTune, flatWeights, vectorize, tokensOf, KEYS, setFlatWeights } = await import('../../lib/diagnosis.js');

const b64 = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString('base64');

// Caso que o modelo base erra (responde "dado já cadastrado") e os QAs corrigem para "business".
const novo = { stepType: 'click', stepLabel: 'Comprar', error: 'Elemento não encontrado: Comprar', messages: ['Este produto está indisponível para a sua região'], logs: [] };
const prever = (model, f) => KEYS[tf.tidy(() => model.predict(tf.tensor2d([Array.from(vectorize(tokensOf(f)))])).argMax(-1).dataSync()[0])];

async function contribuicaoDe(versao, exemplos) {
  const model = await fed.carregarVersao(versao);
  const base = Float32Array.from(flatWeights(model));
  await fineTune(tf, model, exemplos);
  return flatWeights(model).map((w, i) => w - base[i]);
}

before(async () => {
  await fed.salvarConfig({ minClientes: 3, autoBug: false, janelaHoras: 2, sites: {} });
});

test('primeira versão é o modelo base da extensão', async () => {
  const atual = await fed.garantirInicial();
  assert.equal(atual.versao, 1);
  assert.ok(atual.acuracia > 0.95, `acerto ${atual.acuracia}`);
});

test('rodada: aceita os QAs honestos, rejeita o sabotador e aprende o caso novo', async () => {
  const v1 = await fed.carregarVersao(1);
  const antes = prever(v1, novo);
  assert.notEqual(antes, 'business');
  const honesto = [{ label: 'business', failure: novo }, { label: 'business', failure: { ...novo, messages: ['Produto indisponível para entrega na sua região'] } }];
  const dA = await contribuicaoDe(1, honesto);
  const dB = await contribuicaoDe(1, honesto.slice(0, 1));
  // Sabotador: empurra toda resposta para "config" pela última camada, dentro do limite de tamanho.
  const dC = new Float32Array(dA.length);
  const k = KEYS.length;
  const inicio = dC.length - k - 48 * k;
  for (let row = 0; row < 48; row++) dC[inicio + row * k + KEYS.indexOf('config')] = 9.5 / Math.sqrt(48);

  let r = await fed.receberContribuicao({ cliente: 'qaA', base: 1, n: 2, delta: b64(dA) });
  assert.equal(r.aguardando, 2);
  r = await fed.receberContribuicao({ cliente: 'qaB', base: 1, n: 1, delta: b64(dB) });
  r = await fed.receberContribuicao({ cliente: 'sabotador', base: 1, n: 500, delta: b64(dC) });
  const rodada = r.rodada;
  console.log(`  antes: ${antes} · rodada: ${JSON.stringify({ accBase: rodada.accBase, accNova: rodada.accNova, aceitos: rodada.aceitos, rejeitados: rodada.rejeitados.map((x) => `${x.cliente}: ${x.motivo}`) })}`);
  assert.equal(rodada.publicado, 2);
  assert.deepEqual(rodada.aceitos.map((a) => a.cliente).sort(), ['qaA', 'qaB']);
  assert.deepEqual(rodada.rejeitados.map((a) => a.cliente), ['sabotador']);
  assert.ok(rodada.accNova >= rodada.accBase - 0.02);
  const v2 = await fed.carregarVersao(2);
  assert.equal(prever(v2, novo), 'business');
  assert.equal((await fed.estado()).versao, 2);
});

test('contribuição de versão velha é recusada sem quebrar', async () => {
  const d = new Float32Array(flatWeights(fed.novoModelo()).length);
  const r = await fed.receberContribuicao({ cliente: 'qaA', base: 1, n: 1, delta: b64(d) });
  assert.equal(r.ok, false);
  await assert.rejects(fed.receberContribuicao({ cliente: 'qaA', base: 2, n: 1, delta: b64(new Float32Array(10)) }), /pesos/);
});

test('voltar para a versão anterior', async () => {
  await fed.ativarVersao(1);
  assert.equal((await fed.estado()).versao, 1);
  assert.deepEqual((await fed.listarVersoes()).map((v) => v.versao), [1, 2]);
  await fed.ativarVersao(2);
});

test('servidor classifica a falha a partir só do vetor esparso', async () => {
  const { sparseVector } = await import('../../lib/anon.js');
  const { model } = await fed.modeloAtual();
  const [r] = fed.classificar(model, [Array.from(fed.deEsparso(sparseVector({ stepType: 'click', error: 'Elemento não encontrado: Comprar', messages: [], logs: [{ kind: 'http', text: '500 POST https://x/rest/V1/carts/mine' }] })))]);
  assert.equal(r.categoria, 'server');
});
