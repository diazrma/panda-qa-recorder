/**
 * Treina o modelo base do diagnóstico e grava em lib/model/ (model.json + pesos),
 * para a extensão não precisar treinar no primeiro uso. Rodar quando mudar lib/diagnosis.js.
 * Uso: node scripts/train-model.mjs
 */
import * as tf from '@tensorflow/tfjs';
import fs from 'node:fs';
import path from 'node:path';
import { trainOn, seedExamples, vectorize, tokensOf, CATEGORIES } from '../lib/diagnosis.js';

const outDir = path.resolve(import.meta.dirname, '../lib/model');
fs.mkdirSync(outDir, { recursive: true });

const t0 = Date.now();
const model = await trainOn(tf);
const keys = CATEGORIES.map((c) => c.key);
const seed = seedExamples();
const xs = tf.tensor2d(seed.map((e) => Array.from(vectorize(tokensOf(e.failure)))));
const pred = model.predict(xs).argMax(-1).dataSync();
const acc = seed.filter((e, i) => keys[pred[i]] === e.label).length / seed.length;

await model.save(tf.io.withSaveHandler(async (artifacts) => {
  const weights = Buffer.from(artifacts.weightData);
  fs.writeFileSync(path.join(outDir, 'weights.bin'), weights);
  fs.writeFileSync(path.join(outDir, 'model.json'), JSON.stringify({
    modelTopology: artifacts.modelTopology,
    format: artifacts.format,
    generatedBy: artifacts.generatedBy,
    convertedBy: null,
    weightsManifest: [{ paths: ['weights.bin'], weights: artifacts.weightSpecs }],
  }));
  return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' } };
}));
console.log(`modelo salvo em ${outDir} (${Date.now() - t0} ms, acurácia nos exemplos-base: ${(acc * 100).toFixed(1)}%)`);
