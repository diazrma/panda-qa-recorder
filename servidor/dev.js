// Servidor local parecido com a Vercel: public/ + funções de api/ + a reescrita de /modelo.
// Lê ADMIN_SENHA e EQUIPE_CHAVE do .env.local. Uso: npm run servidor
// Os dados ficam em .dados/: o token do Blob que o "vercel link" põe no .env.local é ignorado,
// para o servidor local nunca gravar no Blob de produção (USAR_BLOB=1 libera de propósito).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');

function lerEnvLocal() {
  if (!existsSync(path.join(raiz, '.env.local'))) return;
  for (const linha of readFileSync(path.join(raiz, '.env.local'), 'utf8').split('\n')) {
    const m = linha.match(/^(\w+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
  }
  if (process.env.USAR_BLOB !== '1') delete process.env.BLOB_READ_WRITE_TOKEN;
}
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

export function criarServidor() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      const m = url.pathname.match(/^\/modelo\/(\d+)\/([\w.]+)$/);
      if (m) req.url = `/api/modelo?versao=${m[1]}&arq=${m[2]}`;
      const rel = url.pathname.match(/^\/relatorio\/(\w+)$/);
      if (rel) req.url = `/api/relatorio?id=${rel[1]}`;
      const p = new URL(req.url, 'http://x').pathname;
      if (p.startsWith('/api/')) {
        const { default: handler } = await import(path.join(raiz, 'api', p.slice(5).replace(/[^\w-]/g, '') + '.js'));
        return await handler(req, res);
      }
      const arquivo = path.join(raiz, 'public', p === '/' ? 'index.html' : decodeURIComponent(p));
      if (!arquivo.startsWith(path.join(raiz, 'public'))) throw Object.assign(new Error('fora'), { code: 'ENOENT' });
      const dados = await readFile(arquivo);
      res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream' });
      res.end(dados);
    } catch (e) {
      res.writeHead(e.code === 'ENOENT' ? 404 : 500);
      res.end(e.code === 'ENOENT' ? 'não achei' : e.message);
    }
  });
}

if (process.argv[1] === import.meta.filename) {
  lerEnvLocal();
  const porta = Number(process.env.PORT || 5190);
  criarServidor().listen(porta, () => console.log(`Servidor do time em http://localhost:${porta}`));
}
