/**
 * Convite do time: servidor + chave num código só (PANDATIME1.…), que o admin copia do painel e o
 * QA cola na extensão. O painel do servidor monta o mesmo formato (public/index.html).
 */
const PREFIX = 'PANDATIME1.';

const toB64Url = (text) => btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64Url = (b64) => decodeURIComponent(escape(atob(b64.replace(/-/g, '+').replace(/_/g, '/'))));

export function encodeInvite(server, key) {
  return PREFIX + toB64Url(JSON.stringify({ s: String(server).replace(/\/+$/, ''), k: key }));
}

/** Acha o convite no texto colado (pode ser a mensagem inteira) e devolve { server, key }. */
export function decodeInvite(text) {
  const m = String(text || '').match(/PANDATIME1\.([A-Za-z0-9_-]+)/);
  if (!m) throw new Error('Convite não encontrado. Cole o código que começa com PANDATIME1.');
  let d;
  try {
    d = JSON.parse(fromB64Url(m[1]));
  } catch {
    throw new Error('Convite incompleto. Copie de novo o código inteiro no painel do admin.');
  }
  if (!/^https?:\/\/[^\s/]+$/.test(d.s || '') || !d.k) throw new Error('Convite inválido. Peça um novo ao admin.');
  return { server: d.s, key: String(d.k) };
}
