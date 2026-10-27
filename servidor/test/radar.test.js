import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analisar } from '../radar.js';
import { fluxoDe, siteAlias } from '../../lib/anon.js';
import { parseTaskRef } from '../../lib/clickup.js';

const H = 3600e3;
const agora = Date.UTC(2026, 9, 27, 18);
const sinal = (c, st, horasAtras, extra = {}) => ({ c, s: 'sA', f: '/checkout', t: 't1', st, ms: 9000, at: agora - horasAtras * H, ...extra });

test('alerta quando o fluxo que passava começa a falhar para vários QAs', () => {
  const sinais = [
    ...Array.from({ length: 10 }, (_, i) => sinal(i % 2 ? 'qa1' : 'qa2', 'passed', 30 + i)),
    sinal('qa1', 'failed', 1.5, { cat: 'server' }), sinal('qa2', 'failed', 1, { cat: 'server' }), sinal('qa3', 'failed', 0.5, { cat: 'jserror' }), sinal('qa1', 'passed', 0.2),
  ];
  const r = analisar(sinais, { agora, sites: { sA: 'Mueller staging' } });
  assert.equal(r.alertas.length, 1);
  const a = r.alertas[0];
  assert.equal(a.nome, 'Mueller staging');
  assert.equal(a.falhas, 3);
  assert.equal(a.clientes, 3);
  assert.equal(a.categoria, 'server');
  assert.equal(a.taxaAntes, 0);
  assert.equal(r.linha.length, 48);
});

test('sem alerta para fluxo que sempre falhou (instável, não quebra nova) ou um QA só', () => {
  const sempre = [...Array.from({ length: 10 }, (_, i) => sinal('qa1', i % 2 ? 'failed' : 'passed', 30 + i)), sinal('qa1', 'failed', 1), sinal('qa2', 'failed', 1), sinal('qa2', 'failed', 0.5)];
  assert.equal(analisar(sempre, { agora }).alertas.length, 0);
  const umQa = [sinal('qa1', 'passed', 30), sinal('qa1', 'failed', 1), sinal('qa1', 'failed', 0.5), sinal('qa1', 'failed', 0.2)];
  assert.equal(analisar(umQa, { agora }).alertas.length, 0);
});

test('trecho da URL não carrega produto, id nem domínio', () => {
  assert.equal(fluxoDe('https://loja.mueller.com.br/checkout/#payment'), '/checkout#payment');
  assert.equal(fluxoDe('https://loja.mueller.com.br/tenis-runner-pro-42.html?cor=azul'), '/*');
  assert.equal(fluxoDe('https://x.test/rest/default/V1/carts/8812/payment-information'), '/rest/default/v1/carts');
  assert.equal(fluxoDe('https://x.test/customer/account/login/referer/aHR0cHM6Ly9/'), '/customer/account/login/*');
  assert.match(siteAlias('https://loja.mueller.com.br'), /^s[0-9a-z]+$/);
  assert.equal(siteAlias('https://A.test'), siteAlias('https://a.test'));
});

test('link e ID de tarefa do ClickUp', () => {
  assert.deepEqual(parseTaskRef('https://app.clickup.com/t/86ajthyru'), { id: '86ajthyru' });
  assert.deepEqual(parseTaskRef('#86ajthyru'), { id: '86ajthyru' });
  assert.deepEqual(parseTaskRef('https://app.clickup.com/t/9011/SUP-123'), { id: 'SUP-123', custom: true, teamId: '9011' });
  assert.throws(() => parseTaskRef('oi'), /link/);
});
