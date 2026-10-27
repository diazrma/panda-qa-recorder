// Chave do time: a que o admin gerou (estado/chave.json) ou, enquanto nenhuma foi gerada, a da
// variável EQUIPE_CHAVE. Fica em memória por 30 s para não ler o armazenamento a cada pedido;
// trocar pelo admin vale na hora nesta instância e em até 30 s nas outras.
import { randomBytes } from 'node:crypto';
import { gravar, lerJSON } from './armazem.js';

let cache = null;

export async function chaveDoTime() {
  if (cache && Date.now() - cache.lidoEm < 30e3) return cache.info;
  const salva = await lerJSON('estado/chave.json');
  const info = salva?.chave ? { chave: salva.chave, at: salva.at, origem: 'admin' } : { chave: process.env.EQUIPE_CHAVE || '', at: null, origem: 'vercel' };
  cache = { info, lidoEm: Date.now() };
  return info;
}

export async function trocarChave() {
  const info = { chave: `pqa-${randomBytes(12).toString('hex')}`, at: Date.now() };
  await gravar('estado/chave.json', info);
  cache = { info: { ...info, origem: 'admin' }, lidoEm: Date.now() };
  return cache.info;
}
