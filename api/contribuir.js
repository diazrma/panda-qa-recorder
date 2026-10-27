// POST /api/contribuir { cliente, base, n, delta } -> guarda a diferença de pesos de um QA e,
// quando há contribuições suficientes, fecha a rodada do aprendizado federado.
import { rota, responder, exigirEquipe, lerCorpo } from '../servidor/http.js';
import { receberContribuicao } from '../servidor/federado.js';

export default rota(async (req, res) => {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'use POST' });
  exigirEquipe(req);
  const d = await lerCorpo(req, 2_000_000);
  if (!d.cliente || !d.delta) return responder(res, 400, { erro: 'faltou cliente ou delta' });
  responder(res, 200, await receberContribuicao(d));
});
