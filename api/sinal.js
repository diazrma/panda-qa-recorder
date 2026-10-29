// POST /api/sinal { cliente, sinais: [{ s, f, t, st, ms, at, v? }], sites?: { apelido: origem } } -> radar das lojas.
import { rota, responder, exigirEquipe, lerCorpo } from '../servidor/http.js';
import { receberSinais } from '../servidor/sinais.js';

export default rota(async (req, res) => {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'use POST' });
  await exigirEquipe(req);
  responder(res, 200, await receberSinais(await lerCorpo(req, 1_500_000)));
});
