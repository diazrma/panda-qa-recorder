// Utilitários das funções da Vercel (mesmo formato req/res do Node).
import { timingSafeEqual } from 'node:crypto';
import { chaveDoTime } from './chave.js';

export function responder(res, status, corpo) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corpo));
}

export async function lerCorpo(req, maxBytes = 1_000_000) {
  const form = String(req.headers['content-type'] || '').includes('application/x-www-form-urlencoded');
  const decodificar = (txt) => (form ? Object.fromEntries(new URLSearchParams(txt)) : JSON.parse(txt || '{}'));
  if (req.body !== undefined && !Buffer.isBuffer(req.body)) return typeof req.body === 'string' ? decodificar(req.body) : req.body;
  const partes = [];
  let total = 0;
  for await (const p of req) {
    total += p.length;
    if (total > maxBytes) throw Object.assign(new Error('Pedido grande demais'), { status: 413 });
    partes.push(p);
  }
  return decodificar(Buffer.concat(partes).toString());
}

export const chaveDoTimeConfere = async (veio) => igual((await chaveDoTime()).chave, veio);

function igual(certa, veio) {
  const a = Buffer.from(certa || '');
  const b = Buffer.from(String(veio || ''));
  return a.length >= 8 && a.length === b.length && timingSafeEqual(a, b);
}

const usos = new Map();
export function limite(req, max, janelaMs) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim();
  const agora = Date.now();
  const lista = (usos.get(ip) || []).filter((t) => agora - t < janelaMs);
  if (lista.length >= max) throw Object.assign(new Error('Muitas tentativas. Espere alguns minutos.'), { status: 429 });
  lista.push(agora);
  usos.set(ip, lista);
}

/** Extensões do time: cabeçalho x-equipe = chave do time (gerada no admin ou EQUIPE_CHAVE). */
export async function exigirEquipe(req) {
  if (!(await chaveDoTimeConfere(req.headers['x-equipe']))) {
    limite(req, 30, 15 * 60e3);
    throw Object.assign(new Error('Chave do time inválida'), { status: 401 });
  }
}

/** Painel: cabeçalho x-senha = ADMIN_SENHA (só o dono do servidor). */
export function exigirAdmin(req) {
  if (!igual(process.env.ADMIN_SENHA, req.headers['x-senha'])) {
    limite(req, 10, 15 * 60e3);
    throw Object.assign(new Error('Senha errada'), { status: 401 });
  }
}

export function rota(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      if (!e.status) console.error(e);
      responder(res, e.status || 500, { erro: e.status ? e.message : `Erro no servidor: ${e.message}` });
    }
  };
}
