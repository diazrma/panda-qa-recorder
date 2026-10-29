// POST /api/relatorio { test, run, diag?, shot? } (x-equipe) -> { id, url } link individual do relatório
// GET  /relatorio/<id>  (reescrito para /api/relatorio?id=)  -> página do relatório com "Baixar PDF".
//      Só abre para quem é do time: na primeira vez pede a chave do time (a mesma da extensão) e
//      grava um cookie com a assinatura dela (não a chave). Trocar a chave no admin derruba todo acesso.
// POST /relatorio/<id> (formulário, campo "chave")   -> confere a chave e grava o cookie
// O HTML é montado aqui com lib/report.js (texto escapado) e servido com CSP sem scripts de terceiros:
// a extensão nunca manda HTML pronto, então um relatório não roda código no domínio do admin.
import { randomInt, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { rota, responder, exigirEquipe, lerCorpo, chaveDoTimeConfere, limite } from '../servidor/http.js';
import { chaveDoTime } from '../servidor/chave.js';
import { gravar, lerJSON } from '../servidor/armazem.js';
import { toReportHtml } from '../lib/report.js';

const novoId = () => Array.from({ length: 18 }, (_, i) => randomInt(i ? 0 : 1, 10)).join('');
const texto = (v, n) => String(v ?? '').slice(0, n);
const PRINT = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/;

function limpar(d) {
  const t = d.test || {};
  const r = d.run || {};
  const steps = (Array.isArray(t.steps) ? t.steps : []).slice(0, 300);
  if (!steps.length) throw Object.assign(new Error('Relatório sem passos.'), { status: 400 });
  const shot = typeof d.shot === 'string' && PRINT.test(d.shot) ? d.shot : null;
  const diag = d.diag && typeof d.diag === 'object'
    ? { label: texto(d.diag.label, 120), explain: texto(d.diag.explain, 1000), fix: texto(d.diag.fix, 1000), confidence: Math.max(0, Math.min(1, Number(d.diag.confidence) || 0)) }
    : null;
  const stepShots = {};
  for (const [i, s] of Object.entries(d.stepShots && typeof d.stepShots === 'object' ? d.stepShots : {})) {
    if (Number(i) >= 0 && Number(i) < steps.length && typeof s === 'string' && PRINT.test(s)) stepShots[Number(i)] = s;
  }
  return { test: { name: texto(t.name, 200) || 'Teste', steps }, run: r, diag, shot, stepShots, criadoEm: Date.now() };
}

const BARRA = (nonce) => `
<style nonce="${nonce}">
  .pqa-bar{position:sticky;top:0;display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:10px 0;background:#fff;border-bottom:1px solid #e3e6eb;margin-bottom:16px}
  .pqa-bar span{margin-right:auto;color:#646b78;font-size:13px}
  .pqa-bar button{height:32px;padding:0 14px;border-radius:7px;border:1px solid #2563eb;background:#2563eb;color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer}
  @media print{.pqa-bar{display:none}body{margin:0;max-width:none}tr{break-inside:avoid}img{break-inside:avoid}}
  @page{margin:14mm}
</style>
<div class="pqa-bar"><span>Relatório do Panda QA Recorder</span><button id="pqa-pdf" type="button">Baixar PDF</button></div>
<script nonce="${nonce}">document.getElementById('pqa-pdf').onclick = () => window.print();</script>`;

const COOKIE = 'pqa_time';
const assinatura = async () => createHmac('sha256', (await chaveDoTime()).chave).update('pqa-relatorio-v1').digest('hex');

async function temAcesso(req) {
  const c = String(req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(COOKIE + '='));
  const veio = Buffer.from(c ? c.slice(COOKIE.length + 1) : '');
  const certa = Buffer.from(await assinatura());
  return Boolean((await chaveDoTime()).chave) && veio.length === certa.length && timingSafeEqual(veio, certa);
}

function paginaChave(res, id, erro) {
  res.statusCode = 401;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Relatório do time</title><meta name="robots" content="noindex">
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;background:#0f1115;color:#e8eaef}
  form{width:min(360px,calc(100vw - 32px));display:grid;gap:12px;padding:22px;border-radius:12px;background:#171a21;border:1px solid #2b303b}
  b{font-size:16px} p{margin:0;color:#98a0ad;font-size:13px}
  input{height:40px;padding:0 10px;border-radius:8px;border:1px solid #2b303b;background:#0f1115;color:#e8eaef;font:inherit}
  button{height:40px;border:0;border-radius:8px;background:#2563eb;color:#fff;font:600 15px system-ui,sans-serif;cursor:pointer}
  .err{color:#f87171;font-size:13px}
</style></head><body>
<form method="post" action="/relatorio/${id}">
  <b>Relatório do Panda QA</b>
  <p>Este relatório é só para o time. Digite a chave do time (a mesma de Configurações > Time na extensão). Este navegador fica liberado por 90 dias.</p>
  <input type="password" name="chave" placeholder="Chave do time" autocomplete="current-password" autofocus required>
  ${erro ? `<div class="err">${erro}</div>` : ''}
  <button type="submit">Abrir relatório</button>
</form></body></html>`);
}

export default rota(async (req, res) => {
  const idUrl = new URL(req.url, 'http://x').searchParams.get('id') || '';
  if (req.method === 'POST' && /^\d{18}$/.test(idUrl)) {
    const { chave } = await lerCorpo(req, 10_000);
    if (!(await chaveDoTimeConfere(chave))) {
      limite(req, 10, 15 * 60e3);
      return paginaChave(res, idUrl, 'Chave errada.');
    }
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    const seguro = !/^(localhost|127\.)/.test(host);
    res.setHeader('Set-Cookie', `${COOKIE}=${await assinatura()}; Path=/relatorio; Max-Age=${90 * 86400}; HttpOnly; SameSite=Lax${seguro ? '; Secure' : ''}`);
    res.statusCode = 303;
    res.setHeader('Location', `/relatorio/${idUrl}`);
    return res.end();
  }
  if (req.method === 'POST') {
    await exigirEquipe(req);
    const rel = limpar(await lerCorpo(req, 4_400_000));
    const id = novoId();
    await gravar(`relatorios/${id}.json`, rel);
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
    return responder(res, 200, { id, url: `${proto}://${host}/relatorio/${id}` });
  }
  const id = idUrl;
  if (!/^\d{18}$/.test(id)) return paginaChave(res, '0', 'Link inválido.');
  if (!(await temAcesso(req))) return paginaChave(res, id);
  const rel = await lerJSON(`relatorios/${id}.json`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!rel) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end('<!doctype html><meta charset="utf-8"><title>Relatório não encontrado</title><p style="font:16px system-ui;margin:40px">Relatório não encontrado. Confira o link.</p>');
  }
  const nonce = randomBytes(12).toString('base64');
  const html = toReportHtml(rel.test, rel.run, rel.shot, rel.diag, rel.stepShots)
    .replace('<body>', `<body>${BARRA(nonce)}`)
    .replace('<style>', `<style nonce="${nonce}">`)
    .replace('Gerado pelo Panda QA Recorder.', `Gerado pelo Panda QA Recorder em ${new Date(rel.criadoEm).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}.`);
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', `default-src 'none'; img-src data:; style-src 'nonce-${nonce}'; style-src-attr 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`);
  res.end(html);
});
