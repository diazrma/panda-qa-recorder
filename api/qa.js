// Painel do QA: POST /api/qa { acao, cliente, ... } com o cabeçalho x-equipe = chave do time.
//   painel     { filtro? }  -> radar e execuções só das lojas em que esse QA testou (e dos mesmos projetos)
//   execucao   { id }       -> execução completa, se for de uma dessas lojas
// O "cliente" é o id da extensão do QA; o botão "Abrir meu painel" da extensão já manda.
import { rota, responder, exigirEquipe, lerCorpo } from '../servidor/http.js';
import { config } from '../servidor/federado.js';
import { limpaCliente, painelDoQa, execucaoDoQa } from '../servidor/qa.js';

export default rota(async (req, res) => {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'use POST' });
  await exigirEquipe(req);
  const d = await lerCorpo(req);
  const cliente = limpaCliente(d.cliente);
  if (!cliente) return responder(res, 400, { erro: 'Abra o painel pelo botão "Abrir meu painel" da extensão.' });
  const cfg = await config();
  if (d.acao === 'painel') {
    const filtro = { projeto: String(d.filtro?.projeto || '').replace(/[^\w-]/g, ''), qa: String(d.filtro?.qa || '').replace(/[^\w-]/g, '') };
    return responder(res, 200, await painelDoQa(cliente, cfg, filtro));
  }
  if (d.acao === 'execucao') return responder(res, 200, await execucaoDoQa(cliente, cfg, d.id));
  responder(res, 400, { erro: 'ação desconhecida' });
});
