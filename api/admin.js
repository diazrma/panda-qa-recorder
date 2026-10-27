// Painel: POST /api/admin { acao, ... } com o cabeçalho x-senha = ADMIN_SENHA.
//   painel                      -> tudo que a tela mostra (modelo, rodadas, pendentes, radar)
//   ativar     { versao }       -> volta/avança o modelo do time para essa versão
//   rodada                      -> fecha a rodada agora com as contribuições pendentes
//   descartar  { id }           -> joga fora uma contribuição pendente
//   config     { minClientes, janelaHoras, autoBug }
//   site       { alias, nome }  -> dá nome a um site do radar (o servidor só conhece o apelido)
//   bug        { chave }        -> abre no ClickUp o bug de um alerta do radar
//   chave                       -> mostra a chave do time (a que os QAs colam na extensão)
//   trocarChave                 -> gera uma chave nova; a antiga para de funcionar na hora
import { rota, responder, exigirAdmin, lerCorpo } from '../servidor/http.js';
import { garantirInicial, config, salvarConfig, ativarVersao, fecharRodada, listarVersoes } from '../servidor/federado.js';
import { listar, lerJSON, apagar } from '../servidor/armazem.js';
import { painelRadar, abrirBug } from '../servidor/sinais.js';
import { clickupLigado } from '../servidor/clickup.js';
import { chaveDoTime, trocarChave } from '../servidor/chave.js';

export default rota(async (req, res) => {
  if (req.method !== 'POST') return responder(res, 405, { erro: 'use POST' });
  exigirAdmin(req);
  const d = await lerCorpo(req);
  const cfg = await config();

  if (d.acao === 'painel') {
    const atual = await garantirInicial();
    const pendentes = (await listar(`contrib/${atual.versao}/`)).map((c) => {
      const id = c.chave.split('/').pop().replace(/\.json$/, '');
      return { id, cliente: id.split('-').slice(1).join('-'), at: c.at };
    });
    return responder(res, 200, {
      atual,
      versoes: await listarVersoes(),
      rodadas: (await lerJSON('estado/rodadas.json', [])).slice(-30).reverse(),
      pendentes,
      config: cfg,
      radar: await painelRadar(cfg),
      clickup: clickupLigado(),
      chave: await chaveDoTime().then(({ at, origem }) => ({ at, origem })),
    });
  }
  if (d.acao === 'ativar') return responder(res, 200, await ativarVersao(d.versao));
  if (d.acao === 'rodada') return responder(res, 200, await fecharRodada());
  if (d.acao === 'descartar') {
    const atual = await garantirInicial();
    await apagar([`contrib/${atual.versao}/${String(d.id).replace(/[^\w-]/g, '')}.json`]);
    return responder(res, 200, { ok: true });
  }
  if (d.acao === 'config') {
    const novo = {
      ...cfg,
      minClientes: Math.max(1, Math.min(20, Number(d.minClientes) || cfg.minClientes)),
      janelaHoras: Math.max(1, Math.min(48, Number(d.janelaHoras) || cfg.janelaHoras)),
      autoBug: d.autoBug === undefined ? cfg.autoBug : Boolean(d.autoBug),
    };
    await salvarConfig(novo);
    return responder(res, 200, novo);
  }
  if (d.acao === 'site') {
    const alias = String(d.alias || '').replace(/[^\w]/g, '').slice(0, 16);
    if (!alias) return responder(res, 400, { erro: 'faltou o apelido' });
    const sites = { ...cfg.sites };
    const nome = String(d.nome || '').trim().slice(0, 60);
    if (nome) sites[alias] = nome;
    else delete sites[alias];
    await salvarConfig({ ...cfg, sites });
    return responder(res, 200, { ok: true });
  }
  if (d.acao === 'chave') return responder(res, 200, await chaveDoTime());
  if (d.acao === 'trocarChave') return responder(res, 200, await trocarChave());
  if (d.acao === 'bug') return responder(res, 200, await abrirBug(String(d.chave || ''), cfg));
  responder(res, 400, { erro: 'ação desconhecida' });
});
