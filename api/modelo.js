// GET /api/modelo                    -> versão atual do modelo do time { versao, acuracia, url }
// GET /modelo/<versao>/<arquivo>     -> model.json ou weights.bin (reescrito para cá no vercel.json)
import { rota, responder, exigirEquipe } from '../servidor/http.js';
import { garantirInicial } from '../servidor/federado.js';
import { ler } from '../servidor/armazem.js';

export default rota(async (req, res) => {
  await exigirEquipe(req);
  const url = new URL(req.url, 'http://x');
  const versao = Number(url.searchParams.get('versao'));
  const arq = url.searchParams.get('arq');
  if (!versao) {
    const atual = await garantirInicial();
    return responder(res, 200, { versao: atual.versao, acuracia: atual.acuracia, at: atual.at, url: `/modelo/${atual.versao}/model.json` });
  }
  if (!['model.json', 'weights.bin'].includes(arq)) return responder(res, 404, { erro: 'arquivo desconhecido' });
  const dados = await ler(`modelos/${versao}/${arq}`);
  if (!dados) return responder(res, 404, { erro: 'versão não encontrada' });
  res.statusCode = 200;
  res.setHeader('Content-Type', arq === 'model.json' ? 'application/json' : 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.end(dados);
});
