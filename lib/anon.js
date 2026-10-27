/**
 * O que sai da extensão para o servidor do time: nada de texto da página, URL completa ou dado
 * digitado. O site vira um apelido (hash do endereço), a URL vira só o trecho conhecido do
 * Magento e a falha vira o vetor de números que o modelo já usa.
 */
import { fnv1a, tokensOf, vectorize } from './diagnosis.js';

export const siteAlias = (origin) => 's' + fnv1a(String(origin || '').toLowerCase()).toString(36);

// Trechos de URL comuns em lojas Magento; qualquer outro (produto, categoria, id) vira "*".
const PATH_WORDS = new Set(('customer account login loginpost create createpost logout forgotpassword edit address index '
  + 'checkout cart onepage success failure catalog product view category catalogsearch search result advanced sales order '
  + 'history wishlist newsletter manage review contact cms page rest default mine carts guest-carts payment-information '
  + 'shipping-information estimate-shipping-methods coupons totals onestepcheckout firecheckout opc shipping payment '
  + 'minha-conta conta carrinho pedido').split(' '));

export function fluxoDe(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return '?';
  }
  const parts = [];
  for (const seg of u.pathname.toLowerCase().split('/').filter(Boolean)) {
    const p = /^v\d+$/.test(seg) ? seg : PATH_WORDS.has(seg) ? seg : '*';
    if (p === '*' && parts[parts.length - 1] === '*') continue;
    parts.push(p);
    if (parts.length >= 4) break;
  }
  const hash = u.hash.replace(/^#/, '').toLowerCase();
  return '/' + parts.join('/') + (PATH_WORDS.has(hash) ? '#' + hash : '');
}

/** Vetor da falha só com as posições preenchidas: { posição: peso }. */
export function sparseVector(failure) {
  const v = vectorize(tokensOf(failure));
  const out = {};
  v.forEach((x, i) => { if (x) out[i] = x; });
  return out;
}
