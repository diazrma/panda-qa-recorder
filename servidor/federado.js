// Aprendizado federado do diagnóstico. Cada extensão ajusta o modelo do time com as correções
// do próprio QA e manda só a diferença de pesos. Aqui as diferenças viram uma rodada:
//   1. cada contribuição é limitada em tamanho (norma) e testada sozinha nos casos de referência;
//      a que piora o modelo é rejeitada (correção errada ou mal-intencionada);
//   2. as aceitas entram na média ponderada pelo número de correções (FedAvg);
//   3. o modelo novo só é publicado se não errar mais que o atual.
import fs from 'node:fs/promises';
import path from 'node:path';
import * as tf from '@tensorflow/tfjs';
import { buildModel, seedExamples, vectorize, tokensOf, KEYS, flatWeights, setFlatWeights } from '../lib/diagnosis.js';
import { gravar, ler, lerJSON, listar, apagar, lerTodosJSON } from './armazem.js';

export { tf };

const NORMA_MAX = 10; // tamanho máximo de uma contribuição (as normais ficam perto de 6)
const PIORA_MAX = 0.05; // uma contribuição sozinha pode tirar no máximo 5 pontos de acerto
const TOLERANCIA = 0.02; // o modelo da rodada pode perder no máximo 2 pontos
const PESO_MAX = 10; // o servidor não confere o número de correções declarado: ninguém vale mais que 10 na média

let pronto;
const iniciar = () => (pronto ||= tf.setBackend('cpu').then(() => tf.ready()));

// Casos de referência: gerados com outra semente, para não serem os mesmos do treino.
let referencia;
function casosReferencia() {
  if (!referencia) {
    const ex = seedExamples(20, 4242);
    referencia = { xs: ex.map((e) => Array.from(vectorize(tokensOf(e.failure)))), ys: ex.map((e) => KEYS.indexOf(e.label)) };
  }
  return referencia;
}

export function novoModelo() {
  return buildModel(tf);
}

export function acuracia(model) {
  const { xs, ys } = casosReferencia();
  const pred = tf.tidy(() => model.predict(tf.tensor2d(xs)).argMax(-1).dataSync());
  return ys.filter((y, i) => pred[i] === y).length / ys.length;
}

export function classificar(model, vetores) {
  if (!vetores.length) return [];
  return tf.tidy(() => {
    const probs = model.predict(tf.tensor2d(vetores)).arraySync();
    return probs.map((p) => {
      const i = p.indexOf(Math.max(...p));
      return { categoria: KEYS[i], confianca: p[i] };
    });
  });
}

export const deEsparso = (v) => {
  const out = new Float32Array(1024);
  for (const [i, x] of Object.entries(v || {})) if (Number(i) >= 0 && Number(i) < 1024) out[Number(i)] = Math.min(3, Number(x) || 0);
  return out;
};

// ---------- (de)serialização ----------

export function pesosDeBase64(b64) {
  const buf = Buffer.from(String(b64 || ''), 'base64');
  return new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
}

export async function modeloDeArquivos(json, pesos) {
  await iniciar();
  const m = JSON.parse(json.toString());
  const data = new Uint8Array(pesos).buffer;
  return tf.loadLayersModel(tf.io.fromMemory({ modelTopology: m.modelTopology, weightSpecs: m.weightsManifest[0].weights, weightData: data }));
}

export async function arquivosDoModelo(model) {
  let out;
  await model.save(tf.io.withSaveHandler(async (a) => {
    out = {
      json: JSON.stringify({ modelTopology: a.modelTopology, format: a.format, generatedBy: a.generatedBy, convertedBy: null, weightsManifest: [{ paths: ['weights.bin'], weights: a.weightSpecs }] }),
      pesos: Buffer.from(a.weightData),
    };
    return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
  }));
  return out;
}

// ---------- estado ----------

export async function estado() {
  return lerJSON('estado/atual.json');
}

export async function config() {
  return { minClientes: 2, autoBug: false, janelaHoras: 2, sites: {}, ...(await lerJSON('estado/config.json', {})) };
}

export const salvarConfig = (c) => gravar('estado/config.json', c);

/** Primeira versão: o mesmo modelo base que vai dentro da extensão (lib/model). */
export async function garantirInicial() {
  const atual = await estado();
  if (atual) return atual;
  await iniciar();
  const dir = path.resolve(import.meta.dirname, '../lib/model');
  const [json, pesos] = await Promise.all([fs.readFile(path.join(dir, 'model.json')), fs.readFile(path.join(dir, 'weights.bin'))]);
  const model = await modeloDeArquivos(json, pesos);
  return publicar(1, json, pesos, { acuracia: acuracia(model), origem: 'modelo base da extensão', participantes: 0 });
}

async function publicar(versao, json, pesos, info) {
  await gravar(`modelos/${versao}/model.json`, json);
  await gravar(`modelos/${versao}/weights.bin`, pesos, 'application/octet-stream');
  const meta = { versao, at: Date.now(), ...info };
  await gravar(`versoes/${versao}.json`, meta);
  await gravar('estado/atual.json', { versao, acuracia: info.acuracia, at: meta.at });
  return { versao, acuracia: info.acuracia, at: meta.at };
}

export async function carregarVersao(versao) {
  const [json, pesos] = await Promise.all([ler(`modelos/${versao}/model.json`), ler(`modelos/${versao}/weights.bin`)]);
  if (!json || !pesos) return null;
  return modeloDeArquivos(json, pesos);
}

export async function modeloAtual() {
  const atual = await garantirInicial();
  return { atual, model: await carregarVersao(atual.versao) };
}

// ---------- contribuições e rodadas ----------

export async function receberContribuicao({ cliente, base, n, delta }) {
  const atual = await garantirInicial();
  const pesos = pesosDeBase64(delta);
  const total = flatWeights(novoModelo()).length;
  if (pesos.length !== total) throw Object.assign(new Error(`Contribuição com ${pesos.length} pesos; o modelo tem ${total}.`), { status: 400 });
  if (!pesos.every(Number.isFinite)) throw Object.assign(new Error('Contribuição com valores inválidos.'), { status: 400 });
  if (Number(base) !== atual.versao) return { ok: false, motivo: `Contribuição feita sobre a v${base}; a atual é a v${atual.versao}. A extensão vai baixar a nova e refazer.` };
  const id = `${Date.now()}-${String(cliente).replace(/[^\w-]/g, '').slice(0, 20)}`;
  // Uma contribuição por QA por rodada: a nova substitui a anterior do mesmo QA.
  const antigas = (await listar(`contrib/${atual.versao}/`)).filter((c) => c.chave.endsWith(`-${String(cliente).replace(/[^\w-]/g, '').slice(0, 20)}.json`));
  await apagar(antigas.map((c) => c.chave));
  await gravar(`contrib/${atual.versao}/${id}.json`, { id, cliente, base: atual.versao, n: Math.max(1, Math.min(500, Number(n) || 1)), at: Date.now(), delta });
  const pendentes = await listar(`contrib/${atual.versao}/`);
  const cfg = await config();
  if (pendentes.length >= cfg.minClientes) return { ok: true, rodada: await fecharRodada() };
  return { ok: true, aguardando: cfg.minClientes - pendentes.length };
}

function norma(v) {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

/** Junta as contribuições pendentes da versão atual. Publica uma versão nova se melhorar (ou não piorar). */
export async function fecharRodada() {
  await iniciar();
  const atual = await garantirInicial();
  const contribs = (await lerTodosJSON(`contrib/${atual.versao}/`)).map((c) => c.dados);
  if (!contribs.length) return { publicado: false, motivo: 'Nenhuma contribuição pendente.' };

  const base = await carregarVersao(atual.versao);
  const baseFlat = Float32Array.from(flatWeights(base));
  const accBase = acuracia(base);
  const teste = novoModelo();
  const aceitos = [];
  const rejeitados = [];
  for (const c of contribs) {
    const d = pesosDeBase64(c.delta);
    const nrm = norma(d);
    const escala = nrm > NORMA_MAX ? NORMA_MAX / nrm : 1;
    const sozinho = baseFlat.map((w, i) => w + d[i] * escala);
    setFlatWeights(tf, teste, sozinho);
    const acc = acuracia(teste);
    const resumo = { cliente: c.cliente, n: c.n, acuracia: acc, norma: Number(nrm.toFixed(3)), limitada: escala < 1 };
    if (acc < accBase - PIORA_MAX) rejeitados.push({ ...resumo, motivo: `sozinha derrubaria o acerto para ${(acc * 100).toFixed(1)}%` });
    else aceitos.push({ ...resumo, d, escala });
  }

  const historico = await lerJSON('estado/rodadas.json', []);
  const rodada = { n: historico.length + 1, at: Date.now(), base: atual.versao, accBase, participantes: contribs.length, aceitos: aceitos.map(({ d, escala, ...r }) => r), rejeitados };

  if (aceitos.length) {
    const somaPesos = aceitos.reduce((s, a) => s + Math.min(PESO_MAX, a.n), 0);
    const novo = Float32Array.from(baseFlat);
    for (const a of aceitos) {
      const w = Math.min(PESO_MAX, a.n) / somaPesos;
      for (let i = 0; i < novo.length; i++) novo[i] += a.d[i] * a.escala * w;
    }
    setFlatWeights(tf, teste, novo);
    rodada.accNova = acuracia(teste);
    if (rodada.accNova >= accBase - TOLERANCIA) {
      const arq = await arquivosDoModelo(teste);
      const versoes = (await listar('versoes/')).map((m) => Number(m.chave.match(/(\d+)\.json$/)?.[1])).filter(Number.isFinite);
      const versao = Math.max(atual.versao, ...versoes) + 1;
      await publicar(versao, arq.json, arq.pesos, { acuracia: rodada.accNova, base: atual.versao, participantes: aceitos.length, exemplos: aceitos.reduce((s, a) => s + a.n, 0), rodada: rodada.n });
      rodada.publicado = versao;
    } else {
      rodada.motivo = `a média derrubaria o acerto de ${(accBase * 100).toFixed(1)}% para ${(rodada.accNova * 100).toFixed(1)}%`;
    }
  } else {
    rodada.motivo = 'todas as contribuições foram rejeitadas';
  }
  await apagar(contribs.map((c) => `contrib/${atual.versao}/${c.id}.json`));
  await gravar('estado/rodadas.json', [...historico, rodada].slice(-200));
  return rodada;
}

/** Volta (ou avança) o modelo do time para uma versão já publicada. */
export async function ativarVersao(versao) {
  const info = await lerJSON(`versoes/${Number(versao)}.json`);
  if (!info) throw Object.assign(new Error(`Versão ${versao} não existe.`), { status: 404 });
  await gravar('estado/atual.json', { versao: info.versao, acuracia: info.acuracia, at: Date.now(), ativadaManualmente: true });
  return info;
}

export async function listarVersoes() {
  return (await lerTodosJSON('versoes/')).map((m) => m.dados).sort((a, b) => a.versao - b.versao);
}

/** Descarta o aprendizado do time e publica o modelo base como a versão mais recente. */
export async function resetarAprendizado() {
  const atual = await estado();
  const historico = await listarVersoes();
  const versao = Math.max(atual?.versao || 0, ...historico.map((item) => item.versao)) + 1;
  const dir = path.resolve(import.meta.dirname, '../lib/model');
  const [json, pesos] = await Promise.all([
    fs.readFile(path.join(dir, 'model.json')),
    fs.readFile(path.join(dir, 'weights.bin')),
  ]);
  const base = await modeloDeArquivos(json, pesos);
  const acerto = acuracia(base);
  base.dispose();

  const [modelos, versoes, contribuicoes, rodadas] = await Promise.all([
    listar('modelos/'),
    listar('versoes/'),
    listar('contrib/'),
    listar('estado/rodadas.json'),
  ]);
  await apagar([...modelos, ...versoes, ...contribuicoes, ...rodadas].map((item) => item.chave));
  const publicada = await publicar(versao, json, pesos, {
    acuracia: acerto,
    origem: 'modelo base após reset do aprendizado',
    participantes: 0,
  });
  return {
    ...publicada,
    versoesRemovidas: versoes.length,
    contribuicoesRemovidas: contribuicoes.length,
    rodadasRemovidas: rodadas.length,
  };
}
