// POST /api/execucao { cliente, nome, s, o?, t, teste: { name, steps }, run, shots: { índice: dataUrl } }
// -> guarda a última execução do teste para a seção Testes do painel (só com a chave do time).
import { rota, responder, exigirEquipe, lerCorpo } from '../servidor/http.js';
import { receberExecucao } from '../servidor/execucoes.js';

export default rota(async (req, res) => {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'use POST' });
  await exigirEquipe(req);
  responder(res, 200, await receberExecucao(await lerCorpo(req, 4_400_000)));
});
