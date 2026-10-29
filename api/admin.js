// Painel: POST /api/admin { acao, ... } com o cabeçalho x-senha = ADMIN_SENHA.
//   painel     { filtro? }      -> tudo que a tela mostra (modelo, rodadas, pendentes, radar);
//                                  filtro { projeto, qa } recorta o radar ('-' = sites sem projeto)
//   ativar     { versao }       -> volta/avança o modelo do time para essa versão
//   rodada                      -> fecha a rodada agora com as contribuições pendentes
//   descartar  { id }           -> joga fora uma contribuição pendente
//   config     { minClientes, janelaHoras, autoBug }
//   site       { alias, nome }  -> dá nome a um site do radar (o servidor só conhece o apelido)
//   projeto    { id?, nome, sites } -> cria/edita um projeto (grupo de sites); nome vazio remove
//   bug        { chave }        -> abre no ClickUp o bug de um alerta do radar
//   chave                       -> mostra a chave do time (a que os QAs colam na extensão)
//   trocarChave                 -> gera uma chave nova; a antiga para de funcionar na hora
import { randomUUID } from 'node:crypto';
import { rota, responder, exigirAdmin, lerCorpo } from '../servidor/http.js';
import { garantirInicial, config, salvarConfig, ativarVersao, fecharRodada, listarVersoes, resetarAprendizado } from '../servidor/federado.js';
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
    const filtro = { projeto: String(d.filtro?.projeto || '').replace(/[^\w-]/g, ''), qa: String(d.filtro?.qa || '').replace(/[^\w-]/g, '') };
    const radar = await painelRadar(cfg, Date.now(), filtro);
    const nomes = Object.fromEntries(radar.qas.map((q) => [q.id, q.nome]));
    const pendentes = (await listar(`contrib/${atual.versao}/`)).map((c) => {
      const id = c.chave.split('/').pop().replace(/\.json$/, '');
      const cliente = id.split('-').slice(1).join('-');
      return { id, cliente, nome: nomes[cliente] || '', at: c.at };
    });
    return responder(res, 200, {
      atual,
      versoes: await listarVersoes(),
      rodadas: (await lerJSON('estado/rodadas.json', [])).slice(-30).reverse(),
      pendentes,
      config: cfg,
      radar,
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
  if (d.acao === 'projeto') {
    const id = String(d.id || '').replace(/[^\w-]/g, '').slice(0, 16) || `p${randomUUID().slice(0, 8)}`;
    const projetos = { ...cfg.projetos };
    const nome = String(d.nome || '').trim().slice(0, 60);
    if (!nome) {
      delete projetos[id];
    } else {
      const sites = [...new Set((Array.isArray(d.sites) ? d.sites : []).map((s) => String(s).replace(/[^\w]/g, '').slice(0, 16)).filter(Boolean))];
      // Um site pertence a um projeto só: ao entrar neste, sai dos outros.
      for (const p of Object.values(projetos)) p.sites = (p.sites || []).filter((s) => !sites.includes(s));
      projetos[id] = { nome, sites };
    }
    await salvarConfig({ ...cfg, projetos });
    return responder(res, 200, { ok: true, id });
  }
  if (d.acao === 'chave') return responder(res, 200, await chaveDoTime());
  if (d.acao === 'trocarChave') return responder(res, 200, await trocarChave());
  if (d.acao === 'bug') return responder(res, 200, await abrirBug(String(d.chave || ''), cfg));
  if (d.acao === 'resetar') {
    const [sinais, bugs] = await Promise.all([listar('sinais/'), listar('estado/bugs.json')]);
    const aprendizado = await resetarAprendizado();
    await apagar([...sinais, ...bugs].map((item) => item.chave));
    await salvarConfig({ ...cfg, sites: {} });
    return responder(res, 200, {
      ok: true,
      aprendizado,
      sinaisRemovidos: sinais.length,
      bugsRemovidos: bugs.length,
      sitesRemovidos: Object.keys(cfg.sites || {}).length,
    });
  }
  responder(res, 400, { erro: 'ação desconhecida' });
});
